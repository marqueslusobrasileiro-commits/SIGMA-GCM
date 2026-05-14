import type express from "express";
import nodemailer from "nodemailer";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { requireFirebaseAuth } from "../lib/httpAuth";
import { createSignedPdfUrl, supabase } from "../lib/supabaseStorage";
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

/** Caminho canónico no bucket Supabase: relatorios/AAAA/MM/uid/reportId.pdf */
function buildRelatorioStoragePath(uid: string, reportId: string, windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  return `relatorios/${yyyy}/${mm}/${uid}/${reportId}.pdf`;
}

/** Caminhos candidatos apenas no Supabase Storage (sem Firebase). */
function collectSupabaseObjectPaths(reportId: string, data: any): string[] {
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

/**
 * Obtém o PDF no servidor (e-mail, etc.) via Supabase SDK + service role.
 */
async function downloadShiftReportPdfBuffer(opts: { reportId: string; data: any }): Promise<Buffer | null> {
  const { reportId, data } = opts;
  if (!isSupabaseShiftReportsConfigured()) return null;

  for (const objectPath of collectSupabaseObjectPaths(reportId, data)) {
    const buf = await downloadShiftReportPdfFromSupabase(objectPath, reportId);
    if (buf?.length) return buf;
  }
  return null;
}

async function readPdfBufferForEmail(opts: { reportId: string; data: any }): Promise<Buffer> {
  const { reportId, data } = opts;

  if (!isSupabaseShiftReportsConfigured()) {
    throw new Error(
      "Supabase não configurado no servidor. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (e SUPABASE_STORAGE_BUCKET) no Render.",
    );
  }

  const buf = await downloadShiftReportPdfBuffer(opts);
  if (buf?.length) return buf;

  const sp = String(data?.storagePath || "").trim();
  const bucket = supabaseShiftReportsBucket();
  throw new Error(
    "O PDF não foi encontrado no Supabase. Confirme o bucket \"" +
      bucket +
      "\", o objeto \"" +
      (sp || collectSupabaseObjectPaths(reportId, data).join(", ") || "(sem caminho)") +
      "\" e regenere o relatório no app se necessário.",
  );
}

export function registerShiftReportRoutes(app: express.Express) {
  app.post("/api/shift-reports/upload", async (req, res) => {
    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload request received", {
      hasAuth: !!req.headers.authorization,
      contentLength: req.headers["content-length"],
      supabase: !!supabase,
      bucket: supabaseShiftReportsBucket(),
    });
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const access = await getUserAccess(decoded.uid);
    if (!isAtivo(access)) {
      return res.status(403).json({ error: "Acesso negado (usuário não ATIVO)." });
    }

    if (!isSupabaseShiftReportsConfigured()) {
      return res.status(503).json({
        error:
          "Supabase Storage não configurado. Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_STORAGE_BUCKET no servidor.",
      });
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

    const up = await uploadShiftReportPdfToSupabase({
      buffer,
      objectPath: storagePath,
      reportId: finalReportId,
    });
    if (!up?.storagePath) {
      return res.status(500).json({
        error: "Falha ao gravar o PDF no Supabase Storage. Verifique bucket, políticas e variáveis SUPABASE_*.",
      });
    }

    const supabaseBucketName = supabaseShiftReportsBucket();
    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: Supabase Storage", {
      reportId: finalReportId,
      bucket: supabaseBucketName,
      storagePath: up.storagePath,
      bytes: buffer.length,
    });

    await docRef.set(
      {
        createdAt: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        filename: safeName,
        downloadUrl: apiFileUrl,
        publicUrl: null,
        storagePath: up.storagePath,
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
        delivery: "supabase",
        supabaseStorageBucket: supabaseBucketName,
        firebaseStorageBucket: FieldValue.delete(),
        localPath: FieldValue.delete(),
        objectKey: FieldValue.delete(),
        supabasePath: FieldValue.delete(),
      },
      { merge: true },
    );

    // eslint-disable-next-line no-console
    console.log("[shift-reports] upload: concluído", { reportId: finalReportId });
    res.json({
      ok: true,
      reportId: finalReportId,
      downloadUrl: apiFileUrl,
      storagePath: up.storagePath,
      publicUrl: null,
      uploaded: true,
      delivery: "supabase",
    });
  });

  /**
   * Download: redireciona para URL assinada do Supabase (bucket privado).
   * Query opcional: ?stream=1 — devolve o PDF no corpo (útil se o redirect falhar por CORS em algum cliente).
   */
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

    if (!isSupabaseShiftReportsConfigured() || !supabase) {
      return res.status(503).json({ error: "Supabase não configurado no servidor." });
    }

    const wantStream = String(req.query.stream || "") === "1";

    // eslint-disable-next-line no-console
    console.log("[shift-reports] file GET", {
      reportId,
      delivery: data?.delivery,
      bucket: supabaseShiftReportsBucket(),
      redirectSigned: !wantStream,
    });

    if (!wantStream) {
      for (const objectPath of collectSupabaseObjectPaths(reportId, data)) {
        const signed = await createSignedPdfUrl(objectPath, 3600);
        if (signed) {
          // eslint-disable-next-line no-console
          console.log("[shift-reports] file GET redirect signed URL", { reportId, pathPrefix: objectPath.slice(0, 48) });
          return res.redirect(302, signed);
        }
      }
    }

    const buf = await downloadShiftReportPdfBuffer({ reportId, data });
    if (!buf?.length) {
      return res.status(404).json({
        error:
          "PDF não encontrado no Supabase. Confirme storagePath no Firestore, o bucket e regenere o relatório.",
      });
    }

    // eslint-disable-next-line no-console
    console.log("[shift-reports] file GET: stream PDF", { reportId, bytes: buf.length });
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

    for (const p of collectSupabaseObjectPaths(reportId, data)) {
      await removeShiftReportPdfFromSupabase(p, reportId);
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
