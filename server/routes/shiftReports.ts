import type express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
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

async function ensureUploadDir() {
  const dir = path.resolve(process.cwd(), "server", "uploads", "shift_reports");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function inferStoragePathFromDoc(opts: { reportId: string; data: any }): string | null {
  const { reportId, data } = opts;
  const explicit = String(data?.storagePath || "").trim();
  if (explicit) return explicit;
  const agentId = String(data?.agentId || "").trim();
  if (agentId) return `shift_reports/${agentId}/${reportId}.pdf`;
  return null;
}

async function tryReadPdfFromStorage(opts: { reportId: string; data: any }): Promise<Buffer | null> {
  const storagePath = inferStoragePathFromDoc(opts);
  if (!storagePath) return null;
  try {
    const [buf] = await storageBucket.file(storagePath).download();
    if (!buf?.length) return null;
    return buf;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[shift-reports] storage fallback failed", {
      reportId: opts.reportId,
      storagePath,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function absolutizeDownloadUrl(downloadUrl: string, req?: express.Request): string | null {
  const u = String(downloadUrl || "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;

  const envBase = String(process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/$/, "");
  const reqBase =
    req && req.get("host")
      ? `${String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https"}://${req.get("host")}`.replace(
          /\/$/,
          "",
        )
      : "";

  const base = (envBase || reqBase).replace(/\/$/, "");
  if (!base) return null;
  if (!u.startsWith("/")) return `${base}/${u}`;
  return `${base}${u}`;
}

async function readPdfBufferForEmail(opts: {
  reportId: string;
  data: any;
  authHeader: string | undefined;
  req?: express.Request;
}): Promise<Buffer> {
  const { reportId, data, authHeader, req } = opts;

  const filePath = String(data?.localPath || "").trim();
  if (filePath) {
    try {
      return await fs.readFile(filePath);
    } catch (e: any) {
      const code = e?.code as string | undefined;
      if (code !== "ENOENT") throw e;
      // eslint-disable-next-line no-console
      console.warn("[shift-reports] localPath missing on disk; will try downloadUrl fallback", {
        reportId,
        filePath,
      });
    }
  }

  const downloadAbs = absolutizeDownloadUrl(String(data?.downloadUrl || ""), req);
  if (downloadAbs) {
    const resp = await fetch(downloadAbs, {
      method: "GET",
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Falha ao baixar PDF pela downloadUrl (HTTP ${resp.status}). ${txt}`.trim());
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) throw new Error("PDF baixado está vazio.");
    return buf;
  }

  throw new Error(
    "Arquivo do relatório não está disponível no servidor (disco efêmero) e não foi possível resolver downloadUrl para baixar o PDF. Reenvie o relatório (upload) ou verifique host/proxy do servidor.",
  );
}

export function registerShiftReportRoutes(app: express.Express) {
  // Upload obrigatório do relatório (PDF base64) para o servidor.
  // O servidor salva o arquivo e registra/atualiza o documento em shift_reports com um downloadUrl.
  app.post("/api/shift-reports/upload", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload request received", {
      hasAuth: !!req.headers.authorization,
      contentLength: req.headers["content-length"],
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

    const dir = await ensureUploadDir();
    const safeName = String(filename).replace(/[^\w.\-() ]/g, "_");
    const filePath = path.join(dir, `${finalReportId}__${safeName}`);
    const buffer = Buffer.from(String(pdfBase64), "base64");
    await fs.writeFile(filePath, buffer);

    const downloadUrl = `/api/shift-reports/file/${encodeURIComponent(finalReportId)}`;
    const storagePath = `shift_reports/${decoded.uid}/${finalReportId}.pdf`;

    // Persistência: também salva no Firebase Storage para sobreviver a redeploy/restart do Render.
    try {
      await storageBucket.file(storagePath).save(buffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          cacheControl: "private, max-age=0, no-transform",
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[shift-reports] upload: falha ao salvar no Storage (continuando com localPath)", {
        reportId: finalReportId,
        storagePath,
        err: e instanceof Error ? e.message : String(e),
      });
    }

    await docRef.set(
      {
        createdAt: new Date().toISOString(),
        filename: safeName,
        downloadUrl,
        storagePath,
        localPath: filePath,
        // Se esse reportId já existia e estava na lixeira, ao re-enviar deve voltar para "Ativos".
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
        delivery: "server",
      },
      { merge: true },
    );

    res.json({ ok: true, reportId: finalReportId, downloadUrl });
  });

  // Download do PDF salvo no servidor.
  app.get("/api/shift-reports/file/:reportId", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isAtivo(access)) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const reportId = String(req.params.reportId || "");
    if (!reportId) return res.status(400).send("missing reportId");

    const snap = await db.collection("shift_reports").doc(reportId).get();
    if (!snap.exists) return res.status(404).send("not found");
    const data = snap.data() as any;

    const ownerUid = String(data?.agentId || "");
    if (!isAdmin(access) && decoded.uid !== ownerUid) {
      return res.status(403).send("forbidden");
    }

    let filePath = String(data?.localPath || "");
    if (!filePath) {
      // Tentativa de recuperação: o cliente pode ter sobrescrito o doc e apagado o localPath.
      // Procuramos por um arquivo salvo no padrão "<reportId>__<filename>".
      try {
        const dir = await ensureUploadDir();
        const files = await fs.readdir(dir);
        const match = files.find((f) => f.startsWith(`${reportId}__`));
        if (match) {
          filePath = path.join(dir, match);
          await snap.ref.set(
            {
              localPath: filePath,
              filename: match.split("__").slice(1).join("__") || data?.filename || "relatorio.pdf",
              downloadUrl: `/api/shift-reports/file/${encodeURIComponent(reportId)}`,
              delivery: "server",
            },
            { merge: true },
          );
        } else {
          // Segunda tentativa: alguns docs antigos foram criados com ID aleatório (addDoc),
          // mas o arquivo foi salvo com ID determinístico: "<agentId>_<teamId>_<windowStart>__...".
          const agentId = String(data?.agentId || "");
          const teamId = String(data?.teamId || "");
          const windowStart = String(data?.windowStart || "");
          const deterministicId =
            agentId && teamId && windowStart
              ? `${agentId}_${teamId}_${windowStart.replace(/[:.]/g, "-")}`
              : "";
          if (deterministicId) {
            const match2 = files.find((f) => f.startsWith(`${deterministicId}__`));
            if (match2) {
              filePath = path.join(dir, match2);
              await snap.ref.set(
                {
                  localPath: filePath,
                  filename: match2.split("__").slice(1).join("__") || data?.filename || "relatorio.pdf",
                  // mantém a URL do doc atual (id aleatório), mas passa a funcionar.
                  downloadUrl: `/api/shift-reports/file/${encodeURIComponent(reportId)}`,
                  delivery: "server",
                },
                { merge: true },
              );
            }
          }
        }
      } catch (e) {
        console.warn("[shift-reports] recovery failed", e);
      }
    }
    if (!filePath) return res.status(404).send("file not available");

    try {
      const file = await fs.readFile(filePath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${String(data?.filename || "relatorio.pdf")}"`);
      res.send(file);
    } catch (e) {
      console.error("[shift-reports] file read failed", e);

      // Fallback 1: Firebase Storage (persistente) via Admin SDK
      const fromStorage = await tryReadPdfFromStorage({ reportId, data });
      if (fromStorage?.length) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${String(data?.filename || "relatorio.pdf")}"`);
        return res.send(fromStorage);
      }

      // Fallback: se o relatório veio do Firebase Storage (delivery=storage), o disco do Render não terá o arquivo.
      // Tentamos baixar pelo `downloadUrl` absoluto quando ele NÃO aponta para esta mesma rota.
      try {
        const downloadAbs = absolutizeDownloadUrl(String(data?.downloadUrl || ""), req);
        const selfPrefix = `/api/shift-reports/file/${encodeURIComponent(reportId)}`;
        const isSelf =
          !!downloadAbs &&
          (downloadAbs.endsWith(selfPrefix) ||
            downloadAbs.includes(`/api/shift-reports/file/${encodeURIComponent(reportId)}`));

        if (downloadAbs && /^https?:\/\//i.test(downloadAbs) && !isSelf) {
          // eslint-disable-next-line no-console
          console.warn("[shift-reports] fallback downloadUrl", { reportId, downloadAbs });
          const resp = await fetch(downloadAbs, { method: "GET" });
          if (!resp.ok) {
            const txt = await resp.text().catch(() => "");
            throw new Error(`downloadUrl HTTP ${resp.status}. ${txt}`.trim());
          }
          const buf = Buffer.from(await resp.arrayBuffer());
          if (!buf.length) throw new Error("downloadUrl retornou PDF vazio.");
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `inline; filename="${String(data?.filename || "relatorio.pdf")}"`);
          return res.send(buf);
        }
      } catch (fallbackErr) {
        console.error("[shift-reports] fallback downloadUrl failed", fallbackErr);
      }

      res.status(500).send("file read failed");
    }
  });

  // Mover para Lixeira (somente ADM MASTER). Não remove arquivo nem doc.
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

  // Restaurar da Lixeira (somente ADM MASTER)
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

  // Excluir definitivamente (somente ADM MASTER). Remove doc e arquivo local (se existir).
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

    const filePath = String(data?.localPath || "");
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn("[shift-reports] purge: falha ao remover arquivo local", { filePath, err: String(e?.message || e) });
      }
    }

    await ref.delete();
    res.json({ ok: true });
  });

  // Compatibilidade: DELETE antigo agora move para a lixeira.
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

  // Envio opcional por e-mail (somente ADM MASTER) usando o arquivo salvo no servidor.
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

      const buffer = await readPdfBufferForEmail({
        reportId,
        data,
        authHeader: req.headers.authorization,
        req,
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

      res.json({ ok: true });
    } catch (err) {
      console.error("[shift-reports] send(manual) failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg || "Falha ao enviar e-mail." });
    }
  });

  // Recebe um PDF (base64) e envia para o ADM MASTER por e-mail, gravando metadados no Firestore.
  app.post("/api/shift-reports/send", async (req, res) => {
    // Essa rota era do fluxo antigo (envio automático por e-mail).
    // Agora o fluxo correto é: /upload (obrigatório para o painel) + /send/:reportId (manual pelo ADM).
    return res.status(410).json({
      error:
        "Rota desativada. Use /api/shift-reports/upload para registrar no painel. O envio por e-mail é manual via /api/shift-reports/send/:reportId.",
    });
  });
}

