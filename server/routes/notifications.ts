import type express from "express";
import nodemailer from "nodemailer";
import { db } from "../lib/firebaseAdmin";
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

export function registerNotificationRoutes(app: express.Express) {
  // Called after a user completes registration and creates a Firestore profile as PENDENTE.
  app.post("/api/notifications/pending-user", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const profileSnap = await db.collection("users").doc(decoded.uid).get();
    if (!profileSnap.exists) {
      return res.status(404).json({ error: "Profile not found" });
    }
    const profile = profileSnap.data() as any;

    // Only send notifications for pending users (avoid noise)
    if (profile?.status !== "PENDENTE") {
      return res.json({ ok: true, skipped: true });
    }

    const message = `Novo cadastro pendente: ${profile?.name || "(sem nome)"} (${
      profile?.registration || "(sem matrícula)"
    }) - ${profile?.email || decoded.email || "(sem e-mail)"}`;

    await db.collection("notifications").add({
      type: "USER_PENDING",
      message,
      targetRole: "admin",
      read: false,
      createdAt: new Date().toISOString(),
      userId: decoded.uid,
    });

    // Optional e-mail to admins (best effort, only if SMTP configured)
    const transport = getMailTransportIfConfigured();
    const adminEmail = process.env.ADMIN_EMAIL;
    if (transport && adminEmail) {
      try {
        await transport.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: adminEmail,
          subject: "SIGMA-GCM - Novo cadastro pendente",
          text: message,
        });
      } catch (err) {
        console.warn("Failed to send pending-user email:", err);
      }
    }

    res.json({ ok: true });
  });
}

