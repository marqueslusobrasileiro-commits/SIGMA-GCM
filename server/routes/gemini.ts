import type express from "express";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebaseAdmin";
import { requireFirebaseAuth } from "../lib/httpAuth";
import { withTimeout } from "../lib/asyncUtils";
import { checkRateLimitOrRespond, getClientIp } from "../lib/rateLimit";

export function registerGeminiRoutes(app: express.Express) {
  app.post("/api/gemini/generate", async (req, res) => {
    const decoded = await requireFirebaseAuth(req, res);
    if (!decoded) return;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const { prompt, model } = req.body ?? {};
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ error: "Missing prompt" });
    }
    if (prompt.length > 20_000) {
      return res.status(400).json({ error: "Prompt too large" });
    }

    const ALLOWED_GEMINI_MODELS = new Set(["gemini-2.0-flash"]);
    const requestedModel = typeof model === "string" ? model.trim() : "";
    if (requestedModel.length > 0) {
      if (requestedModel.length > 64 || !/^[a-z0-9.\-_]+$/i.test(requestedModel)) {
        return res.status(400).json({ error: "Invalid model" });
      }
      if (!ALLOWED_GEMINI_MODELS.has(requestedModel)) {
        return res.status(400).json({ error: "Model not allowed" });
      }
    }
    const selectedModel = requestedModel || "gemini-2.0-flash";

    const ip = getClientIp(req);
    const rateKey = `gemini:${decoded.uid}:${ip}`;
    // Conservative default: 30 req / 10 min per user+ip
    if (
      !checkRateLimitOrRespond(req, res, {
        key: rateKey,
        limit: 30,
        windowMs: 10 * 60 * 1000,
        cleanupMaxAgeMs: 60 * 60 * 1000,
      })
    ) {
      return;
    }

    const startedAt = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await withTimeout(
        ai.models.generateContent({
          model: selectedModel,
          contents: prompt,
        }),
        25_000,
      );

      const text = response.text;
      void db.collection("gemini_logs").add({
        uid: decoded.uid,
        email: decoded.email ?? null,
        ip,
        model: selectedModel,
        promptLength: prompt.length,
        ok: true,
        durationMs: Date.now() - startedAt,
        ts: new Date().toISOString(),
      });

      res.json({ text });
    } catch (error) {
      console.error(error);
      void db.collection("gemini_logs").add({
        uid: decoded.uid,
        email: decoded.email ?? null,
        ip,
        model: selectedModel,
        promptLength: typeof prompt === "string" ? prompt.length : null,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      });
      if (error instanceof Error && error.message === "TIMEOUT") {
        res.status(504).json({ error: "Gemini request timed out" });
      } else {
        res.status(500).json({ error: "Gemini request failed" });
      }
    }
  });
}

