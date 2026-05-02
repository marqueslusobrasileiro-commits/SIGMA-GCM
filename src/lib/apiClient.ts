import { Capacitor } from "@capacitor/core";

declare const __API_BASE_URL__: string | undefined;

function isHttpProtocol(p: string): boolean {
  return p === "http:" || p === "https:";
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
    return await fetch(apiUrl(input), init);
  }
  return await fetch(input as any, init);
}

