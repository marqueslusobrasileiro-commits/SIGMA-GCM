import type express from "express";
import nodemailer from "nodemailer";
import { FieldValue } from "firebase-admin/firestore";
import { db, storageBucket } from "../lib/firebaseAdmin";
import { requireFirebaseAuth } from "../lib/httpAuth";

function getMailTransportIfConfigured() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

function requireConfiguredEmailOrRespond(res: express.Response): string | null {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    res.status(501).json({
      error:
        "ADMIN_EMAIL não configurado no servidor. Configure ADMIN_EMAIL (e SMTP_*) para envio automático.",
    });
    return null;
  }
  return adminEmail;
}

async function getUserAccess(uid: string): Promise<{
  role?: string;
  status?: string;
  email?: string;
}> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? (snap.data() as any) : null;
    return {
      role: data?.role,
      status: data?.status,
      email: data?.email,
    };
  } catch {
    return {};
  }
}

function isAtivo(access: { role?: string; status?: string }) {
  if (access.role === "admin" && access.status === "ATIVO") return true;
  return access.status === "ATIVO";
}

function isAdmin(access: { role?: string; status?: string }) {
  return access.role === "admin" && access.status === "ATIVO";
}

function isMasterAdmin(access: { role?: string; status?: string; email?: string }) {
  return isAdmin(access) && String(access.email || "").toLowerCase() === "andersonf.g.marques@gmail.com";
}

/** Caminho canónico no bucket: relatorios/AAAA/MM/uid/reportId.pdf */
function buildRelatorioStoragePath(uid: string, reportId: string, windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  return `relatorios/${yyyy}/${mm}/${uid}/${reportId}.pdf`;
}

