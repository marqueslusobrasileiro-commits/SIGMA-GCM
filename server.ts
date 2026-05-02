import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { admin, db } from "./server/lib/firebaseAdmin";
import { registerGeminiRoutes } from "./server/routes/gemini";
import { registerAdminUserRoutes } from "./server/routes/adminUsers";
import { registerNotificationRoutes } from "./server/routes/notifications";
import { registerRegistrationRoutes } from "./server/routes/registration";
import { registerShiftReportRoutes } from "./server/routes/shiftReports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "sigma-gcm-secret-key";

// CORS (necessário para o APK/Capacitor: origem costuma ser capacitor://localhost)
app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  const isApi = req.path.startsWith("/api/");
  if (!isApi) return next();

  // Em dev, liberamos origens locais e o origin do WebView (capacitor://localhost).
  // Para produção, vale restringir por allowlist.
  const allowOrigin =
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("capacitor://localhost") ||
    origin.startsWith("ionic://localhost") ||
    origin.startsWith("http://192.168.") ||
    origin.startsWith("http://10.") ||
    origin.startsWith("http://172.");

  if (allowOrigin && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    // fallback mais permissivo em dev (evita bloquear requests sem Origin)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Helper to get RP_ID and ORIGIN dynamically
const getWebAuthnConfig = (req: express.Request) => {
  const host = req.headers.host || "localhost:3000";
  const rpID = host.split(":")[0];
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const origin = `${protocol}://${host}`;
  return { rpID, origin };
};

// PDFs em base64 podem passar de 100kb; aumentamos o limite com folga.
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// Log leve para depurar rotas de relatório (dev).
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/shift-reports")) {
    // eslint-disable-next-line no-console
    console.log("[http] shift-reports", req.method, req.path, {
      hasAuth: !!req.headers.authorization,
      contentLength: req.headers["content-length"],
    });
  }
  next();
});

// In-memory challenge store (use Redis or Firestore for production)
const challenges = new Map<string, string>();

// Modular routes
registerGeminiRoutes(app);
registerAdminUserRoutes(app);
registerNotificationRoutes(app);
registerRegistrationRoutes(app);
registerShiftReportRoutes(app);

// --- WebAuthn Routes ---

app.get("/api/webauthn/register-options", async (req, res) => {
  const { userId, userName } = req.query;
  if (!userId || !userName) return res.status(400).json({ error: "Missing params" });

  const { rpID } = getWebAuthnConfig(req);

  const options = await generateRegistrationOptions({
    rpName: "SIGMA-GCM",
    rpID,
    userID: Uint8Array.from(Buffer.from(userId as string)),
    userName: userName as string,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  challenges.set(userId as string, options.challenge);
  res.json(options);
});

app.post("/api/webauthn/register-verify", async (req, res) => {
  const { body, userId } = req.body;
  const expectedChallenge = challenges.get(userId);

  if (!expectedChallenge) return res.status(400).json({ error: "Challenge not found" });

  const { rpID, origin } = getWebAuthnConfig(req);

  try {
    const verification = await verifyRegistrationResponse({
      response: body as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;

      // Store credential in Firestore
      await db.collection("credentials").doc(Buffer.from(credential.id).toString("base64url")).set({
        id: Buffer.from(credential.id).toString("base64url"),
        userId,
        publicKey: Buffer.from(credential.publicKey).toString("base64"),
        counter: credential.counter,
        transports: body.response.transports || [],
      });

      // Enable biometrics for user
      await db.collection("users").doc(userId).update({ biometricEnabled: true });

      res.json({ verified: true });
    } else {
      res.status(400).json({ error: "Verification failed" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  } finally {
    challenges.delete(userId);
  }
});

app.get("/api/webauthn/login-options", async (req, res) => {
  const { registration } = req.query;
  if (!registration) return res.status(400).json({ error: "Missing registration" });

  // Find user by registration
  const userSnap = await db.collection("users").where("registration", "==", registration).limit(1).get();
  if (userSnap.empty) return res.status(404).json({ error: "User not found" });

  const user = userSnap.docs[0].data();
  
  // Check if locked
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return res.status(403).json({ error: "Account locked temporarily" });
  }

  const credentialsSnap = await db.collection("credentials").where("userId", "==", user.uid).get();
  const allowCredentials = credentialsSnap.docs.map(doc => ({
    id: doc.id,
    type: "public-key" as const,
    transports: doc.data().transports,
  }));

  const { rpID } = getWebAuthnConfig(req);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
  });

  challenges.set(registration as string, options.challenge);
  res.json(options);
});

app.post("/api/webauthn/login-verify", async (req, res) => {
  const { body, registration } = req.body;
  const expectedChallenge = challenges.get(registration);

  if (!expectedChallenge) return res.status(400).json({ error: "Challenge not found" });

  const { rpID, origin } = getWebAuthnConfig(req);

  const userSnap = await db.collection("users").where("registration", "==", registration).limit(1).get();
  const userDoc = userSnap.docs[0];
  const user = userDoc.data();

  const credentialId = body.id;
  const credentialSnap = await db.collection("credentials").doc(credentialId).get();
  if (!credentialSnap.exists) return res.status(404).json({ error: "Credential not found" });

  const credential = credentialSnap.data()!;

  try {
    const verification = await verifyAuthenticationResponse({
      response: body as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, "base64"),
        counter: credential.counter,
      },
    });

    if (verification.verified) {
      // Update counter
      await db.collection("credentials").doc(credentialId).update({
        counter: verification.authenticationInfo.newCounter,
      });

      // Reset failed attempts
      await userDoc.ref.update({ failedAttempts: 0 });

      // Create Firebase Custom Token (client will exchange for Firebase session)
      const firebaseCustomToken = await admin.auth().createCustomToken(String(user.uid), {
        role: user.role,
      });

      // (Opcional/legado) JWT próprio do servidor
      const token = jwt.sign({ uid: user.uid, role: user.role }, JWT_SECRET, { expiresIn: "12h" });

      // Audit log
      await db.collection("login_logs").add({
        userId: user.uid,
        userName: user.name,
        timestamp: new Date().toISOString(),
        type: "Biometria",
        device: req.headers["user-agent"] || "Unknown",
        success: true,
      });

      res.json({ verified: true, token, firebaseCustomToken, profile: user });
    } else {
      // Track failed attempt
      const attempts = (user.failedAttempts || 0) + 1;
      const update: any = { failedAttempts: attempts };
      if (attempts >= 5) {
        update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min lock
      }
      await userDoc.ref.update(update);

      res.status(400).json({ error: "Verification failed" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  } finally {
    challenges.delete(registration);
  }
});

// --- Standard Login Audit ---
app.post("/api/audit-login", async (req, res) => {
  const { userId, userName, type, success } = req.body;
  
  await db.collection("login_logs").add({
    userId,
    userName,
    timestamp: new Date().toISOString(),
    type,
    device: req.headers["user-agent"] || "Unknown",
    success,
  });

  res.json({ ok: true });
});

// --- Vite Middleware ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const hmrPort = process.env.HMR_PORT ? Number(process.env.HMR_PORT) : 24679;
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Evita conflito com o padrão (24678) quando já existe outro Vite rodando.
        hmr: { port: hmrPort, clientPort: hmrPort },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[server] Falha ao iniciar:", err);
  process.exit(1);
});
