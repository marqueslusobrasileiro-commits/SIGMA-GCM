import type express from "express";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { admin } from "../lib/firebaseAdmin";

const pendingExchanges = new Map<string, { token: string; exp: number }>();

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of pendingExchanges) {
    if (now > v.exp) pendingExchanges.delete(k);
  }
}

function publicOrigin(req: express.Request): string {
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || req.protocol || "http";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

function isSecureRequest(req: express.Request): boolean {
  const p = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(p) ? p[0] : p;
  return proto === "https" || req.secure === true;
}

/**
 * Login Google na web via servidor: evita auth/unauthorized-domain do SDK no browser.
 *
 * Render: GOOGLE_OAUTH_CLIENT_SECRET (secret do cliente OAuth Web no GCP).
 * GCP → Credenciais → redirect: https://<host>/api/auth/google/callback
 */
export function registerGoogleWebAuthRoutes(app: express.Express): void {
  const clientId =
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    "343507031983-64oi12lm43bvgj1cu7lb7jca9uvnisgd.apps.googleusercontent.com";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

  app.get("/api/auth/google/start", (req, res) => {
    pruneExpired();
    if (!clientSecret) {
      res.status(503).send(
        "GOOGLE_OAUTH_CLIENT_SECRET não configurado. Defina no Render (Environment) o secret do cliente OAuth Web no Google Cloud.",
      );
      return;
    }

    const origin = publicOrigin(req);
    const state = crypto.randomBytes(24).toString("hex");
    const redirectUri = `${origin}/api/auth/google/callback`;

    res.cookie("g_oauth_state", state, {
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/",
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    pruneExpired();

    if (!clientSecret) {
      res.redirect(`${publicOrigin(req)}/?google_login=error`);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState = req.cookies?.g_oauth_state as string | undefined;

    if (!code || !state || !cookieState || state !== cookieState) {
      // eslint-disable-next-line no-console
      console.error("[googleWebAuth] falha CSRF/state:", {
        hasCode: !!code,
        hasStateParam: !!state,
        hasCookie: !!cookieState,
        match: state === cookieState,
      });
      res.clearCookie("g_oauth_state", { path: "/" });
      res.redirect(`${publicOrigin(req)}/?google_login=error`);
      return;
    }

    res.clearCookie("g_oauth_state", { path: "/" });

    const origin = publicOrigin(req);
    const redirectUri = `${origin}/api/auth/google/callback`;

    try {
      const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.id_token) {
        res.redirect(`${origin}/?google_login=error`);
        return;
      }

      const ticket = await oauth2.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      const email = payload?.email;
      if (!email) {
        res.redirect(`${origin}/?google_login=error`);
        return;
      }

      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch (e: unknown) {
        const codeErr = (e as { code?: string })?.code;
        if (codeErr === "auth/user-not-found") {
          userRecord = await admin.auth().createUser({
            email,
            emailVerified: true,
          });
        } else {
          throw e;
        }
      }

      const customToken = await admin.auth().createCustomToken(userRecord.uid);
      const exchangeId = crypto.randomUUID();
      pendingExchanges.set(exchangeId, {
        token: customToken,
        exp: Date.now() + 2 * 60 * 1000,
      });

      res.cookie("g_exchange", exchangeId, {
        httpOnly: true,
        secure: isSecureRequest(req),
        sameSite: "lax",
        maxAge: 2 * 60 * 1000,
        path: "/",
      });

      res.redirect(`${origin}/`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[googleWebAuth] callback erro (troca código / Firebase Admin):", msg);
      res.redirect(`${origin}/?google_login=error`);
    }
  });

  app.get("/api/auth/google/complete", (req, res) => {
    pruneExpired();
    const exchangeId = req.cookies?.g_exchange as string | undefined;
    res.clearCookie("g_exchange", { path: "/" });

    if (!exchangeId) {
      return res.status(204).end();
    }

    const pending = pendingExchanges.get(exchangeId);
    pendingExchanges.delete(exchangeId);

    if (!pending || Date.now() > pending.exp) {
      return res.status(401).json({ error: "expired" });
    }

    return res.json({ firebaseCustomToken: pending.token });
  });
}
