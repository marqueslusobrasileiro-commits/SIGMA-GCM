import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_BUCKET = "sigma-pdfs";

export function supabaseShiftReportsBucket(): string {
  return String(process.env.SUPABASE_STORAGE_BUCKET || "").trim() || DEFAULT_BUCKET;
}

export function isSupabaseShiftReportsConfigured(): boolean {
  return !!(
    String(process.env.SUPABASE_URL || "").trim() &&
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  );
}

function getClient(): SupabaseClient | null {
  if (!isSupabaseShiftReportsConfigured()) return null;
  const url = String(process.env.SUPABASE_URL).trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function uploadShiftReportPdfToSupabase(opts: {
  buffer: Buffer;
  objectPath: string;
  reportId?: string;
}): Promise<{ storagePath: string } | null> {
  const sup = getClient();
  if (!sup) return null;
  const bucket = supabaseShiftReportsBucket();
  const { buffer, objectPath, reportId } = opts;
  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] upload", {
    bucket,
    path: objectPath,
    reportId: reportId || "(n/d)",
    bytes: buffer.length,
  });

  const { error } = await sup.storage.from(bucket).upload(objectPath, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[shift_report_supabase] upload failed", { bucket, path: objectPath, message: error.message });
    return null;
  }

  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] upload ok", {
    bucket,
    path: objectPath,
    reportId: reportId || "(n/d)",
  });

  return { storagePath: objectPath };
}

/**
 * URL de leitura temporária (bucket privado). Sem URLs públicas /object/public.
 */
export async function shiftReportSignedPdfReadUrl(
  objectPath: string,
  expiresSec = 60,
): Promise<string | null> {
  const sup = getClient();
  if (!sup) return null;
  const bucket = supabaseShiftReportsBucket();
  const path = String(objectPath || "").trim();
  if (!path) return null;

  const { data, error } = await sup.storage.from(bucket).createSignedUrl(path, expiresSec);
  if (error || !data?.signedUrl) {
    // eslint-disable-next-line no-console
    console.warn("[shift_report_supabase] createSignedUrl failed", {
      bucket,
      path,
      message: error?.message,
    });
    return null;
  }
  return data.signedUrl;
}

export async function fetchPdfBufferFromSignedUrl(signedUrl: string): Promise<Buffer | null> {
  const url = String(signedUrl || "").trim();
  if (!url) return null;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  try {
    const resp = await fetch(url, { method: "GET", signal: ac.signal });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn("[shift_report_supabase] fetch signed URL failed", {
        status: resp.status,
        detail: txt.slice(0, 200),
      });
      return null;
    }
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    return buf.length ? buf : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[shift_report_supabase] fetch signed URL error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function removeShiftReportPdfFromSupabase(objectPath: string, reportId?: string): Promise<void> {
  const sup = getClient();
  if (!sup || !String(objectPath || "").trim()) return;
  const bucket = supabaseShiftReportsBucket();
  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] remove", { bucket, path: objectPath, reportId: reportId || "(n/d)" });
  const { error } = await sup.storage.from(bucket).remove([objectPath]);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[shift_report_supabase] remove failed", { bucket, path: objectPath, message: error.message });
  }
}
