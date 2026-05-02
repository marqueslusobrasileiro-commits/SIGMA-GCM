import type express from "express";
import { db } from "../lib/firebaseAdmin";
import { requireFirebaseAuth } from "../lib/httpAuth";

type UserStatus = "PENDENTE" | "ATIVO" | "BLOQUEADO" | "DESATIVADO";
type UserRole = "agent" | "supervisor" | "admin" | "command";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function registerRegistrationRoutes(app: express.Express) {
  // Ensure the current authenticated user has a Firestore profile as PENDENTE.
  // This is used when a user requests access via "Cadastre-se".
  app.post("/api/registration/request", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const body = (req.body ?? {}) as any;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const registration = typeof body.registration === "string" ? body.registration.trim() : "";

    const uid = decoded.uid;
    const email = normalizeEmail((decoded.email ?? body.email ?? "").toString());

    if (!uid) return res.status(400).json({ error: "Missing uid" });
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Missing email" });

    const docRef = db.collection("users").doc(uid);
    const snap = await docRef.get();
    const existing = snap.exists ? (snap.data() as any) : null;

    // Do not downgrade active users back to PENDENTE.
    const existingStatus = (existing?.status as UserStatus | undefined) ?? undefined;
    const status: UserStatus = existingStatus === "ATIVO" ? "ATIVO" : "PENDENTE";

    const role: UserRole =
      (existing?.role as UserRole | undefined) ??
      // Never let self-registration become admin/supervisor/command.
      "agent";

    await docRef.set(
      {
        uid,
        email,
        name: name || existing?.name || email.split("@")[0],
        registration: registration || existing?.registration || "",
        role: role === "admin" ? "agent" : role,
        status,
        biometricEnabled: existing?.biometricEnabled ?? false,
        failedAttempts: existing?.failedAttempts ?? 0,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      },
      { merge: true },
    );

    // Create internal notification for admin review only if pending.
    if (status === "PENDENTE") {
      const message = `Novo cadastro pendente: ${name || existing?.name || "(sem nome)"} (${
        registration || existing?.registration || "(sem matrícula)"
      }) - ${email}`;

      void db.collection("notifications").add({
        type: "USER_PENDING",
        message,
        targetRole: "admin",
        read: false,
        createdAt: new Date().toISOString(),
        userId: uid,
      });
    }

    res.json({ ok: true, status });
  });
}

