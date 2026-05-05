import { createClient } from "@supabase/supabase-js";

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
  const bucket = envStr("SUPABASE_STORAGE_BUCKET");
  if (!url || !serviceRoleKey || !bucket) return null;
  return { url, serviceRoleKey, bucket };
}

function buildClient(cfg: SupabaseStorageConfig) {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        "X-Client-Info": "sigma-gcm-render-server",
      },
    },
  });
}

function asUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function putPdfSupabase(opts: {
  path: string;
  pdf: Buffer;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = getSupabaseStorageConfigFromEnv();
  if (!cfg) return { ok: false, error: "Supabase Storage não configurado (env vars ausentes)." };

  try {
    const supabase = buildClient(cfg);
    const res = await supabase.storage.from(cfg.bucket).upload(opts.path, asUint8(opts.pdf), {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "0",
    });
    if (res.error) return { ok: false, error: res.error.message };
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
    const supabase = buildClient(cfg);
    const res = await supabase.storage.from(cfg.bucket).download(opts.path);
    if (res.error) return { ok: false, error: res.error.message };

    const blob = res.data as unknown as Blob;
    const ab = await blob.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!buf.length) return { ok: false, error: "Objeto retornou vazio." };
    return { ok: true, pdf: buf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

