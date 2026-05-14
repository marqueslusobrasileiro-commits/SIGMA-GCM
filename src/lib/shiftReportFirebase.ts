import {
  doc,
  deleteDoc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { getBlob, ref, uploadBytes, deleteObject } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import type { ShiftReport, Team, UserProfile } from "../types";
import { apiFetch, apiFetchExternal, apiFetchShiftReport, getApiBaseUrl, getExternalApiBaseUrl, shiftReportsApiShouldUseExternal } from "./apiClient";
import { Capacitor } from "@capacitor/core";
import { setDocClean, updateDocClean } from "./firestoreData";

/** Rota autenticada no backend (Render): PDF via storagePath → signed URL → buffer. */
export function shiftReportPdfDownloadApiPath(reportId: string): string {
  return `/api/shift-reports/file/${encodeURIComponent(reportId)}`;
}

/** Igual ao servidor: `relatorios/AAAA/MM/uid/reportId.pdf` */
function buildRelatorioStoragePath(uid: string, reportId: string, windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  return `relatorios/${yyyy}/${mm}/${uid}/${reportId}.pdf`;
}

/**
 * PDF armazenado no Supabase (metadados). Não usar fetch em URLs do Storage no cliente.
 */
export function isSupabaseBackedShiftReport(r: ShiftReport): boolean {
  if (r.delivery === "supabase") return true;
  if (String(r.supabaseStorageBucket || "").trim()) return true;
  const sp = r.storagePath?.trim() || "";
  if (sp.startsWith("relatorios/")) return true;
  return false;
}

/** Baixar só pela rota `/api/shift-reports/file/:id` (backend assina e busca o PDF). */
function shouldPreferApiForShiftReportPdf(r: ShiftReport): boolean {
  if (isSupabaseBackedShiftReport(r)) return true;
  if (r.uploaded && r.delivery !== "firebase_storage" && r.delivery !== "metadata_only") return true;
  return false;
}

async function pdfBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label}: tempo esgotado (${ms} ms)`)), ms);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function assertReportOwner(existing: unknown, profile: UserProfile, reportId: string) {
  const agentId =
    typeof existing === "object" && existing !== null && "agentId" in existing
      ? String((existing as any).agentId || "")
      : "";
  if (agentId && agentId !== profile.uid) {
    throw new Error(
      `Relatório ${reportId} já existe no sistema, mas pertence a outro agente. Contate o administrador.`,
    );
  }
}

/** Caminho no Firebase Storage (doc explícito, layout novo ou legado). Não usar `storagePath` do Supabase no cliente Firebase. */
export function inferShiftReportStoragePath(r: ShiftReport): string | null {
  if (isSupabaseBackedShiftReport(r)) return null;
  const explicit = r.storagePath?.trim();
  if (explicit) return explicit;
  const uid = r.agentId?.trim();
  const id = r.id?.trim();
  const ws = r.windowStart?.trim();
  if (uid && id && ws) return buildRelatorioStoragePath(uid, id, ws);
  if (uid && id) return `shift_reports/${uid}/${id}.pdf`;
  return null;
}

/** Há como obter o blob do PDF (Storage Firebase, caminho inferido ou rota API com storagePath no servidor). */
export function shiftReportHasResolvablePdfSource(r: ShiftReport): boolean {
  if (r.delivery === "metadata_only") return false;
  if (r.storagePath?.trim()) return true;
  if (r.uploaded) return true;
  if (inferShiftReportStoragePath(r)) return true;
  return !!getApiBaseUrl() || Capacitor.isNativePlatform();
}

/** ID determinístico igual ao esperado pelo servidor (evita duplicar mesmo plantão). */
export function buildShiftReportDocId(
  profile: UserProfile,
  windowStart: string,
): string {
  const windowKey = windowStart.replace(/[:.]/g, "-");
  const tid = profile.teamId?.trim();
  if (tid) return `${profile.uid}_${tid}_${windowKey}`;
  return `${profile.uid}_noteam_${windowKey}`;
}

/**
 * Registra o relatório só no Firestore (sem PDF no Storage).
 * Útil quando o projeto está no Spark ou Storage falhou — o painel lista o plantão, mas não há arquivo para baixar.
 */
export async function registerShiftReportMetadataFirestore(opts: {
  profile: UserProfile;
  filename: string;
  windowStart: string;
  windowEnd: string;
  shift: string;
  team: Team | undefined;
  pdfNote?: string;
}): Promise<void> {
  const { profile, filename, windowStart, windowEnd, shift, team, pdfNote } = opts;
  const reportId = buildShiftReportDocId(profile, windowStart);
  const existing = await getDoc(doc(db, "shift_reports", reportId));
  if (existing.exists()) {
    assertReportOwner(existing.data(), profile, reportId);
    // Upsert (merge): evita falhar em reenvios/retentativas no APK.
    await withTimeout(
      setDocClean(
        doc(db, "shift_reports", reportId),
        {
          createdAt: new Date().toISOString(),
          filename,
          agentId: profile.uid,
          agentName: profile.name,
          registration: profile.registration || "",
          teamId: profile.teamId || "",
          teamName: team?.name || "",
          vehiclePrefix: team?.vehiclePrefix || "",
          shift,
          windowStart,
          windowEnd,
          delivery: "metadata_only",
          pdfNote:
            pdfNote ||
            "PDF não armazenado: configure o servidor com Supabase (SUPABASE_*) ou Firebase Storage (Blaze) e gere de novo pela web/API.",
        },
        { merge: true },
      ),
      22_000,
      "Firestore (metadados do relatório - merge)",
    );
    return;
  }
  await withTimeout(
    setDocClean(doc(db, "shift_reports", reportId), {
      createdAt: new Date().toISOString(),
      filename,
      agentId: profile.uid,
      agentName: profile.name,
      registration: profile.registration || "",
      teamId: profile.teamId || "",
      teamName: team?.name || "",
      vehiclePrefix: team?.vehiclePrefix || "",
      shift,
      windowStart,
      windowEnd,
      delivery: "metadata_only",
      pdfNote:
        pdfNote ||
        "PDF não armazenado: configure o servidor com Supabase (SUPABASE_*) ou Firebase Storage (Blaze) e gere de novo pela web/API.",
    }),
    22_000,
    "Firestore (metadados do relatório)",
  );
}

export async function uploadShiftReportPdfToFirebase(opts: {
  profile: UserProfile;
  blob: Blob;
  filename: string;
  windowStart: string;
  windowEnd: string;
  shift: string;
  team: Team | undefined;
}): Promise<void> {
  const { profile, blob, filename, windowStart, windowEnd, shift, team } = opts;
  const reportId = buildShiftReportDocId(profile, windowStart);

  if (shiftReportsApiShouldUseExternal() || getApiBaseUrl()) {
    const u = auth.currentUser;
    if (!u) throw new Error("Sessão expirada.");
    const base64 = await pdfBlobToBase64(blob);
    const token = await u.getIdToken();
    // eslint-disable-next-line no-console
    console.info("[shift_report_supabase] client upload → API", { reportId, filename });
    const resp = await apiFetchShiftReport("/api/shift-reports/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename,
        pdfBase64: base64,
        meta: {
          agentId: profile.uid,
          agentName: profile.name,
          registration: profile.registration,
          teamId: profile.teamId,
          teamName: team?.name || "",
          vehiclePrefix: team?.vehiclePrefix || "",
          shift,
          windowStart,
          windowEnd,
          reportId,
        },
      }),
    });
    const raw = await resp.text();
    let payload: { ok?: boolean; error?: string; delivery?: string } = {};
    try {
      payload = raw ? (JSON.parse(raw) as typeof payload) : {};
    } catch {
      /* ignore */
    }
    if (!resp.ok) {
      throw new Error(payload?.error || `Falha ao enviar PDF (HTTP ${resp.status}).`);
    }
    // eslint-disable-next-line no-console
    console.info("[shift_report_supabase] client upload ok", { reportId, delivery: payload?.delivery });
    return;
  }

  const storagePath = buildRelatorioStoragePath(profile.uid, reportId, windowStart);
  const sRef = ref(storage, storagePath);
  await withTimeout(
    uploadBytes(sRef, blob, { contentType: "application/pdf" }),
    38_000,
    "Firebase Storage (upload PDF)",
  );
  // Se o doc já existir (retentativa), fazemos merge com delivery=storage.
  const existing = await getDoc(doc(db, "shift_reports", reportId));
  if (existing.exists()) {
    assertReportOwner(existing.data(), profile, reportId);
  }

  await withTimeout(
    setDocClean(
      doc(db, "shift_reports", reportId),
      {
        createdAt: new Date().toISOString(),
        filename,
        downloadUrl: deleteField(),
        publicUrl: deleteField(),
        storagePath,
        agentId: profile.uid,
        agentName: profile.name,
        registration: profile.registration || "",
        teamId: profile.teamId || "",
        teamName: team?.name || "",
        vehiclePrefix: team?.vehiclePrefix || "",
        shift,
        windowStart,
        windowEnd,
        delivery: "firebase_storage",
        uploaded: true,
        uploadedAt: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
      },
      { merge: true },
    ),
    22_000,
    "Firestore (metadados + Storage)",
  );
}

async function ensurePdfBlob(blob: Blob): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const sig = String.fromCharCode(...Array.from(head));
  if (sig !== "%PDF-") {
    throw new Error("Arquivo recebido não parece ser um PDF válido.");
  }
  return blob;
}

async function fetchShiftReportPdfFromApiBlob(r: ShiftReport): Promise<Blob> {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada.");
  const token = await u.getIdToken();
  const resp = await apiFetchShiftReport(shiftReportPdfDownloadApiPath(r.id), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Falha ao baixar PDF (HTTP ${resp.status})`);
  }
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const blob = await resp.blob();
  if (!contentType.includes("application/pdf")) {
    const txt = await blob.text().catch(() => "");
    try {
      const parsed = JSON.parse(txt);
      const msg = typeof parsed?.error === "string" ? parsed.error : txt;
      throw new Error(msg || `Resposta inválida (${contentType})`);
    } catch (e) {
      if (e instanceof Error && e.message !== txt) throw e;
      throw new Error(
        (txt && txt.slice(0, 300)) ||
          `Resposta inválida do servidor (Content-Type: ${contentType || "?"})`,
      );
    }
  }
  return ensurePdfBlob(blob);
}

