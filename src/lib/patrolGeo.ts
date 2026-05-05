/**
 * Geodesia para validação antifraude das rondas (Haversine).
 */

import * as OpenLocationCode from "open-location-code";
import type { PatrolRecord, PatrolValidationStatus, PublicProperty } from "../types";

/** Distância em metros entre dois pontos WGS84. */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/** Se precisão GPS (metros) > este valor, bloqueamos o registro (exceto simulação de testes). */
export const PATROL_GPS_ACCURACY_BLOCK_M = 120;

/** Acima disto marcamos baixa confiança (mas permitimos). */
export const PATROL_GPS_LOW_CONFIDENCE_M = 30;

/** Raio padrão quando o posto não define `validationRadiusMeters`. */
export const PATROL_DEFAULT_RADIUS_M = 50;

type OpenLocationCodeLib = {
  isValid: (code: string) => boolean;
  isFull: (code: string) => boolean;
  recoverNearest: (shortCode: string, lat: number, lng: number) => string;
  decode: (fullCode: string) => { latitudeCenter: number; longitudeCenter: number };
};

/**
 * Status antifraude efetivo: campo explícito ou inferência a partir do texto da observação
 * (registros antigos gravavam só a mensagem "VALIDAÇÃO ANTIFRAUDE: FORA_DO_RAIO...").
 */
export function patrolEffectiveValidationStatus(r: PatrolRecord): PatrolValidationStatus {
  if (r.validationStatus === "FORA_DO_RAIO") return "FORA_DO_RAIO";
  if (r.validationStatus === "VALIDO") return "VALIDO";
  const obs = String(r.observation || "");
  if (/FORA_DO_RAIO|VALIDAÇÃO ANTIFRAUDE:\s*FORA/i.test(obs)) {
    return "FORA_DO_RAIO";
  }
  const dist = r.distanceMeters;
  const allowed = r.allowedRadiusMeters;
  if (
    typeof dist === "number" &&
    Number.isFinite(dist) &&
    typeof allowed === "number" &&
    Number.isFinite(allowed) &&
    dist > allowed
  ) {
    return "FORA_DO_RAIO";
  }
  return "VALIDO";
}

export function resolvePatrolRadiusMeters(property: {
  validationRadiusMeters?: number | null;
}): number {
  const r = property.validationRadiusMeters;
  if (typeof r === "number" && Number.isFinite(r) && r >= 10 && r <= 5000) {
    return Math.round(r);
  }
  return PATROL_DEFAULT_RADIUS_M;
}

/**
 * Ponto de referência do posto para medir distância do agente: prioriza o centro do Plus Code (Open Location Code)
 * quando o código é válido; senão usa latitude/longitude cadastradas.
 */
export function patrolAnchorFromProperty(property: PublicProperty): {
  latitude: number;
  longitude: number;
  source: "plusCode" | "coordinates";
} {
  const lat = property.latitude;
  const lng = property.longitude;
  const fromCoords = (): { latitude: number; longitude: number; source: "coordinates" } => ({
    latitude: lat,
    longitude: lng,
    source: "coordinates",
  });

  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
    return fromCoords();
  }

  const raw = String(property.plusCode ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (raw.length < 8) {
    return fromCoords();
  }

  try {
    // Mesmo padrão que `App.tsx` (módulo CJS / export duplo).
    const OLC = (OpenLocationCode as { OpenLocationCode?: new () => OpenLocationCodeLib }).OpenLocationCode;
    const OlcCtor = OLC ?? (OpenLocationCode as unknown as new () => OpenLocationCodeLib);
    const olc = new OlcCtor();
    if (!olc.isValid(raw)) {
      return fromCoords();
    }
    let full = raw;
    if (!olc.isFull(raw)) {
      full = olc.recoverNearest(raw, lat, lng);
    }
    const area = olc.decode(full);
    return {
      latitude: area.latitudeCenter,
      longitude: area.longitudeCenter,
      source: "plusCode",
    };
  } catch {
    return fromCoords();
  }
}
