import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  query,
  where,
  enableNetwork,
  type Firestore,
} from "firebase/firestore";
import type { Team, UserProfile } from "../types";
import { auth } from "../firebase";

/**
 * Perfil com `teamId` válido no Firestore, mas leitura do doc `teams/{id}` falhou (rede/WebView/cache/doc apagado).
 * Permite gravar `patrols` — as rules só exigem usuário ATIVO no create.
 */
export function fallbackTeamForPatrol(
  profile: Pick<UserProfile, "uid" | "name" | "vehicleId">,
  teamId: string,
): Team {
  const nameSafe = profile.name?.trim() || "GCM";
  return {
    id: teamId,
    name: "Plantão (perfil)",
    shift: "Diurno",
    vehicleId: profile.vehicleId || "",
    vehiclePrefix: "N/A",
    driver: nameSafe,
    inCharge: nameSafe,
    aux1: "",
    aux2: "",
    agentIds: [profile.uid],
    active: true,
    createdAt: new Date().toISOString(),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Leituras diretas da viatura Web/Android podem falhar uma vez; repetimos antes de desistir. */
async function fetchTeamById(
  db: Firestore,
  tid: string,
): Promise<Team | null> {
  const ref = doc(db, "teams", tid);
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const srv = await getDocFromServer(ref);
      if (srv.exists()) {
        return { id: srv.id, ...srv.data() } as Team;
      }
    } catch (e) {
      console.warn(
        `[resolveOperationalTeam] getDocFromServer teams/${tid} attempt ${attempt + 1}`,
        e,
      );
    }
    try {
      const loc = await getDoc(ref);
      if (loc.exists()) {
        return { id: loc.id, ...loc.data() } as Team;
      }
    } catch (e) {
      console.warn(
        `[resolveOperationalTeam] getDoc teams/${tid} attempt ${attempt + 1}`,
        e,
      );
    }
    if (attempt < maxAttempts - 1) {
      await sleep(350 * (attempt + 1));
    }
  }
  return null;
}

function uniqTeams(list: Team[]): Team[] {
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const t of list) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function rankTeams(uid: string, tid: string | undefined, list: Team[]): Team[] {
  // Mantém a equipe ligada ao perfil (teamId) mesmo se active=false — evita falha de ronda por flag legada.
  const filtered = list.filter(
    (t) => t.active !== false || (tid != null && tid !== "" && t.id === tid),
  );
  filtered.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  if (tid) {
    const exact = filtered.find((t) => t.id === tid);
    if (exact) return [exact, ...filtered.filter((t) => t.id !== tid)];
  }
  const linked = filtered.filter(
    (t) => t.agentIds?.includes(uid) || t.members?.includes(uid),
  );
  if (linked.length) return linked;
  return filtered;
}

/**
 * Resolve equipe no APK/WebView: token fresco + rede + vários caminhos (cache não pode ser o único).
 */
export async function resolveOperationalTeam(
  db: Firestore,
  uid: string,
  profileTeamId: string | undefined,
  teamsCache: Team[],
): Promise<Team | null> {
  try {
    await auth.currentUser?.getIdToken(true);
  } catch {
    /* segue mesmo assim */
  }
  try {
    await enableNetwork(db);
  } catch {
    /* offline */
  }

  const tid = profileTeamId?.trim() || undefined;
  const collected: Team[] = [];

  if (tid) {
    const cached = teamsCache.find((t) => t.id === tid);
    if (cached) return cached;

    const direct = await fetchTeamById(db, tid);
    if (direct) return direct;
  }

  try {
    const snapA = await getDocs(
      query(collection(db, "teams"), where("agentIds", "array-contains", uid), limit(25)),
    );
    for (const d of snapA.docs) {
      collected.push({ id: d.id, ...d.data() } as Team);
    }
  } catch (e) {
    console.warn("[resolveOperationalTeam] query agentIds", e);
  }

  try {
    const snapM = await getDocs(
      query(collection(db, "teams"), where("members", "array-contains", uid), limit(25)),
    );
    for (const d of snapM.docs) {
      collected.push({ id: d.id, ...d.data() } as Team);
    }
  } catch (e) {
    console.warn("[resolveOperationalTeam] query members", e);
  }

  let merged = uniqTeams(collected);
  let ranked = rankTeams(uid, tid, merged);
  if (ranked.length) return ranked[0]!;

  /* Último recurso: leitura ampla (rules permitem ATIVO ler teams). Evita falha no APK quando índices/queries falham. */
  try {
    const snapAll = await getDocs(query(collection(db, "teams"), limit(200)));
    const memory = snapAll.docs.map((d) => ({ id: d.id, ...d.data() } as Team));
    const hits = memory.filter((t) => {
      if (tid && t.id === tid) return true;
      if (t.active === false) return false;
      if (t.agentIds?.includes(uid)) return true;
      if (t.members?.includes(uid)) return true;
      return false;
    });
    ranked = rankTeams(uid, tid, hits);
    return ranked[0] ?? null;
  } catch (e) {
    console.error("[resolveOperationalTeam] fallback scan", e);
    return null;
  }
}
