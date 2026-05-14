import type express from "express";
import nodemailer from "nodemailer";
import { FieldValue } from "firebase-admin/firestore";
import { db, storageBucket } from "../lib/firebaseAdmin";
import { requireFirebaseAuth } from "../lib/httpAuth";
import {
  downloadShiftReportPdfFromSupabase,
  isSupabaseShiftReportsConfigured,
  removeShiftReportPdfFromSupabase,
  supabaseShiftReportsBucket,
  uploadShiftReportPdfToSupabase,
} from "../lib/supabaseShiftReports";
import { isResendConfigured, sendEmailWithPdfViaResend } from "../lib/resendShiftReportMail";

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
    /** Render / redes lentas: 20s costumava gerar "Connection timeout" ao anexar PDF + cold start. */
    connectionTimeout: 60_000,
    greetingTimeout: 45_000,
    socketTimeout: 120_000,
  });
}

function requireConfiguredEmailOrRespond(res: express.Response): string | null {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    res.status(501).json({
      error:
        "ADMIN_EMAIL não configurado no servidor. Configure ADMIN_EMAIL e Resend (RESEND_API_KEY + RESEND_FROM) ou SMTP_*.",
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

function isLikelySupabasePublicUrl(url: string): boolean {
  return /\.supabase\.co\//i.test(url) || /\/storage\/v1\/object\/public\//i.test(url);
}

/**
 * Obtém o PDF: Supabase (delivery + path ou URL pública) → Firebase Storage (Admin) → URL HTTPS Firebase.
 */
async function downloadShiftReportPdfBuffer(opts: { reportId: string; data: any }): Promise<Buffer | null> {
  const { reportId, data } = opts;
  const bucketName = storageBucket.name || "(default)";

  if (String(data?.delivery || "") === "supabase" && isSupabaseShiftReportsConfigured()) {
    const sp = String(data?.storagePath || "").trim();
    if (sp) {
      const fromSb = await downloadShiftReportPdfFromSupabase(sp, reportId);
      if (fromSb?.length) return fromSb;
    }
  }

  const publicUrl = String(data?.publicUrl || "").trim();
  if (publicUrl && /^https?:\/\//i.test(publicUrl) && isLikelySupabasePublicUrl(publicUrl)) {
    try {
      const resp = await fetch(publicUrl, { method: "GET" });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length) {
          // eslint-disable-next-line no-console
          console.log("[shift-reports] PDF obtido por publicUrl (Supabase)", { reportId, bytes: buf.length });
          return buf;
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[shift-reports] fetch publicUrl Supabase falhou", {
        reportId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

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
  const { reportId, data } = opts;
  const delivery = String(data?.delivery || "").trim();

  if (delivery === "supabase" && !isSupabaseShiftReportsConfigured()) {
    throw new Error(
      "Este relatório usa Supabase (campo delivery=supabase), mas o servidor Node não está configurado: faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no Render (ou no .env local). " +
        "Adiciona as variáveis ao serviço que corre a API, guarda e faz redeploy. Sem isto, o servidor não consegue ler o PDF do bucket.",
    );
  }

  const buf = await downloadShiftReportPdfBuffer(opts);
  if (buf?.length) return buf;

  if (delivery === "supabase") {
    const sp = String(data?.storagePath || "").trim();
    const bucket = supabaseShiftReportsBucket();
    throw new Error(
      "O PDF não foi encontrado no Supabase (ou o download falhou). Confirma no Supabase: bucket \"" +
        bucket +
        "\", objeto em \"" +
        (sp || "(storagePath vazio no Firestore)") +
        "\", políticas de Storage e se o ficheiro existe. Se o upload falhou noutra altura, regera o relatório no app.",
    );
  }

  throw new Error(
    "Não foi possível obter o PDF. Para relatórios em Firebase Storage: FIREBASE_SERVICE_ACCOUNT válido e Firebase Storage (Blaze) com o ficheiro no caminho do documento. " +
      "Para relatórios novos em Supabase: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY e bucket sigma-pdfs. " +
      "Regenera o relatório no app se o ficheiro tiver sido apagado.",
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
    const apiFileUrl = `/api/shift-reports/file/${encodeURIComponent(finalReportId)}`;

    let downloadUrl = apiFileUrl;
    let publicUrl = "";
    let delivery: "supabase" | "firebase_storage" = "firebase_storage";
    let supabaseBucketName = "";

    if (isSupabaseShiftReportsConfigured()) {
      const up = await uploadShiftReportPdfToSupabase({
        buffer,
        objectPath: storagePath,
        reportId: finalReportId,
      });
      if (up?.storagePath) {
        publicUrl = String(up.publicUrl || "").trim();
        delivery = "supabase";
        supabaseBucketName = supabaseShiftReportsBucket();
        downloadUrl = publicUrl || apiFileUrl;
        // eslint-disable-next-line no-console
        console.log("[shift-reports] upload: guardado no Supabase Storage", {
          reportId: finalReportId,
          bucket: supabaseBucketName,
          storagePath: up.storagePath,
          bytes: buffer.length,
        });
      }
    }

    if (delivery === "firebase_storage") {
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
              : "Falha ao gravar PDF no Firebase Storage. Verifique credenciais, bucket e plano Blaze, ou configure Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: Firestore merge", { reportId: finalReportId, downloadUrl, delivery });

    const baseDoc: Record<string, unknown> = {
      createdAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      filename: safeName,
      downloadUrl,
      storagePath,
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
      delivery,
      localPath: FieldValue.delete(),
      objectKey: FieldValue.delete(),
      supabasePath: FieldValue.delete(),
    };

    if (delivery === "supabase") {
      baseDoc.publicUrl = publicUrl || null;
      baseDoc.supabaseStorageBucket = supabaseBucketName;
      baseDoc.firebaseStorageBucket = FieldValue.delete();
    } else {
      baseDoc.firebaseStorageBucket = storageBucket.name;
      baseDoc.publicUrl = FieldValue.delete();
      baseDoc.supabaseStorageBucket = FieldValue.delete();
    }

    await docRef.set(baseDoc, { merge: true });

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: concluído com sucesso", { reportId: finalReportId, delivery });
    res.json({
      ok: true,
      reportId: finalReportId,
      downloadUrl,
      storagePath,
      publicUrl: publicUrl || null,
      uploaded: true,
      delivery,
    });
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
    console.log("[shift-reports] file GET", {
      reportId,
      firebaseBucket: storageBucket.name,
      delivery: data?.delivery,
      supabaseBucket: data?.delivery === "supabase" ? supabaseShiftReportsBucket() : undefined,
    });

    const buf = await downloadShiftReportPdfBuffer({ reportId, data });
    if (!buf?.length) {
      return res.status(404).json({
        error:
          "PDF não encontrado (Supabase ou Firebase Storage). Confirme variáveis SUPABASE_* no servidor ou regenere o relatório no app.",
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

    if (String(data?.delivery || "") === "supabase" && String(data?.storagePath || "").trim()) {
      await removeShiftReportPdfFromSupabase(String(data.storagePath).trim(), reportId);
    }

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

      const transport = isResendConfigured() ? null : getMailTransportIfConfigured();
      if (!isResendConfigured() && !transport) {
        return res.status(501).json({
          error:
            "E-mail não configurado. Opção A (recomendada no Render): RESEND_API_KEY + RESEND_FROM (domínio verificado no Resend) + ADMIN_EMAIL. " +
            "Opção B: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM e ADMIN_EMAIL.",
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
      let buffer: Buffer;
      try {
        buffer = await readPdfBufferForEmail({ reportId, data });
      } catch (pdfErr) {
        console.error("[shift-reports] send: falha ao obter PDF", pdfErr);
        const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        return res.status(500).json({
          error: `Não foi possível obter o PDF para anexar: ${msg}`,
        });
      }
      // eslint-disable-next-line no-console
      console.log("[shift_report_supabase] email attach", {
        reportId,
        to: adminEmail,
        bytes: buffer.length,
        delivery: data?.delivery,
        uploaded: data?.uploaded,
      });
      // eslint-disable-next-line no-console
      console.log("[shift-reports] send: PDF pronto", {
        reportId,
        bytes: buffer.length,
        to: adminEmail,
        provider: isResendConfigured() ? "resend" : "smtp",
      });

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

      const pdfFilename = String(data?.filename || "relatorio.pdf");

      try {
        if (isResendConfigured()) {
          await sendEmailWithPdfViaResend({
            to: adminEmail,
            subject,
            text,
            pdfFilename,
            pdfBuffer: buffer,
            reportId,
          });
        } else if (transport) {
          await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: adminEmail,
            subject,
            text,
            attachments: [
              {
                filename: pdfFilename,
                content: buffer,
                contentType: "application/pdf",
              },
            ],
          });
        }
      } catch (mailErr) {
        console.error("[shift-reports] send: falha envio e-mail", mailErr);
        const mailMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
        const hint = isResendConfigured()
          ? "Confirme RESEND_API_KEY, RESEND_FROM (domínio verificado em Resend → Domains) e o destino ADMIN_EMAIL. Veja Logs no Resend."
          : "Confirme no Render: SMTP_HOST, SMTP_PORT (587 TLS ou 465 SSL), SMTP_USER, SMTP_PASS, SMTP_FROM.";
        return res.status(500).json({
          error: `Falha ao enviar e-mail (${isResendConfigured() ? "Resend" : "SMTP"}). ${hint} Detalhe: ${mailMsg}`,
        });
      }

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
