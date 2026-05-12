export type UserRole = 'agent' | 'supervisor' | 'admin' | 'command';
export type UserStatus = 'PENDENTE' | 'ATIVO' | 'BLOQUEADO' | 'DESATIVADO';

export interface UserProfile {
  uid: string;
  name: string;
  registration: string;
  role: UserRole;
  status: UserStatus;
  email: string;
  vehicleId?: string;
  teamId?: string;
  photoUrl?: string;
  photoVersion?: number;
  biometricEnabled?: boolean;
  failedAttempts?: number;
  lockedUntil?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  /**
   * Turnos operacionais.
   * Mantém valores legados ('Manhã'|'Tarde'|'Noite') para compatibilidade com dados já gravados.
   */
  shift: 'Diurno' | 'Intermediário' | 'Noturno' | '12x36' | 'Manhã' | 'Tarde' | 'Noite';
  vehicleId: string;
  vehiclePrefix: string;
  driver: string;
  inCharge: string;
  aux1?: string;
  aux2?: string;
  members?: string[];
  agentIds?: string[];
  active: boolean;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  prefix: string;
  plate: string;
  model: string;
  type: 'Motorizada' | 'Moto' | 'Base móvel' | 'Tática';
  status: 'Em serviço' | 'Em manutenção' | 'Reserva';
}

export type OperationalStatus = 'patrolling' | 'moving' | 'occurrence' | 'offline';

export interface VehicleLocation {
  id: string;
  vehicleId: string;
  vehiclePrefix: string;
  teamId: string;
  teamName: string;
  driver: string;
  inCharge: string;
  aux1?: string;
  aux2?: string;
  latitude: number;
  longitude: number;
  speed: number;
  status: OperationalStatus;
  lastUpdate: string;
  idleTimeMinutes: number;
}

export interface Geofence {
  id: string;
  name: string;
  description: string;
  type: 'critical' | 'sensitive' | 'restricted';
  coordinates: [number, number][]; // Polygon
  active: boolean;
  createdAt: string;
}

export interface OperationalAlert {
  id: string;
  type: 'geofence' | 'idle' | 'unvisited' | 'radius' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: string;
  targetId?: string; // vehicleId or propertyId
  targetName?: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface PublicProperty {
  id: string;
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  qrCode: string;
  plusCode: string;
  /** Raio permitido para validação GPS (metros). Default no app: 50. */
  validationRadiusMeters?: number | null;
  manager?: string;
  status: 'operational' | 'maintenance' | 'closed';
  lastVisit?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

export type PatrolValidationStatus = 'VALIDO' | 'FORA_DO_RAIO';

/** Metadados opcionais do GPS no registro da ronda. */
export type PatrolGpsMeta = {
  accuracyMeters?: number | null;
  simulatedLocation?: boolean;
};

export interface PatrolRecord {
  id: string;
  agentId: string;
  agentName: string;
  vehicleId: string;
  vehiclePrefix: string;
  teamId: string;
  teamName: string;
  driver: string;
  inCharge: string;
  aux1?: string;
  aux2?: string;
  propertyId: string;
  propertyName: string;
  plusCode: string;
  timestamp: string;
  /** Posição do agente no momento do QR (GPS). */
  latitude: number;
  longitude: number;
  /** Ponto de referência do posto usado na validação (centro do Plus Code ou lat/lng cadastral). */
  propertyLatitude?: number;
  propertyLongitude?: number;
  /** De onde veio o ponto de referência (Plus Code decodificado vs lat/lng do cadastro). */
  propertyAnchorSource?: "plusCode" | "coordinates";
  /** Distância calculada posto × agente (metros). */
  distanceMeters?: number;
  /** Raio permitido usado na validação (metros). */
  allowedRadiusMeters?: number;
  /** Resultado da regra antifraude por distância (ausente = legado, tratar como válido). */
  validationStatus?: PatrolValidationStatus;
  /** Precisão informada pelo GPS (metros), se disponível. */
  gpsAccuracyMeters?: number | null;
  /** true se accuracy > limiar operacional (GPS fraco). */
  gpsLowConfidence?: boolean;
  /** Localização simulada (fluxo de teste do app). */
  simulatedLocation?: boolean;
  /** Reservado para detecção nativa de mock (Web: em geral false). */
  mockLocationSuspected?: boolean;
  status: 'normal' | 'attention' | 'urgent';
  observation: string;
  photoUrl?: string;
}

export interface OccurrenceRecord {
  id: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  description: string;
  type: string;
  propertyId?: string;
  propertyName?: string;
  latitude: number;
  longitude: number;
  photoUrl?: string;
  teamId?: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  details: string;
  targetId?: string;
  targetType?: 'user' | 'property' | 'vehicle' | 'team' | 'alert' | 'patrol';
  timestamp: string;
}

export interface ShiftReport {
  id: string;
  createdAt: string;
  filename: string;
  downloadUrl?: string;
  /** URL pública do PDF no Supabase Storage (ex.: bucket sigma-pdfs). */
  publicUrl?: string;
  storagePath?: string;
  agentId: string;
  agentName: string;
  registration?: string;
  teamId?: string;
  teamName?: string;
  vehiclePrefix?: string;
  shift: string;
  windowStart: string;
  windowEnd: string;
  delivery?:
    | 'storage'
    | 'server'
    | 'email'
    | 'none'
    | 'metadata_only'
    | 'firebase_storage'
    | 'supabase';
  /** Quando só há registro no Firestore (ex.: Storage não disponível no plano Spark). */
  pdfNote?: string;
  /** PDF persistido (Firebase Storage ou Supabase, conforme `delivery`). */
  uploaded?: boolean;
  firebaseStorageBucket?: string;
  /** Bucket Supabase quando `delivery === 'supabase'`. */
  supabaseStorageBucket?: string;
  generatedAt?: string;
  uploadedAt?: string;
  emailTo?: string;
  emailSentAt?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}
