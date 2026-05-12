function envStr(name: string): string {
  return String(process.env[name] || "").trim();
}

export type SupabaseStorageConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

export function getSupabaseStorageConfigFromEnv(): SupabaseStorageConfig | null {
  const url = envStr("SUPABASE_URL");
  const serviceRoleKey = envStr("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = envStr("SUPABASE_STORAGE_BUCKET") || "sigma-pdfs";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, bucket };
}

function asUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function buildObjectUrl(cfg: SupabaseStorageConfig, path: string) {
  const base = cfg.url.replace(/\/$/, "");
  const b = encodeURIComponent(cfg.bucket);
  // path NÃO deve ser encodeado inteiro; encode por segmento para manter "/"
  const safePath = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${base}/storage/v1/object/${b}/${safePath}`;
}

export async function putPdfSupabase(opts: {
  path: string;
  pdf: Buffer;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = getSupabaseStorageConfigFromEnv();
  if (!cfg) return { ok: false, error: "Supabase Storage não configurado (env vars ausentes)." };

  try {
    const url = buildObjectUrl(cfg, opts.path);
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
          apikey: cfg.serviceRoleKey,
          "content-type": "application/pdf",
          "cache-control": "no-store",
          "x-upsert": "true",
        },
        body: asUint8(opts.pdf),
      },
      25_000,
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status} ${resp.statusText}: ${txt}`.trim() };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPdfSupabase(opts: {
  path: string;
}): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string }> {
  const cfg = getSupabaseStorageConfigFromEnv();
  if (!cfg) return { ok: false, error: "Supabase Storage não configurado (env vars ausentes)." };

  try {
    const url = buildObjectUrl(cfg, opts.path);
    const resp = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
          apikey: cfg.serviceRoleKey,
        },
      },
      25_000,
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status} ${resp.statusText}: ${txt}`.trim() };
    }
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!buf.length) return { ok: false, error: "Objeto retornou vazio." };
    return { ok: true, pdf: buf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

