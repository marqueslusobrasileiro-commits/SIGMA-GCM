export type UserRole = 'agent' | 'supervisor' | 'admin';
export type UserStatus = 'PENDENTE' | 'ATIVO' | 'BLOQUEADO';

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
  biometricEnabled?: boolean;
  failedAttempts?: number;
  lockedUntil?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  shift: 'Manhã' | 'Tarde' | 'Noite' | '12x36';
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
  manager?: string;
  status: 'operational' | 'maintenance' | 'closed';
  lastVisit?: string;
}

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
  latitude: number;
  longitude: number;
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
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  details: string;
  targetId?: string;
  targetType?: 'user' | 'property' | 'vehicle' | 'team' | 'alert';
  timestamp: string;
}
