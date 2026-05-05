import { Capacitor } from "@capacitor/core";

declare const __API_BASE_URL__: string | undefined;

function isHttpProtocol(p: string): boolean {
  return p === "http:" || p === "https:";
}

function defaultTimeoutMsForPath(pathname: string): number {
  // Rotas que podem demorar (SMTP / cold start do Render).
  if (pathname.includes("/api/shift-reports/send")) return 180_000;
  if (pathname.includes("/api/shift-reports/upload")) return 180_000;
  return 60_000;
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") {
    const signal = (AbortSignal as any).timeout(ms) as AbortSignal;
    return await fetch(url, { ...(init || {}), signal });
  }

  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Resolve a URL base do backend.
 *
 * - Web (Edge/preview): usa `window.location.origin`
 * - App nativo (Capacitor): exige `VITE_API_BASE_URL` (ex.: https://api.seudominio.com)
 */
export function getApiBaseUrl(): string | null {
  // IMPORTANTE: precisa ser acesso direto (`import.meta.env.VITE_*`)
  // para o Vite injetar/substituir o valor no build.
  const configured = __API_BASE_URL__ || (import.meta.env.VITE_API_BASE_URL as string | undefined);
  if (configured && configured.trim()) return configured.trim().replace(/\/$/, "");

  // No app nativo (APK), `window.location.origin` costuma ser `http://localhost`
  // (servidor interno do WebView) e NÃO é o seu backend. Então aqui exigimos
  // `VITE_API_BASE_URL` para evitar baixar HTML do app em vez do PDF.
  if (Capacitor.isNativePlatform()) return null;

  if (typeof window !== "undefined" && isHttpProtocol(window.location.protocol)) {
    return window.location.origin;
  }

  return null;
}

export function apiUrl(pathname: string): string {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error(
      "Backend não configurado no app nativo. Defina VITE_API_BASE_URL (ex.: https://seu-backend.com) e gere o APK novamente.",
    );
  }
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${p}`;
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/")) {
    const url = apiUrl(input);
    const ms = defaultTimeoutMsForPath(input);
    return await fetchWithTimeout(url, init, ms);
  }
  return await fetch(input as any, init);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(String(msg));
}

export type ApiRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function backoffDelayMs(attempt: number, opts?: ApiRetryOptions): number {
  const base = Math.max(200, opts?.baseDelayMs ?? 600);
  const max = Math.max(base, opts?.maxDelayMs ?? 4000);
  const exp = Math.min(max, Math.round(base * Math.pow(2, Math.max(0, attempt - 1))));
  const jitter = Math.round(exp * (0.2 * Math.random()));
  return Math.min(max, exp + jitter);
}

/**
 * API externa fixa (Render) para chamadas que NÃO podem depender de `localhost`.
 * Útil para ações de e-mail (SMTP) onde o front pode estar rodando em outro host/origem.
 */
export function getExternalApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_EXTERNAL_API_BASE_URL as string | undefined)?.trim();
  const base = configured || "https://sigma-gcm.onrender.com";
  return base.replace(/\/$/, "");
}

export async function apiFetchExternal(pathname: string, init?: RequestInit, retry?: ApiRetryOptions): Promise<Response> {
  const base = getExternalApiBaseUrl();
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = `${base}${p}`;
  const ms = defaultTimeoutMsForPath(p);
  const retries = Math.max(0, retry?.retries ?? 2);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, ms);
      return res;
    } catch (e) {
      lastErr = e;
      console.error("[apiFetchExternal] erro de rede", {
        attempt,
        retries,
        url,
        message: e instanceof Error ? e.message : String(e),
      });
      if (!isNetworkError(e) || attempt > retries) break;
      await sleepMs(backoffDelayMs(attempt, retry));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "Failed to fetch"));
}