/** Ordem: path explícito no doc → layout novo (inferido) → legado shift_reports/ */
function collectCandidateStoragePaths(reportId: string, data: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const t = String(p || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  add(String(data?.storagePath || ""));
  const agentId = String(data?.agentId || "").trim();
  const ws = String(data?.windowStart || "").trim();
  if (agentId) {
    if (ws) add(buildRelatorioStoragePath(agentId, reportId, ws));
    add(`shift_reports/${agentId}/${reportId}.pdf`);
  }
  return out;
}

function isLikelyFirebaseStorageHttpsUrl(url: string): boolean {
  return /firebasestorage\.googleapis\.com|\.appspot\.com|\.firebasestorage\.app/i.test(url);
}

/**
 * Obtém o PDF apenas via Firebase Storage (Admin SDK) ou URL HTTPS do próprio Firebase (token).
 */
async function downloadShiftReportPdfBuffer(opts: { reportId: string; data: any }): Promise<Buffer | null> {
  const { reportId, data } = opts;
  const bucketName = storageBucket.name || "(default)";

  for (const storagePath of collectCandidateStoragePaths(reportId, data)) {
    try {
      const [buf] = await storageBucket.file(storagePath).download();
      if (buf?.length) {
        // eslint-disable-next-line no-console
        console.log("[shift-reports] PDF obtido do Firebase Storage", {
          reportId,
          bucket: bucketName,
          storagePath,
          bytes: buf.length,
        });
        return buf;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[shift-reports] tentativa Storage falhou", {
        reportId,
        storagePath,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const url = String(data?.downloadUrl || "").trim();
  if (url && /^https?:\/\//i.test(url) && isLikelyFirebaseStorageHttpsUrl(url)) {
    try {
      const resp = await fetch(url, { method: "GET" });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length) {
          // eslint-disable-next-line no-console
          console.log("[shift-reports] PDF obtido por downloadUrl (HTTPS Firebase)", {
            reportId,
            bytes: buf.length,
          });
          return buf;
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[shift-reports] fetch downloadUrl falhou", {
        reportId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return null;
}

async function readPdfBufferForEmail(opts: { reportId: string; data: any }): Promise<Buffer> {
  const buf = await downloadShiftReportPdfBuffer(opts);
  if (buf?.length) return buf;
  throw new Error(
    "Não foi possível obter o PDF no Firebase Storage. Confirme no Render: FIREBASE_SERVICE_ACCOUNT, " +
      "FIREBASE_STORAGE_BUCKET (ou projectId para bucket default), plano Blaze ativo e regras do Storage. " +
      "Relatórios muito antigos podem precisar de ser gerados de novo.",
  );
}

export function registerShiftReportRoutes(app: express.Express) {
  app.post("/api/shift-reports/upload", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload request received", {
      hasAuth: !!req.headers.authorization,
      contentLength: req.headers["content-length"],
      bucket: storageBucket.name,
    });
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isAtivo(access)) {
      return res.status(403).json({ error: "Acesso negado (usuário não ATIVO)." });
    }

    const {
      filename,
      pdfBase64,
      meta,
    }: {
      filename: string;
      pdfBase64: string;
      meta: any;
    } = req.body || {};

    if (!filename || !pdfBase64 || !meta) {
      return res.status(400).json({ error: "Missing filename/pdfBase64/meta" });
    }

    const reportId = (meta?.reportId as string | undefined) || undefined;
    const docRef = reportId ? db.collection("shift_reports").doc(reportId) : db.collection("shift_reports").doc();
    const finalReportId = docRef.id;

    const safeName = String(filename).replace(/[^\w.\-() ]/g, "_");
    const buffer = Buffer.from(String(pdfBase64), "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "PDF vazio ou base64 inválido." });
    }

    const agentId = String(meta?.agentId || decoded.uid).trim();
    const windowStartIso = String(meta?.windowStart || new Date().toISOString());
    const storagePath = buildRelatorioStoragePath(agentId, finalReportId, windowStartIso);
    const downloadUrl = `/api/shift-reports/file/${encodeURIComponent(finalReportId)}`;

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: gravando PDF no Firebase Storage", {
      reportId: finalReportId,
      bucket: storageBucket.name,
      storagePath,
      bytes: buffer.length,
    });

    try {
      await storageBucket.file(storagePath).save(buffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          cacheControl: "private, max-age=0, no-transform",
          metadata: { reportId: finalReportId, agentId },
        },
      });
    } catch (e) {
      console.error("[shift-reports] upload: falha ao gravar no Firebase Storage", e);
      return res.status(500).json({
        error:
          e instanceof Error
            ? e.message
            : "Falha ao gravar PDF no Firebase Storage. Verifique credenciais, bucket e plano Blaze.",
      });
    }

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: Firestore merge", { reportId: finalReportId, downloadUrl });

    await docRef.set(
      {
        createdAt: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        filename: safeName,
        downloadUrl,
        storagePath,
        firebaseStorageBucket: storageBucket.name,
        uploaded: true,
        uploadedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
        agentId: meta?.agentId || decoded.uid,
        agentName: meta?.agentName || decoded.email || decoded.uid,
        registration: meta?.registration || "",
        teamId: meta?.teamId || "",
        teamName: meta?.teamName || "",
        vehiclePrefix: meta?.vehiclePrefix || "",
        shift: meta?.shift || "",
        windowStart: meta?.windowStart || "",
        windowEnd: meta?.windowEnd || "",
        delivery: "firebase_storage",
        localPath: FieldValue.delete(),
        objectKey: FieldValue.delete(),
        supabasePath: FieldValue.delete(),
      },
      { merge: true },
    );

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: concluído com sucesso", { reportId: finalReportId });
    res.json({ ok: true, reportId: finalReportId, downloadUrl, storagePath });
  });

  app.get("/api/shift-reports/file/:reportId", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isAtivo(access)) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).json({ error: "missing reportId" });

    const snap = await db.collection("shift_reports").doc(reportId).get();
    if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });
    const data = snap.data() as any;

    const ownerUid = String(data?.agentId || "");
    if (!isAdmin(access) && decoded.uid !== ownerUid) {
      return res.status(403).json({ error: "forbidden" });
    }

    // eslint-disable-next-line no-console
    console.log("[shift-reports] file GET", { reportId, bucket: storageBucket.name });

    const buf = await downloadShiftReportPdfBuffer({ reportId, data });
    if (!buf?.length) {
      return res.status(404).json({
        error:
          "PDF não encontrado no Firebase Storage para este relatório. Gere novamente pelo app ou confira o bucket e o caminho no Firestore.",
      });
    }

    // eslint-disable-next-line no-console
    console.log("[shift-reports] file GET: enviando PDF", { reportId, bytes: buf.length });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${String(data?.filename || "relatorio.pdf")}"`);
    res.send(buf);
  });

  app.post("/api/shift-reports/trash/:reportId", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] trash request received", {
      hasAuth: !!req.headers.authorization,
      reportId: req.params.reportId,
    });
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isMasterAdmin(access)) {
      return res.status(403).json({ error: "Somente o ADM MASTER pode mover para a lixeira." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).json({ error: "missing reportId" });

    const ref = db.collection("shift_reports").doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });

    await ref.set(
      {
        deletedAt: new Date().toISOString(),
        deletedBy: decoded.uid,
      },
      { merge: true },
    );

    res.json({ ok: true });
  });

  app.post("/api/shift-reports/restore/:reportId", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] restore request received", {
      hasAuth: !!req.headers.authorization,
      reportId: req.params.reportId,
    });
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isMasterAdmin(access)) {
      return res.status(403).json({ error: "Somente o ADM MASTER pode restaurar." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).json({ error: "missing reportId" });

    const ref = db.collection("shift_reports").doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });

    await ref.set(
      {
        deletedAt: null,
        deletedBy: null,
      },
      { merge: true },
    );

    res.json({ ok: true });
  });

  app.delete("/api/shift-reports/purge/:reportId", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] purge request received", {
      hasAuth: !!req.headers.authorization,
      reportId: req.params.reportId,
    });
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isMasterAdmin(access)) {
      return res.status(403).json({ error: "Somente o ADM MASTER pode excluir definitivamente." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).json({ error: "missing reportId" });

    const ref = db.collection("shift_reports").doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });
    const data = snap.data() as any;

    for (const p of collectCandidateStoragePaths(reportId, data)) {
      try {
        await storageBucket.file(p).delete();
        // eslint-disable-next-line no-console
        console.log("[shift-reports] purge: objeto removido do Storage", { path: p });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[shift-reports] purge: falha ao remover (pode já não existir)", {
          path: p,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await ref.delete();
    res.json({ ok: true });
  });

  app.delete("/api/shift-reports/:reportId", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isMasterAdmin(access)) {
      return res.status(403).json({ error: "Somente o ADM MASTER pode mover para a lixeira." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).json({ error: "missing reportId" });

    const ref = db.collection("shift_reports").doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });

    await ref.set(
      {
        deletedAt: new Date().toISOString(),
        deletedBy: decoded.uid,
      },
      { merge: true },
    );
    res.json({ ok: true });
  });

  app.post("/api/shift-reports/send/:reportId", async (req, res) => {
    try {
      // eslint-disable-next-line no-console
      console.log("[shift-reports] send(manual) request received", {
        hasAuth: !!req.headers.authorization,
        reportId: req.params.reportId,
      });
      const decoded = await requireFirebaseAuth(req, res);
      if (!decoded) return;

      const access = await getUserAccess(decoded.uid);
      if (!isMasterAdmin(access)) {
        return res.status(403).json({ error: "Somente o ADM MASTER pode enviar por e-mail." });
      }

      const transport = getMailTransportIfConfigured();
      if (!transport) {
        return res.status(501).json({
          error:
            "SMTP não configurado. Configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (e SMTP_FROM) no servidor.",
        });
      }

      const adminEmail = requireConfiguredEmailOrRespond(res);
      if (!adminEmail) return;

      const reportId = String(req.params.reportId || "");
      const snap = await db.collection("shift_reports").doc(reportId).get();
      if (!snap.exists) return res.status(404).json({ error: "Relatório não encontrado." });
      const data = snap.data() as any;

      // eslint-disable-next-line no-console
      console.log("[shift-reports] send: obtendo PDF para anexo", { reportId });
      const buffer = await readPdfBufferForEmail({ reportId, data });
      // eslint-disable-next-line no-console
      console.log("[shift-reports] send: PDF pronto, enviando SMTP", { reportId, bytes: buffer.length, to: adminEmail });

      const subject = `SIGMA-GCM - Relatório de Plantão (${data?.agentName || "-"})`;
      const text = [
        "Relatório de Plantão anexado.",
        "",
        `Agente: ${data?.agentName || "-"}`,
        `Matrícula: ${data?.registration || "-"}`,
        `Equipe: ${data?.teamName || "-"}`,
        `Viatura: ${data?.vehiclePrefix || "-"}`,
        `Turno: ${data?.shift || "-"}`,
        `Período: ${data?.windowStart || "-"} – ${data?.windowEnd || "-"}`,
        "",
        "Envio acionado manualmente pelo ADM MASTER (SIGMA-GCM).",
      ].join("\n");

      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: adminEmail,
        subject,
        text,
        attachments: [
          {
            filename: String(data?.filename || "relatorio.pdf"),
            content: buffer,
            contentType: "application/pdf",
          },
        ],
      });

      await snap.ref.set(
        {
          emailTo: adminEmail,
          emailSentAt: new Date().toISOString(),
        },
        { merge: true },
      );

      // eslint-disable-next-line no-console
      console.log("[shift-reports] send: e-mail enviado com sucesso", { reportId, to: adminEmail });
      res.json({ ok: true, emailTo: adminEmail });
    } catch (err) {
      console.error("[shift-reports] send(manual) failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg || "Falha ao enviar e-mail." });
    }
  });

  app.post("/api/shift-reports/send", async (req, res) => {
    return res.status(410).json({
      error:
        "Rota desativada. Use /api/shift-reports/upload para registrar no painel. O envio por e-mail é manual via /api/shift-reports/send/:reportId.",
    });
  });
}
