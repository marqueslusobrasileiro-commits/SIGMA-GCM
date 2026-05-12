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
}): Promise<{ publicUrl: string; storagePath: string } | null> {
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

  const { data: pub } = sup.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = String(pub?.publicUrl || "").trim();
  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] upload ok", {
    bucket,
    path: objectPath,
    reportId: reportId || "(n/d)",
    hasPublicUrl: !!publicUrl,
  });

  return { publicUrl, storagePath: objectPath };
}

export async function downloadShiftReportPdfFromSupabase(
  objectPath: string,
  reportId?: string,
): Promise<Buffer | null> {
  const sup = getClient();
  if (!sup) return null;
  const bucket = supabaseShiftReportsBucket();
  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] download", { bucket, path: objectPath, reportId: reportId || "(n/d)" });

  const { data, error } = await sup.storage.from(bucket).download(objectPath);
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.warn("[shift_report_supabase] download failed", {
      bucket,
      path: objectPath,
      message: error?.message || "sem dados",
    });
    return null;
  }

  const buf = Buffer.from(await data.arrayBuffer());
  // eslint-disable-next-line no-console
  console.info("[shift_report_supabase] download ok", {
    bucket,
    path: objectPath,
    bytes: buf.length,
    reportId: reportId || "(n/d)",
  });
  return buf;
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