/** Baixa o PDF: rota API (Supabase assinado no servidor) ou Firebase Storage legado. */
export async function resolveShiftReportPdfBlob(r: ShiftReport): Promise<Blob> {
  // No APK/WebView, preferimos a API externa (Render) para evitar problemas de CORS/redirect do Storage.
  // Isso também elimina o risco de cair em `localhost` quando o app roda como WebView.
  if (Capacitor.isNativePlatform()) {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Sessão expirada.");
      const token = await u.getIdToken();
      const path = shiftReportPdfDownloadApiPath(r.id);
      const absolute = `${getExternalApiBaseUrl()}${path}`;
      console.info("[shift_report] baixar PDF via API externa", { absolute });
      const resp = await apiFetchExternal(
        path,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
        { retries: 2, baseDelayMs: 900, maxDelayMs: 6000 },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `Falha ao baixar PDF (HTTP ${resp.status})`);
      }
      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      const blob = await resp.blob();
      if (!contentType.includes("application/pdf")) {
        const txt = await blob.text().catch(() => "");
        throw new Error((txt && txt.slice(0, 300)) || `Resposta inválida do servidor (Content-Type: ${contentType || "?"})`);
      }
      return ensurePdfBlob(blob);
    } catch (e) {
      console.warn("[shift_report] fallback: API externa falhou, tentando Storage/URL", e);
      // continua para as estratégias abaixo
    }
  }

  if (shouldPreferApiForShiftReportPdf(r) && (shiftReportsApiShouldUseExternal() || getApiBaseUrl())) {
    try {
      return await fetchShiftReportPdfFromApiBlob(r);
    } catch (e) {
      console.warn("[shift_report] API (PDF via servidor) falhou, tentando Firebase Storage legado", e);
    }
  }

  const path = r.storagePath?.trim();
  if (path && !isSupabaseBackedShiftReport(r)) {
    const sRef = ref(storage, path);
    const blob = await withTimeout(getBlob(sRef), 14_000, "Storage (PDF)");
    return ensurePdfBlob(blob);
  }

  const inferred = inferShiftReportStoragePath(r);
  if (inferred) {
    try {
      const sRef = ref(storage, inferred);
      const blob = await withTimeout(getBlob(sRef), 14_000, "Storage (PDF inferido)");
      return ensurePdfBlob(blob);
    } catch (e) {
      console.warn("[shift_report] PDF não encontrado no Storage pelo caminho inferido:", inferred, e);
    }
  }

  if (!getApiBaseUrl() && !shiftReportsApiShouldUseExternal()) {
    throw new Error(
      r.delivery === "metadata_only"
        ? "Este plantão foi registrado só com dados (sem PDF). Configure Supabase/API no servidor ou Firebase Storage (Blaze)."
        : "Não foi possível localizar o PDF (Storage Firebase, rota API ou configuração). Gere de novo no app ou defina VITE_API_BASE_URL / VITE_EXTERNAL_API_BASE_URL.",
    );
  }

  return await fetchShiftReportPdfFromApiBlob(r);
}

export async function trashShiftReportFirestore(reportId: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada.");
  await updateDocClean(doc(db, "shift_reports", reportId), {
    deletedAt: new Date().toISOString(),
    deletedBy: u.uid,
  });
}

export async function restoreShiftReportFirestore(reportId: string): Promise<void> {
  await updateDocClean(doc(db, "shift_reports", reportId), {
    deletedAt: deleteField(),
    deletedBy: deleteField(),
  });
}

export async function purgeShiftReportFirestore(r: ShiftReport): Promise<void> {
  if (r.delivery !== "supabase") {
    const paths = new Set<string>();
    const p0 = r.storagePath?.trim();
    if (p0) paths.add(p0);
    const inferred = inferShiftReportStoragePath(r);
    if (inferred) paths.add(inferred);
    const legacy =
      r.agentId?.trim() && r.id?.trim() ? `shift_reports/${r.agentId.trim()}/${r.id.trim()}.pdf` : "";
    if (legacy) paths.add(legacy);
    for (const path of paths) {
      try {
        await deleteObject(ref(storage, path));
      } catch {
        /* já removido ou sem permissão */
      }
    }
  }
  await deleteDoc(doc(db, "shift_reports", r.id));
}
