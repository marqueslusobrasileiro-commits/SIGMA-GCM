import type express from "express";
import { admin, db } from "./firebaseAdmin";

export type FirebaseDecodedToken = admin.auth.DecodedIdToken;

function safeDecodeJwt(token: string): { header?: any; payload?: any } {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const decode = (b64url: string) => {
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
    };
    return { header: decode(parts[0]), payload: decode(parts[1]) };
  } catch {
    return {};
  }
}

function getBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function requireFirebaseAuth(
  req: express.Request,
  res: express.Response,
): Promise<FirebaseDecodedToken | null> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (err) {
    const isProd = process.env.NODE_ENV === "production";
    const allowDebugDetails = !isProd || process.env.AUTH_DEBUG === "1";
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as any)?.code as string | undefined;

    // Best-effort decode to help debug project/audience mismatches locally.
    const decoded = safeDecodeJwt(token);
    const aud = decoded.payload?.aud;
    const iss = decoded.payload?.iss;
    const email = decoded.payload?.email;

    if (allowDebugDetails) {
      // eslint-disable-next-line no-console
      console.warn("[auth] verifyIdToken failed:", { code, msg, aud, iss, email });
      res.status(401).json({
        error: "Invalid token",
        details: { code, message: msg, aud, iss, email },
      });
      return null;
    }

    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

export async function requireRoleOrRespond(
  req: express.Request,
  res: express.Response,
  allowedRoles: Array<"admin" | "supervisor" | "command">,
): Promise<{ decoded: FirebaseDecodedToken; role: "admin" | "supervisor" | "command" } | null> {
  const decoded = await requireFirebaseAuth(req, res);
  if (!decoded) return null;

  const snap = await db.collection("users").doc(decoded.uid).get();
  const role = (snap.exists ? (snap.data() as any)?.role : null) as
    | "admin"
    | "supervisor"
    | "command"
    | null;

  if (!role || !allowedRoles.includes(role)) {
    res.status(403).json({ error: "Insufficient permissions" });
    return null;
  }
  return { decoded, role };
}

