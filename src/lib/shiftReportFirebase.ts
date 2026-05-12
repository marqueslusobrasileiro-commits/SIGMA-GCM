import {
  doc,
  deleteDoc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { getBlob, getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import type { ShiftReport, Team, UserProfile } from "../types";
import { apiFetch, apiFetchExternal, apiFetchShiftReport, getApiBaseUrl, getExternalApiBaseUrl } from "./apiClient";
import { Capacitor } from "@capacitor/core";
import { setDocClean, updateDocClean } from "./firestoreData";

/** Igual ao servidor: `relatorios/AAAA/MM/uid/reportId.pdf` */
function buildRelatorioStoragePath(uid: string, reportId: string, windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  return `relatorios/${yyyy}/${mm}/${uid}/${reportId}.pdf`;
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

/** Caminho no Firebase Storage (doc explícito, layout novo ou legado). */
export function inferShiftReportStoragePath(r: ShiftReport): string | null {
  const explicit = r.storagePath?.trim();
  if (explicit) return explicit;
  const uid = r.agentId?.trim();
  const id = r.id?.trim();
  const ws = r.windowStart?.trim();
  if (uid && id && ws) return buildRelatorioStoragePath(uid, id, ws);
  if (uid && id) return `shift_reports/${uid}/${id}.pdf`;
  return null;
}

/** Há como obter o blob do PDF (URL, Storage explícito, caminho inferido ou API). */
export function shiftReportHasResolvablePdfSource(r: ShiftReport): boolean {
  if (r.delivery === "metadata_only") return false;
  if (r.downloadUrl?.trim()) return true;
  if (r.storagePath?.trim()) return true;
  if (inferShiftReportStoragePath(r)) return true;
  return !!getApiBaseUrl();
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
            "PDF não armazenado: Firebase Storage indisponível (plano Spark) ou erro de upload. Configure Blaze/API ou gere o PDF pela web com servidor.",
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
        "PDF não armazenado: Firebase Storage indisponível (plano Spark) ou erro de upload. Configure Blaze/API ou gere o PDF pela web com servidor.",
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
  const storagePath = buildRelatorioStoragePath(profile.uid, reportId, windowStart);
  const sRef = ref(storage, storagePath);
  await withTimeout(
    uploadBytes(sRef, blob, { contentType: "application/pdf" }),
    38_000,
    "Firebase Storage (upload PDF)",
  );
  const downloadUrl = await withTimeout(getDownloadURL(sRef), 22_000, "Firebase Storage (URL)");

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
      downloadUrl,
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

/** Baixa o PDF do relatório: URL pública/tokenizada → Storage → API (se configurada). */
export async function resolveShiftReportPdfBlob(r: ShiftReport): Promise<Blob> {
  // No APK/WebView, preferimos a API externa (Render) para evitar problemas de CORS/redirect do Storage.
  // Isso também elimina o risco de cair em `localhost` quando o app roda como WebView.
  if (Capacitor.isNativePlatform()) {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Sessão expirada.");
      const token = await u.getIdToken();
      const path = `/api/shift-reports/file/${encodeURIComponent(r.id)}`;
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

  const url = r.downloadUrl?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    const resp = await withTimeout(fetch(url), 22_000, "Baixar PDF (URL)");
    if (!resp.ok) {
      throw new Error(`Falha ao baixar PDF pela URL (${resp.status}).`);
    }
    const blob = await resp.blob();
    return ensurePdfBlob(blob);
  }

  const path = r.storagePath?.trim();
  if (path) {
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

  const base = getApiBaseUrl();
  if (!base) {
    throw new Error(
      r.delivery === "metadata_only"
        ? "Este plantão foi registrado só com dados (sem PDF no Firebase). Com Storage ou API configurados, novos relatórios terão arquivo para baixar."
        : "Não foi possível localizar o PDF (URL, Storage nem caminho padrão). Gere de novo no app atualizado ou defina VITE_API_BASE_URL se usar API.",
    );
  }

  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada.");
  const token = await u.getIdToken();
  const resp = await apiFetchShiftReport(`/api/shift-reports/file/${encodeURIComponent(r.id)}`, {
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
  await deleteDoc(doc(db, "shift_reports", r.id));
}
