import type express from "express";
import { admin, db } from "../lib/firebaseAdmin";
import { requireRoleOrRespond } from "../lib/httpAuth";

type UserStatus = "PENDENTE" | "ATIVO" | "BLOQUEADO" | "DESATIVADO";
type UserRole = "agent" | "supervisor" | "admin" | "command";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const SUPER_ADMIN_EMAIL = normalizeEmail(process.env.SUPER_ADMIN_EMAIL || "andersonf.g.marques@gmail.com");

async function isSuperAdminTarget(uid: string): Promise<boolean> {
  // Prefer Firestore profile (fast), fallback to Auth record if needed.
  const snap = await db.collection("users").doc(uid).get().catch(() => null);
  const emailFromProfile = snap?.exists ? normalizeEmail((snap.data() as any)?.email ?? "") : "";
  if (emailFromProfile) return emailFromProfile === SUPER_ADMIN_EMAIL;
  try {
    const u = await admin.auth().getUser(uid);
    const e = normalizeEmail(u.email ?? "");
    return e === SUPER_ADMIN_EMAIL;
  } catch {
    return false;
  }
}

export function registerAdminUserRoutes(app: express.Express) {
  // Create user (Firebase Auth + Firestore profile)
  app.post("/api/admin/create-user", async (req, res) => {
    const authz = await requireRoleOrRespond(req, res, ["admin", "supervisor", "command"]);
    if (!authz) return;

    const { name, registration, email, password, role } = req.body ?? {};
    if (typeof name !== "string" || name.trim().length < 3) {
      return res.status(400).json({ error: "Invalid name" });
    }
    if (typeof registration !== "string" || registration.trim().length < 3) {
      return res.status(400).json({ error: "Invalid registration" });
    }
    if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: "Invalid password" });
    }
    const allowedRoles = new Set<UserRole>(["agent", "supervisor", "admin", "command"]);
    if (typeof role !== "string" || !allowedRoles.has(role as UserRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (role === "admin" && authz.role !== "admin") {
      return res.status(403).json({ error: "Only admin can create admin users" });
    }

    const normalizedEmail = normalizeEmail(email);
    const status: UserStatus = "PENDENTE";

    const upsertPendingProfile = async (uid: string, existed: boolean) => {
      await db.collection("users").doc(uid).set(
        {
          uid,
          name: name.trim(),
          registration: registration.trim(),
          role,
          status,
          email: normalizedEmail,
          biometricEnabled: false,
          failedAttempts: 0,
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );

      // Internal notification for admin review
      void db.collection("notifications").add({
        type: "USER_PENDING",
        message: `${existed ? "Usuário já existente solicitou aprovação" : "Novo usuário cadastrado"}: ${name
          .trim()} (${registration.trim()}) - ${normalizedEmail}`,
        targetRole: "admin",
        read: false,
        createdAt: new Date().toISOString(),
      });

      res.json({ ok: true, uid, existed });
    };

    try {
      const userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        password,
        displayName: name.trim(),
      });
      await upsertPendingProfile(userRecord.uid, false);
      return;
    } catch (e) {
      const code = (e as any)?.code as string | undefined;
      const msg = e instanceof Error ? e.message : String(e);

      // If the email already exists in Auth, reuse that user and create/ensure PENDENTE profile.
      const looksLikeDuplicateEmail =
        code === "auth/email-already-exists" ||
        code === "auth/email-already-in-use" ||
        /email/i.test(msg) && (/already exists/i.test(msg) || /already in use/i.test(msg));

      if (looksLikeDuplicateEmail) {
        try {
          const existing = await admin.auth().getUserByEmail(normalizedEmail);
          await upsertPendingProfile(existing.uid, true);
          return;
        } catch (inner) {
          const innerMsg = inner instanceof Error ? inner.message : String(inner);
          res.status(400).json({ error: innerMsg });
          return;
        }
      }

      res.status(400).json({ error: msg });
      return;
    }
  });

  // List pending users (admin only)
  const listPending = async (req: express.Request, res: express.Response) => {
    const authz = await requireRoleOrRespond(req, res, ["admin"]);
    if (!authz) return;

    const snap = await db.collection("users").where("status", "==", "PENDENTE").get();
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    if (process.env.NODE_ENV !== "production") {
      console.log("[admin] pending-users:", users.length);
    }

    res.json({
      users: snap.docs.map((d) => ({ uid: d.id, ...d.data() })),
    });
  };

  // Backward/PRD-compatible path
  app.get("/admin/pending-users", listPending);
  // Current API path used by the app
  app.get("/api/admin/pending-users", listPending);

  // Update user status
  app.patch("/api/admin/users/:uid/status", async (req, res) => {
    const authz = await requireRoleOrRespond(req, res, ["admin"]);
    if (!authz) return;

    const { uid } = req.params;
    if (await isSuperAdminTarget(uid)) {
      return res.status(403).json({ error: "Cannot change status of master admin" });
    }
    const { status } = req.body ?? {};
    const allowed = new Set<UserStatus>(["PENDENTE", "ATIVO", "BLOQUEADO", "DESATIVADO"]);
    if (typeof status !== "string" || !allowed.has(status as UserStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Update Firestore profile status
    await db.collection("users").doc(uid).set({ status }, { merge: true });

    // Keep Auth aligned: disable if blocked/deactivated, enable if active
    if (status === "BLOQUEADO" || status === "DESATIVADO") {
      await admin.auth().updateUser(uid, { disabled: true });
    } else if (status === "ATIVO") {
      await admin.auth().updateUser(uid, { disabled: false });
    }

    void db.collection("audit_logs").add({
      adminId: authz.decoded.uid,
      adminEmail: authz.decoded.email ?? null,
      action: "USER_STATUS_CHANGE",
      targetUserId: uid,
      details: `Status alterado para ${status}`,
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  });

  // Update user role
  app.patch("/api/admin/users/:uid/role", async (req, res) => {
    const authz = await requireRoleOrRespond(req, res, ["admin"]);
    if (!authz) return;

    const { uid } = req.params;
    if (await isSuperAdminTarget(uid)) {
      return res.status(403).json({ error: "Cannot change role of master admin" });
    }
    const { role } = req.body ?? {};
    const allowed = new Set<UserRole>(["agent", "supervisor", "admin", "command"]);
    if (typeof role !== "string" || !allowed.has(role as UserRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    // Only admins can set role=admin (already enforced by requireRoleOrRespond).

    await db.collection("users").doc(uid).set({ role }, { merge: true });
    void db.collection("audit_logs").add({
      adminId: authz.decoded.uid,
      adminEmail: authz.decoded.email ?? null,
      action: "USER_ROLE_CHANGE",
      targetUserId: uid,
      details: `Role alterada para ${role}`,
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  });

  // Delete user (Auth + Firestore)
  app.delete("/api/admin/users/:uid", async (req, res) => {
    const authz = await requireRoleOrRespond(req, res, ["admin"]);
    if (!authz) return;

    // Apenas o admin mestre pode excluir usuários.
    const requesterEmail = normalizeEmail(authz.decoded.email ?? "");
    if (!requesterEmail || requesterEmail !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: "Only master admin can delete users" });
    }

    const { uid } = req.params;
    if (await isSuperAdminTarget(uid)) {
      return res.status(403).json({ error: "Cannot delete master admin" });
    }
    await db.collection("users").doc(uid).delete();
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {
      // If auth user doesn't exist (edge cases), still consider profile deleted.
      console.warn("Failed to delete Auth user:", e);
    }

    void db.collection("audit_logs").add({
      adminId: authz.decoded.uid,
      adminEmail: authz.decoded.email ?? null,
      action: "USER_DELETE",
      targetUserId: uid,
      details: "Usuário excluído",
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  });
}

