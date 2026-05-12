import React, { useState, useEffect, useMemo, useRef, Component } from 'react';
import { 
  Home,
  QrCode, 
  FileText, 
  AlertTriangle, 
  History, 
  MapPin, 
  Camera as CameraIcon, 
  LogOut, 
  User, 
  Truck, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  CheckCircle2, 
  X,
  LayoutDashboard,
  Map as MapIcon,
  Search,
  Download,
  Plus,
  Edit2,
  Trash2,
  Users,
  BarChart3,
  Fingerprint,
  Lock,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SUPER_ADMIN_EMAIL } from './config';
import appLogo from './assets/sigma-brand.png';
import { 
  startRegistration, 
  startAuthentication 
} from '@simplewebauthn/browser';
import { 
  signInWithEmailAndPassword, 
  fetchSignInMethodsForEmail,
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCredential,
  signInWithCustomToken
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocFromServer,
  setDoc, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  getDocs,
  where,
  deleteDoc,
  updateDoc,
  arrayUnion,
  Timestamp,
  serverTimestamp,
  enableNetwork,
} from 'firebase/firestore';
import { format, isToday, startOfDay, endOfDay } from 'date-fns';
import { groupByDay } from './lib/groupByDay';
import { addDocClean, limparDados, setDocClean, updateDocClean } from './lib/firestoreData';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import * as OpenLocationCode from 'open-location-code';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { getSecondaryAuth } from './lib/firebaseSecondary';
import { cn } from './lib/utils';
import { resolveOperationalTeam, fallbackTeamForPatrol } from './lib/resolveOperationalTeam';
import { apiFetchShiftReport, getApiBaseUrl } from './lib/apiClient';
import {
  registerShiftReportMetadataFirestore,
  uploadShiftReportPdfToFirebase,
} from './lib/shiftReportFirebase';
import { generateGeminiText } from './lib/gemini';
import { generateEndOfShiftReportPdf } from './lib/reports/endOfShiftReport';
import { addSigmaHeader } from './lib/reports/pdfBranding';
import { getShiftWindow } from './lib/shifts';
import {
  calculateDistanceMeters,
  patrolAnchorFromProperty,
  PATROL_GPS_ACCURACY_BLOCK_M,
  PATROL_GPS_LOW_CONFIDENCE_M,
  patrolEffectiveValidationStatus,
  resolvePatrolRadiusMeters,
} from './lib/patrolGeo';
import { 
  UserProfile, 
  PublicProperty, 
  PatrolRecord,
  PatrolGpsMeta,
  PatrolValidationStatus,
  OccurrenceRecord, 
  UserRole, 
  UserStatus, 
  Team, 
  Vehicle, 
  AuditLog,
  VehicleLocation,
  Geofence,
  OperationalAlert,
  ShiftReport
} from './types';

const AdminPanel = React.lazy(async () => {
  const mod = await import('./components/AdminPanel');
  return { default: mod.AdminPanel };
});

const isNativeApp = () => {
  try {
    return Capacitor.getPlatform() !== 'web';
  } catch {
    return false;
  }
};

function offsetLatLngByMeters(
  origin: { latitude: number; longitude: number },
  deltaNorthMeters: number,
  deltaEastMeters: number,
): { latitude: number; longitude: number } {
  const latRad = (origin.latitude * Math.PI) / 180;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos(latRad);
  const dLat = deltaNorthMeters / metersPerDegreeLat;
  const dLng = metersPerDegreeLng ? deltaEastMeters / metersPerDegreeLng : 0;
  return {
    latitude: origin.latitude + dLat,
    longitude: origin.longitude + dLng,
  };
}

const SystemManual = React.lazy(async () => {
  const mod = await import('./components/SystemManual');
  return { default: mod.SystemManual };
});

const StrategicDashboard = React.lazy(async () => {
  const mod = await import('./components/StrategicDashboard');
  return { default: mod.StrategicDashboard };
});

const MapComponent = React.lazy(async () => {
  const mod = await import('./components/PatrolMap');
  return { default: mod.MapComponent };
});

// --- Firestore Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function logAdminAction(admin: UserProfile, action: string, details: string, targetId?: string, targetType?: 'user' | 'property' | 'vehicle' | 'team' | 'alert') {
  try {
    const logData: Omit<AuditLog, 'id'> = {
      adminId: admin.uid,
      adminName: admin.name,
      action,
      details,
      targetId,
      targetType,
      timestamp: new Date().toISOString()
    };
    await addDocClean(collection(db, 'audit_logs'), logData as unknown as Record<string, unknown>);
  } catch (err) {
    console.error("Failed to log admin action:", err);
  }
}

// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  size = 'md',
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) => {
  const variants = {
    primary: 'bg-blue-900 text-white hover:bg-blue-800 shadow-md',
    secondary: 'bg-gray-700 text-white hover:bg-gray-600',
    outline: 'border-2 border-blue-900 text-blue-900 hover:bg-blue-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-gray-600 hover:bg-gray-100'
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg font-semibold'
  };
  
  return (
    <button 
      className={cn(
        'rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden', className)} {...props}>
    {children}
  </div>
);

const Input = ({ label, icon: Icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; icon?: any }) => (
  <div className="space-y-1.5">
    {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
      <input 
        className={cn(
          "w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all",
          Icon ? "pl-10 pr-4" : "px-4"
        )}
        {...props}
      />
    </div>
  </div>
);

const Badge = ({ children, variant = 'info', className }: { children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info'; className?: string }) => {
  const variants = {
    success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700'
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', variants[variant], className)}>
      {children}
    </span>
  );
};

// --- Components ---

const TeamVehicleSetupModal = ({
  teams,
  vehicles,
  initialVehicleId,
  onSave,
  loading: parentLoading,
  canCreateUsers,
  onCreateUser,
}: {
  teams: Team[];
  vehicles: Vehicle[];
  /** Viatura já ligada ao perfil — pré-seleciona se estiver na lista elegível */
  initialVehicleId?: string | null;
  onSave: (teamData: Partial<Team>) => Promise<void>;
  loading: boolean;
  canCreateUsers: boolean;
  onCreateUser: (data: {
    name: string;
    registration: string;
    email: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
}) => {
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [shift, setShift] = useState<'Diurno' | 'Intermediário' | 'Noturno'>('Diurno');
  const [driver, setDriver] = useState('');
  const [inCharge, setInCharge] = useState('');
  const [aux1, setAux1] = useState('');
  const [aux2, setAux2] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRegistration, setNewUserRegistration] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('agent');

  /** Inclui «Em serviço», «Reserva», status ausente ou legado; exclui apenas «Em manutenção». */
  const eligibleVehicles = useMemo(
    () => vehicles.filter((v) => v.status !== 'Em manutenção'),
    [vehicles],
  );

  useEffect(() => {
    if (!initialVehicleId) return;
    if (!eligibleVehicles.some((v) => v.id === initialVehicleId)) return;
    setSelectedVehicleId((prev) => prev || initialVehicleId);
  }, [initialVehicleId, eligibleVehicles]);

  const isLoading = parentLoading || localLoading;
  const canEditAfterVehicle = !!selectedVehicleId && !isLoading;

  const handleSave = async () => {
    if (!selectedVehicleId || !teamName || !driver || !inCharge) {
      alert('Por favor, preencha todos os campos obrigatórios (Viatura, Equipe, Condutor e Encarregado).');
      return;
    }

    const vehicle = vehicles.find(v => v.id === selectedVehicleId);
    if (!vehicle) return;

    setLocalLoading(true);
    try {
      await onSave({
        name: teamName,
        shift,
        vehicleId: selectedVehicleId,
        vehiclePrefix: vehicle.prefix || 'N/A',
        driver,
        inCharge,
        aux1,
        aux2,
        active: true,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[setup] falha ao salvar plantão:', e);
      alert('Falha ao salvar o plantão. Verifique permissões/rede e tente novamente.');
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl my-8"
      >
        <div className="bg-blue-900 p-6 text-white">
          <h3 className="text-xl font-bold">Escala Operacional</h3>
          <p className="text-blue-200 text-sm">Configure sua equipe e viatura para o plantão</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Vehicle Selection */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Viatura (Prefixo) *</label>
            <select 
              className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all"
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              disabled={isLoading}
            >
              <option value="">Selecione uma viatura</option>
              {eligibleVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.prefix} — {v.model}
                  {v.status ? ` (${v.status})` : ''}
                </option>
              ))}
            </select>
            {eligibleVehicles.length === 0 && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-sm leading-relaxed">
                Nenhuma viatura disponível para plantão (todas em manutenção ou ainda não cadastradas).
                Peça ao administrador para cadastrar viaturas ou alterar o status no painel <b>Viaturas</b>.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Nome da Equipe *</label>
              <input 
                type="text"
                placeholder="Ex: ALFA"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value.toUpperCase())}
                disabled={!canEditAfterVehicle}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Turno *</label>
              <select 
                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none"
                value={shift}
                onChange={(e) => setShift(e.target.value as any)}
                disabled={!canEditAfterVehicle}
              >
                <option value="Diurno">Diurno (06:00–18:00)</option>
                <option value="Intermediário">Intermediário (14:00–02:00)</option>
                <option value="Noturno">Noturno (18:00–06:00)</option>
              </select>
            </div>
          </div>

          {!selectedVehicleId && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
              Selecione uma <b>viatura</b> para liberar o preenchimento da equipe.
            </div>
          )}

          <div className="space-y-4 pt-2">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Composição da Equipe</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Condutor *</label>
                <input 
                  type="text"
                  placeholder="GCM Nome"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                  disabled={!canEditAfterVehicle}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Encarregado *</label>
                <input 
                  type="text"
                  placeholder="GCM Nome"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                  value={inCharge}
                  onChange={(e) => setInCharge(e.target.value)}
                  disabled={!canEditAfterVehicle}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Auxiliar 01</label>
                <input 
                  type="text"
                  placeholder="GCM Nome"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                  value={aux1}
                  onChange={(e) => setAux1(e.target.value)}
                  disabled={!canEditAfterVehicle}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Auxiliar 02</label>
                <input 
                  type="text"
                  placeholder="GCM Nome"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                  value={aux2}
                  onChange={(e) => setAux2(e.target.value)}
                  disabled={!canEditAfterVehicle}
                />
              </div>
            </div>
          </div>

          {canCreateUsers && (
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Admin</h4>
                  <p className="text-sm text-gray-600 mt-1">Cadastrar novo usuário (sem deslogar)</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-gray-200"
                  disabled={isLoading}
                  onClick={() => setShowCreateUser((v) => !v)}
                >
                  {showCreateUser ? 'Fechar' : 'Cadastrar usuário'}
                </Button>
              </div>

              {showCreateUser && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">Nome *</label>
                      <input
                        type="text"
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">Matrícula *</label>
                      <input
                        type="text"
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                        value={newUserRegistration}
                        onChange={(e) => setNewUserRegistration(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">E-mail *</label>
                      <input
                        type="email"
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">Senha *</label>
                      <input
                        type="password"
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none focus:ring-2 focus:ring-blue-900/20"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Perfil *</label>
                    <select
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 outline-none"
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                      disabled={isLoading}
                    >
                      <option value="agent">Agente Operacional</option>
                      <option value="supervisor">Supervisor de Dia</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    disabled={isLoading}
                    onClick={async () => {
                      if (!newUserName || !newUserRegistration || !newUserEmail || !newUserPassword) {
                        alert('Preencha todos os campos do novo usuário.');
                        return;
                      }
                      setLocalLoading(true);
                      try {
                        await onCreateUser({
                          name: newUserName,
                          registration: newUserRegistration,
                          email: newUserEmail,
                          password: newUserPassword,
                          role: newUserRole,
                        });
                        setNewUserName('');
                        setNewUserRegistration('');
                        setNewUserEmail('');
                        setNewUserPassword('');
                        setNewUserRole('agent');
                        alert('Usuário cadastrado com sucesso!');
                      } finally {
                        setLocalLoading(false);
                      }
                    }}
                  >
                    Criar usuário
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="pt-4">
            <Button 
              className="w-full py-6 text-lg font-bold shadow-lg shadow-blue-900/20" 
              onClick={handleSave} 
              disabled={isLoading}
            >
              {isLoading ? 'Configurando...' : 'Iniciar Patrulhamento'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// --- Main App ---

function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoLoadingStep, setPhotoLoadingStep] = useState<string | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'dashboard' | 'properties' | 'teams' | 'vehicles' | 'map' | 'manual'>('home');
  const [historyTab, setHistoryTab] = useState<'patrols' | 'occurrences'>('patrols');
  const [showTeamDetails, setShowTeamDetails] = useState(false);
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [editTeamName, setEditTeamName] = useState('');
  const [editVehiclePrefix, setEditVehiclePrefix] = useState('');
  const [editDriver, setEditDriver] = useState('');
  const [editInCharge, setEditInCharge] = useState('');
  const [editAux1, setEditAux1] = useState('');
  const [editAux2, setEditAux2] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showOccurrenceModal, setShowOccurrenceModal] = useState(false);
  const [occurrencePhoto, setOccurrencePhoto] = useState<string | null>(null);
  const [submittingOccurrence, setSubmittingOccurrence] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showTeamVehicleSetup, setShowTeamVehicleSetup] = useState(false);
  const [setupTeamVehicleSaving, setSetupTeamVehicleSaving] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyCategory, setPropertyCategory] = useState('all');
  const [showNewPropertyModal, setShowNewPropertyModal] = useState(false);
  const [showEditPropertyModal, setShowEditPropertyModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showSyncConfirmModal, setShowSyncConfirmModal] = useState(false);
  const [propertyToDelete, setPropertyToDelete] = useState<{id: string, name: string} | null>(null);
  const [editingProperty, setEditingProperty] = useState<PublicProperty | null>(null);
  const [selectedPropertyForQR, setSelectedPropertyForQR] = useState<PublicProperty | null>(null);
  const [scannedProperty, setScannedProperty] = useState<PublicProperty | null>(null);
  const [newProperty, setNewProperty] = useState({
    name: '',
    category: 'Administrativo',
    address: 'Araçoiaba da Serra',
    latitude: -23.5042,
    longitude: -47.4831
  });
  const [vehicleId, setVehicleId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [patrols, setPatrols] = useState<PatrolRecord[]>([]);
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceRecord[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<VehicleLocation[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastLoginTime, setLastLoginTime] = useState<number>(0);
  const [pendingUsersCount, setPendingUsersCount] = useState<number>(0);
  const hasShownPendingAlertRef = useRef(false);
  const isMasterAdmin =
    !!profile &&
    profile.role === 'admin' &&
    (profile.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ui:headerCollapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ui:headerCollapsed', isHeaderCollapsed ? '1' : '0');
    } catch {}
  }, [isHeaderCollapsed]);

  // Relatório obrigatório ao fim do plantão
  const [recentShiftReports, setRecentShiftReports] = useState<ShiftReport[]>([]);
  const [forceShiftReportModal, setForceShiftReportModal] = useState(false);
  const [forceShiftReportWindow, setForceShiftReportWindow] = useState<{ start: Date; end: Date; label: string } | null>(null);
  const [forceShiftReportLoading, setForceShiftReportLoading] = useState(false);
  const [pendingLogoutAfterReport, setPendingLogoutAfterReport] = useState(false);

  // Check for 12-hour re-auth
  useEffect(() => {
    if (user && lastLoginTime > 0) {
      const now = Date.now();
      const twelveHours = 12 * 60 * 60 * 1000;
      if (now - lastLoginTime > twelveHours) {
        alert('Sessão expirada. Por favor, autentique-se novamente por segurança.');
        handleLogout();
      }
    }
  }, [user, lastLoginTime]);

  // Assina relatórios recentes do agente (para validar se já enviou o plantão)
  useEffect(() => {
    // Regra: qualquer usuário operacional com teamId precisa enviar relatório do turno.
    // (Admin/visitante não entram nessa obrigatoriedade.)
    if (!profile || !profile.teamId) return;
    if (profile.role === 'admin') return;
    const q = query(
      collection(db, 'shift_reports'),
      where('agentId', '==', profile.uid),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRecentShiftReports(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShiftReport, 'id'>) })),
        );
      },
      (err) => {
        console.warn('[shift_reports] falha ao ler relatórios recentes:', err);
        setRecentShiftReports([]);
      },
    );
    return () => unsub();
  }, [profile?.uid, profile?.role, profile?.teamId]);

  // Verifica continuamente se o relatório do plantão foi enviado (obrigatório)
  useEffect(() => {
    if (!profile || !profile.teamId || profile.role === 'admin') {
      setForceShiftReportModal(false);
      setForceShiftReportWindow(null);
      return;
    }

    const graceMs = 10 * 60 * 1000; // 10 minutos após o fim do turno

    const hasReportForWindow = (windowStartIso: string) => {
      return recentShiftReports.some(
        (r) => r.teamId === profile.teamId && r.windowStart === windowStartIso,
      );
    };

    const computeMustSend = () => {
      const team = teams.find((t) => t.id === profile.teamId);
      if (!team) return { mustSend: false, window: null as any };
      const now = new Date();
      const window = getShiftWindow(now, team.shift);
      const startIso = window.start.toISOString();
      const mustSend = now.getTime() > window.end.getTime() + graceMs && !hasReportForWindow(startIso);
      return { mustSend, window, startIso };
    };

    const tick = () => {
      const { mustSend, window } = computeMustSend();
      if (!window) return;

      if (mustSend) {
        setForceShiftReportWindow({ start: window.start, end: window.end, label: window.label });
        setForceShiftReportModal(true);
      } else {
        setForceShiftReportModal(false);
        setForceShiftReportWindow(null);
      }
    };

    tick();
    const id = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(id);
  }, [profile?.uid, profile?.role, profile?.teamId, teams, recentShiftReports]);

  // Auth Listener
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        
        // Use onSnapshot for real-time profile updates
        unsubProfile = onSnapshot(docRef, async (docSnap) => {
          if (docSnap.exists()) {
            const profileData = docSnap.data() as UserProfile;
            
            // AUTO-ADMIN for primary users
            const isAdminEmail = u.email === SUPER_ADMIN_EMAIL;
            if (isAdminEmail && (profileData.role !== 'admin' || profileData.status !== 'ATIVO')) {
              const updatedProfile = { ...profileData, role: 'admin' as UserRole, status: 'ATIVO' as UserStatus };
              await updateDocClean(docRef, updatedProfile as unknown as Record<string, unknown>);
              setProfile(updatedProfile);
            } else {
              setProfile(profileData);
            }
            
            // Bloqueia acesso ao app enquanto estiver PENDENTE/BLOQUEADO.
            // Isso impede que qualquer pessoa recém-cadastrada use o sistema antes de aprovação.
            if (profileData.status !== 'ATIVO') {
              // Garante no backend (Admin SDK) que o perfil PENDENTE existe no Firestore e notifica admin.
              // Esse caminho cobre casos em que o usuário já existia no Auth ou o write client-side falhou.
              try {
                const idToken = await u.getIdToken();
                await fetch('/api/registration/request', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({
                    name: profileData.name || '',
                    registration: profileData.registration || '',
                    email: u.email || '',
                  }),
                });
                await fetch('/api/notifications/pending-user', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                  },
                });
              } catch (e) {
                console.warn('Falha ao garantir solicitação no backend (perfil não ATIVO):', e);
              }
              setProfile(null);
              setError('Seu cadastro ainda não foi autorizado pelo administrador. Aguarde a liberação para acessar.');
              try {
                await signOut(auth);
              } catch {}
              setLoading(false);
              return;
            }

            // Mantém o modal sincronizado com o estado real do perfil (evita "loop" de reabrir).
            setShowTeamVehicleSetup(
              (profileData.role === 'agent' ||
                profileData.role === 'command' ||
                profileData.role === 'supervisor') &&
                (!profileData.teamId || !profileData.vehicleId),
            );
          } else {
            // Usuário autenticado, mas perfil ainda não existe.
            // Cria automaticamente um perfil PENDENTE para o admin aprovar e desloga.
            try {
              const isAdminEmail = u.email === SUPER_ADMIN_EMAIL;
              // Super-admin: não desloga aqui. Deixa o app mostrar a tela "Concluir Cadastro"
              // para criar o próprio perfil `admin` no Firestore.
              if (isAdminEmail) {
                setProfile(null);
                setError(null);
                setLoading(false);
                return;
              }
              if (!isAdminEmail) {
                const fallbackName =
                  u.displayName ||
                  (u.email ? u.email.split('@')[0] : 'Usuário');

                const pendingProfile: UserProfile = {
                  uid: u.uid,
                  name: fallbackName,
                  registration: '',
                  role: 'agent',
                  status: 'PENDENTE',
                  email: u.email || '',
                  createdAt: new Date().toISOString(),
                };

                await setDocClean(docRef, pendingProfile as unknown as Record<string, unknown>, { merge: true });
                // Também garante via backend (Admin SDK) para não depender de rules/cache.
                // Notificação interna (backend) para admin aprovar o cadastro.
                // Best-effort: se falhar, não bloqueia o fluxo.
                try {
                  const idToken = await u.getIdToken();
                  await fetch('/api/registration/request', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                      name: pendingProfile.name || '',
                      registration: pendingProfile.registration || '',
                      email: pendingProfile.email || '',
                    }),
                  });
                  await fetch('/api/notifications/pending-user', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${idToken}`,
                    },
                  });
                } catch (notifyErr) {
                  console.warn('Falha ao notificar admin sobre cadastro pendente (auto):', notifyErr);
                }
                setError('Seu cadastro ainda não foi autorizado pelo administrador. Aguarde a liberação para acessar.');
              }
            } catch (createErr) {
              console.error('Falha ao criar perfil PENDENTE automaticamente:', createErr);
              setError('Não foi possível registrar sua solicitação de acesso (regras/permissão do Firestore). Contate o administrador.');
            } finally {
              setProfile(null);
              try {
                await signOut(auth);
              } catch {}
            }
          }
          setLoading(false);
        }, async (err) => {
          console.error('Profile listener error:', err);
          try {
            await enableNetwork(db);
            await u.getIdToken(true);
            const snap = await getDocFromServer(docRef);
            if (snap.exists()) {
              const profileData = snap.data() as UserProfile;
              if (profileData.status === 'ATIVO') {
                const isAdminEmail = u.email === SUPER_ADMIN_EMAIL;
                if (isAdminEmail && profileData.role !== 'admin') {
                  const updatedProfile = {
                    ...profileData,
                    role: 'admin' as UserRole,
                    status: 'ATIVO' as UserStatus,
                  };
                  await updateDocClean(docRef, updatedProfile as unknown as Record<string, unknown>);
                  setProfile(updatedProfile);
                } else {
                  setProfile(profileData);
                }
                setShowTeamVehicleSetup(
                  (profileData.role === 'agent' ||
                    profileData.role === 'command' ||
                    profileData.role === 'supervisor') &&
                    (!profileData.teamId || !profileData.vehicleId),
                );
                setError(null);
                setLoading(false);
                return;
              }
            }
          } catch (recoverErr) {
            console.warn('Profile recover (servidor) falhou:', recoverErr);
          }
          setProfile(null);
          setError(
            'Não foi possível carregar seu perfil (permissão/rede). Feche e abra o app ou verifique a internet. Se persistir, contate o administrador.',
          );
          setLoading(false);
        });
      } else {
        setProfile(null);
        if (unsubProfile) unsubProfile();
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  // Inicializa Google Sign-In nativo no Android (Capacitor)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void GoogleSignIn.initialize({
      // Web client id (Firebase Auth -> Google provider -> Web SDK config)
      clientId: '343507031983-64oi12lm43bvgj1cu7lb7jca9uvnisgd.apps.googleusercontent.com',
    }).catch((err) => {
      console.error('GoogleSignIn.initialize error:', err);
    });
  }, []);

  // Web: login Google via servidor (/api/auth/google → custom token) contorna auth/unauthorized-domain no SDK.
  // Mantém getRedirectResult só para sessões antigas que ainda usavam signInWithRedirect.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_login') === 'error') {
      setError(
        'Login Google falhou. Confira no Render: (1) GOOGLE_OAUTH_CLIENT_SECRET — secret do cliente OAuth Web; (2) FIREBASE_SERVICE_ACCOUNT — JSON completo da conta de serviço Firebase (Project settings → Service accounts → Generate new private key), colado como variável de ambiente; (3) no GCP, redirect https://…onrender.com/api/auth/google/callback. Veja Logs do Render para detalhe.',
      );
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
    void (async () => {
      try {
        const completeRes = await fetch('/api/auth/google/complete', { credentials: 'include' });
        if (completeRes.status === 204) return;
        const data = await completeRes.json().catch(async () => {
          const txt = await completeRes.text().catch(() => '');
          return { error: txt || 'Resposta inválida do servidor.' };
        });
        if (completeRes.ok && data?.firebaseCustomToken) {
          try {
            const appAny = (auth as any)?.app;
            const pid = appAny?.options?.projectId;
            console.info("[auth] firebase web projectId:", pid);
          } catch {}
          await signInWithCustomToken(auth, data.firebaseCustomToken);
          setError(null);
          return;
        }
        if (!completeRes.ok) {
          console.warn('google web auth complete: non-ok', {
            status: completeRes.status,
            statusText: completeRes.statusText,
            data,
          });
          setError(
            `Login Google não finalizou no servidor (HTTP ${completeRes.status}). ` +
              `${typeof data?.error === 'string' && data.error ? `Detalhes: ${data.error}` : ''}`.trim(),
          );
        }
      } catch (e) {
        console.warn('google web auth complete:', e);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Login Google não finalizou (rede/navegador). Detalhes: ${msg}`);
      }
      // Na web o login Google é só via servidor; getRedirectResult do SDK costuma dar auth/unauthorized-domain se restou estado antigo.
      if (Capacitor.getPlatform() === 'web') return;
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) setError(null);
      } catch (err: unknown) {
        console.warn('getRedirectResult error:', err);
      }
    })();
  }, []);

  // Real-time Data Listeners
  useEffect(() => {
    if (!user || !profile || profile.status !== 'ATIVO') return;

    // Para agente, mostra apenas rondas do próprio usuário (evita “misturar” rondas do admin).
    // Importante: `where(agentId==X) + orderBy(timestamp)` exige índice composto no Firestore.
    // Para não depender de índice, ordenamos no cliente.
    const qPatrols =
      profile?.role === 'agent'
        ? query(collection(db, 'patrols'), where('agentId', '==', profile.uid), limit(200))
        : /* Limit evita sincronizar milhares de docs no APK (lento + lista “sumindo”). */
          query(collection(db, 'patrols'), orderBy('timestamp', 'desc'), limit(400));
    const unsubPatrols = onSnapshot(qPatrols, (snap) => {
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate().toISOString() : data.timestamp,
        } as PatrolRecord;
      });
      // Mantém a ordenação mais recente primeiro mesmo sem orderBy no servidor.
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setPatrols(items);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'patrols');
    });

    const qProps = query(collection(db, 'properties'));
    const unsubProps = onSnapshot(qProps, (snap) => {
      setProperties(snap.docs.map(d => ({ id: d.id, ...d.data() } as PublicProperty)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'properties');
    });

    const qOccurrences =
      profile?.role === 'agent'
        ? query(collection(db, 'occurrences'), where('agentId', '==', profile.uid), limit(200))
        : query(collection(db, 'occurrences'), orderBy('timestamp', 'desc'));
    const unsubOccurrences = onSnapshot(qOccurrences, (snap) => {
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate().toISOString() : data.timestamp,
        } as OccurrenceRecord;
      });
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setOccurrences(items);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'occurrences');
    });

    const qTeams = query(collection(db, 'teams'));
    const unsubTeams = onSnapshot(qTeams, (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() } as Team)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'teams');
    });

    const qVehicles = query(collection(db, 'vehicles'));
    const unsubVehicles = onSnapshot(qVehicles, (snap) => {
      setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'vehicles');
    });

    const unsubVehicleLocations = onSnapshot(collection(db, 'vehicle_locations'), (snap) => {
      setVehicleLocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as VehicleLocation)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'vehicle_locations');
    });

    const unsubGeofences = onSnapshot(collection(db, 'geofences'), (snap) => {
      setGeofences(snap.docs.map(d => ({ id: d.id, ...d.data() } as Geofence)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'geofences');
    });

    const unsubAlerts = onSnapshot(query(collection(db, 'alerts'), orderBy('timestamp', 'desc')), (snap) => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalAlert)));
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'alerts');
    });

    return () => {
      unsubPatrols();
      unsubProps();
      unsubOccurrences();
      unsubTeams();
      unsubVehicles();
      unsubVehicleLocations();
      unsubGeofences();
      unsubAlerts();
    };
  }, [user, profile]);

  // Real-time GPS Tracking for Agents
  useEffect(() => {
    if (!user || !profile || profile.role !== 'agent' || !profile.teamId || !profile.vehicleId) return;

    const updateLocation = async () => {
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude, speed } = pos.coords;
        const team = teams.find(t => t.id === profile.teamId);
        if (!team) return;

        const locationData: VehicleLocation = {
          id: profile.vehicleId!,
          vehicleId: profile.vehicleId!,
          vehiclePrefix: team.vehiclePrefix || 'N/A',
          teamId: team.id,
          teamName: team.name,
          driver: team.driver,
          inCharge: team.inCharge,
          aux1: team.aux1,
          aux2: team.aux2,
          latitude,
          longitude,
          speed: Math.round((speed || 0) * 3.6), // m/s to km/h
          status: 'patrolling', // Default, could be dynamic
          lastUpdate: new Date().toISOString(),
          idleTimeMinutes: 0 // Logic for idle time could be added here
        };

        try {
          await setDocClean(
            doc(db, 'vehicle_locations', profile.vehicleId!),
            locationData as unknown as Record<string, unknown>,
          );
          
          // Check Geofences
          geofences.forEach(async (fence) => {
            if (!fence.active) return;
            // Simple point-in-polygon check or radius check
            // For now, let's just log if they are near a critical area
            // (In a real app, use a library like @turf/turf)
          });

        } catch (err) {
          console.error("Error updating location:", err);
        }
      });
    };

    const interval = setInterval(updateLocation, 5000);
    return () => clearInterval(interval);
  }, [user, profile, teams, geofences]);

  // Log access to map
  useEffect(() => {
    if (activeTab === 'map' && profile) {
      const logAccess = async () => {
        try {
          await addDocClean(collection(db, 'logs'), {
            type: 'MAP_ACCESS',
            userId: user?.uid,
            userName: profile.name,
            userRole: profile.role,
            timestamp: serverTimestamp(),
            details: 'Visualização do mapa tático operacional',
          });
          // console.log(`[LOG] Map accessed by ${profile.name} (${profile.role})`);
        } catch (err) {
          console.error("Error logging map access:", err);
        }
      };
      logAccess();
    }
  }, [activeTab, profile, user]);

  // --- Handlers ---

  const [isRegistering, setIsRegistering] = useState(false);

  // Bootstrap initial geofences if empty
  useEffect(() => {
    const bootstrapGeofences = async () => {
      if (user && profile && (profile.role === 'supervisor' || profile.role === 'command') && geofences.length === 0) {
        const initialGeofences: Omit<Geofence, 'id'>[] = [
          {
            name: 'Centro Administrativo - Área Crítica',
            description: 'Zona de segurança máxima ao redor da prefeitura e câmara.',
            type: 'critical',
            coordinates: [
              [-23.5030, -47.4850],
              [-23.5030, -47.4810],
              [-23.5060, -47.4810],
              [-23.5060, -47.4850]
            ],
            active: true,
            createdAt: new Date().toISOString()
          },
          {
            name: 'Parque Municipal - Área Sensível',
            description: 'Monitoramento preventivo em áreas de lazer.',
            type: 'sensitive',
            coordinates: [
              [-23.5060, -47.4870],
              [-23.5060, -47.4840],
              [-23.5080, -47.4840],
              [-23.5080, -47.4870]
            ],
            active: true,
            createdAt: new Date().toISOString()
          }
        ];

        try {
          for (const fence of initialGeofences) {
            await addDocClean(collection(db, 'geofences'), fence as unknown as Record<string, unknown>);
          }
        } catch (err) {
          console.error("Error bootstrapping geofences:", err);
        }
      }
    };
    bootstrapGeofences();
  }, [user, profile, geofences.length]);

  const generateEndOfShiftReport = async () => {
    if (!profile) {
      alert('Perfil não carregado.');
      return;
    }

    try {
      const { filename, blob, windowStart, windowEnd, shift } = await generateEndOfShiftReportPdf({
        profile,
        patrols,
        occurrences,
        teams,
        db,
        generateGeminiText,
      });

      const teamResolved = teams.find((t) => t.id === profile.teamId);

      const sendToServerAndRegister = async () => {
        if (!user) throw new Error('Sessão expirada.');
        const idToken = await user.getIdToken();
        const reportId =
          profile.teamId?.trim()
            ? `${profile.uid}_${profile.teamId.trim()}_${windowStart.replace(/[:.]/g, '-')}`
            : `${profile.uid}_noteam_${windowStart.replace(/[:.]/g, '-')}`;
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = String(reader.result || '');
              const comma = result.indexOf(',');
              resolve(comma >= 0 ? result.slice(comma + 1) : result);
            } catch (e) {
              reject(e);
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });

        const resp = await apiFetchShiftReport('/api/shift-reports/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            filename,
            pdfBase64: base64,
            meta: {
              agentId: profile.uid,
              agentName: profile.name,
              registration: profile.registration,
              teamId: profile.teamId,
              teamName: teamResolved?.name || '',
              vehiclePrefix: teamResolved?.vehiclePrefix || '',
              shift,
              windowStart,
              windowEnd,
              reportId,
            },
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data?.error || `Falha ao enviar para o servidor (HTTP ${resp.status})`);
        }
        const data = await resp.json().catch(() => null as any);
        if (!data?.ok) {
          throw new Error(
            (typeof data?.error === 'string' && data.error) ||
              'Resposta inválida do servidor ao registrar o PDF. Se estiver no site (web.app), o upload deve ir para a API Render — atualize o app e tente novamente.',
          );
        }
      };

      try {
        const apiBase = getApiBaseUrl();
        let usedFirebase = false;
        let metadataOnly = false;
        if (apiBase) {
          try {
            await sendToServerAndRegister();
          } catch (apiErr) {
            console.warn('[shift-report] API falhou; tentando Firebase direto:', apiErr);
            try {
              await uploadShiftReportPdfToFirebase({
                profile,
                blob,
                filename,
                windowStart,
                windowEnd,
                shift,
                team: teamResolved,
              });
              usedFirebase = true;
            } catch (storageErr) {
              console.warn(
                '[shift-report] Storage falhou; gravando só metadados no Firestore:',
                storageErr,
              );
              await registerShiftReportMetadataFirestore({
                profile,
                filename,
                windowStart,
                windowEnd,
                shift,
                team: teamResolved,
              });
              usedFirebase = true;
              metadataOnly = true;
            }
          }
        } else {
          try {
            await uploadShiftReportPdfToFirebase({
              profile,
              blob,
              filename,
              windowStart,
              windowEnd,
              shift,
              team: teamResolved,
            });
            usedFirebase = true;
          } catch (storageErr) {
            console.warn(
              '[shift-report] Storage falhou (ex.: plano Spark); gravando só metadados:',
              storageErr,
            );
            await registerShiftReportMetadataFirestore({
              profile,
              filename,
              windowStart,
              windowEnd,
              shift,
              team: teamResolved,
            });
            usedFirebase = true;
            metadataOnly = true;
          }
        }
        alert(
          metadataOnly
            ? 'Plantão registrado no Painel (somente dados — sem PDF no Firebase).\n\nBaixar/Imprimir só funcionará com Storage (Blaze) ou API configurada (VITE_API_BASE_URL).'
            : usedFirebase
              ? 'Relatório guardado no Firebase Storage e registado no painel (Relatórios).'
              : 'Relatório gerado e enviado ao painel (PDF no servidor).',
        );
      } catch (sendErr) {
        console.error('Falha ao enviar relatório para o Painel do ADM:', sendErr);
        const msg =
          sendErr instanceof Error
            ? sendErr.message
            : typeof sendErr === 'string'
              ? sendErr
              : JSON.stringify(sendErr);
        alert(
          'Relatório PDF foi gerado, mas falhou ao registrar no sistema.\n\n' +
            'No APK: verifique internet e permissões do Storage/Firestore.\n\n' +
            `Detalhes: ${msg}`,
        );
        throw sendErr;
      }
    } catch (err) {
      console.error('Erro ao gerar relatório:', err);
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      alert(`Erro ao gerar/enviar relatório.\n\nDetalhes: ${msg}`);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    if (!profile) return;
    try {
      await updateDocClean(doc(db, 'alerts', alertId), {
        resolved: true,
        resolvedBy: profile.name,
        resolvedAt: new Date().toISOString(),
      });
      await logAdminAction(profile, 'RESOLVE_ALERT', `Alerta ${alertId} resolvido`, alertId, 'alert');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'alerts');
    }
  };

  const handleTriggerAlert = async (alertData: Omit<OperationalAlert, 'id' | 'resolved' | 'timestamp'>) => {
    if (!profile) return;
    try {
      const newAlert: Omit<OperationalAlert, 'id'> = {
        ...alertData,
        resolved: false,
        timestamp: new Date().toISOString(),
      };
      await addDocClean(collection(db, 'alerts'), newAlert as unknown as Record<string, unknown>);
      await logAdminAction(profile, 'TRIGGER_ALERT', `Alerta manual emitido: ${alertData.title}`, undefined, 'alert');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'alerts');
    }
  };

  // Bootstrap initial properties if empty
  useEffect(() => {
    const bootstrap = async () => {
      if (user && profile && (profile.role === 'supervisor' || profile.role === 'command') && properties.length === 0) {
        const initialProps = [
          // ... (I'll keep the list but make it more robust)
        ];
        // Only bootstrap if it's truly empty to avoid duplicates
        // Actually, I'll just remove the automatic bootstrap to avoid confusion
        // and let the user use the "Sincronizar" button if they want.
      }
    };
    bootstrap();
  }, [user, profile, properties.length]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const emailRaw = (formData.get('email') as string) || '';
    const email = emailRaw.trim().toLowerCase();
    const password = ((formData.get('password') as string) || '').toString();

    // Identificação da viatura foi movida para pós-login (configuração de equipe/plantão)

    try {
      setLoading(true);
      if (isRegistering) {
        const name = formData.get('name') as string;
        const registration = formData.get('registration') as string;
        // IMPORTANTE: cadastro nunca define admin/supervisor por conta própria.
        // O perfil/ativação é responsabilidade do administrador no Firestore.
        
        const { createUserWithEmailAndPassword } = await import('firebase/auth');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (process.env.NODE_ENV !== 'production') {
          console.log('[register] user criado:', userCredential.user.uid, email);
        }
        // Requisito: sempre logar UID criado
        console.log("UID criado:", userCredential.user.uid);
        
        const isAdminEmail = email === SUPER_ADMIN_EMAIL.trim().toLowerCase();
        const profileData: UserProfile = {
          uid: userCredential.user.uid,
          name,
          registration,
          role: isAdminEmail ? 'admin' : 'agent',
          status: isAdminEmail ? 'ATIVO' : 'PENDENTE',
          email,
          biometricEnabled: false,
          failedAttempts: 0,
          createdAt: new Date().toISOString()
        };
        
        try {
          const path = 'users';
          const docRef = doc(db, path, userCredential.user.uid);
          // Sempre salvar no Firestore imediatamente após o Auth.
          // IMPORTANTE: não sobrescrever o schema do app (role/status/createdAt),
          // senão o painel e o RBAC podem parar de funcionar.
          await setDocClean(
            docRef,
            {
              ...profileData,
              // Campos extras (compat/debug) sem quebrar o schema principal
              nome: name,
              matricula: registration || '',
              roleLabel: 'AGENTE',
              statusLabel: 'PENDENTE',
              createdAtServer: serverTimestamp(),
            },
            { merge: true },
          );
          if (process.env.NODE_ENV !== 'production') {
            console.log('[register] perfil salvo (Firestore):', profileData.uid, profileData.status);
          }
          console.log("Usuário salvo no Firestore");

          // Verificação forte: garante que o documento realmente foi persistido no Firestore.
          // Ajuda a detectar rules/permissão/offline antes de "sumir" do painel admin.
          const verifySnap = await getDocFromServer(docRef).catch(() => getDoc(docRef));
          if (!verifySnap.exists()) {
            throw new Error('Perfil não persistido no Firestore (doc ausente).');
          }
          const saved = verifySnap.data() as any;
          if (saved?.status !== profileData.status) {
            throw new Error(`Perfil inconsistente no Firestore (status=${saved?.status}).`);
          }
          if (process.env.NODE_ENV !== 'production') {
            console.log('[register] Usuário salvo no Firestore:', profileData.uid, saved?.status);
          }
          // Se não for admin, não deixa "entrar" no app agora.
          // O usuário só acessa após o administrador alterar status para ATIVO.
          if (!isAdminEmail) {
            // Garante no backend (Admin SDK) que o perfil PENDENTE foi persistido e notifica o admin.
            // Isso evita depender de rules/cache e garante que apareça no painel do administrador.
            try {
              const idToken = await userCredential.user.getIdToken();
              await fetch('/api/registration/request', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                  name,
                  registration,
                  email,
                }),
              });
              await fetch('/api/notifications/pending-user', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
              });
            } catch (notifyErr) {
              console.warn('Falha ao notificar admin sobre cadastro pendente:', notifyErr);
            }

            setError('Cadastro realizado! Aguarde a autorização do administrador para acessar o sistema.');
            try {
              await signOut(auth);
            } catch {}
            return;
          } else {
            setProfile(profileData);
          }
          
          // Audit log
          await fetch('/api/audit-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userCredential.user.uid,
              userName: name,
              type: 'Senha',
              success: true
            })
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'users');
          setError('Conta criada no Auth, mas falhou ao salvar perfil no Firestore (regras/permissão). Peça ao admin para ajustar as regras e tente novamente.');
          try {
            await signOut(auth);
          } catch {}
          return;
        }
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        setLastLoginTime(Date.now());
        
        // Audit log
        if (profile) {
          await fetch('/api/audit-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userCredential.user.uid,
              userName: profile.name,
              type: 'Senha',
              success: true
            })
          });
        }
      }
      setVehicleId('');
      setError(null);
    } catch (err: any) {
      console.error(err);
      const code = err?.code as string | undefined;

      // Caso especial: e-mail já existe, mas o usuário quer "solicitar cadastro".
      // Tentamos autenticar e garantir o perfil PENDENTE no Firestore + notificar admin.
      if (code === 'auth/email-already-in-use' && isRegistering) {
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          const u = cred.user;
          console.log('UID criado:', u.uid);

          const docRef = doc(db, 'users', u.uid);
          const snap = await getDocFromServer(docRef).catch(() => getDoc(docRef));
          const existing = snap.exists() ? (snap.data() as any) : null;

          // Se não existir perfil, cria como PENDENTE
          if (!existing) {
            const pendingProfile: UserProfile = {
              uid: u.uid,
              name: (formData.get('name') as string) || (u.email ? u.email.split('@')[0] : 'Usuário'),
              registration: (formData.get('registration') as string) || '',
              role: 'agent',
              status: 'PENDENTE',
              email: u.email || email,
              biometricEnabled: false,
              failedAttempts: 0,
              createdAt: new Date().toISOString(),
            };
            await setDocClean(docRef, pendingProfile as unknown as Record<string, unknown>, { merge: true });
          }

          // Notifica admin (best-effort)
          try {
            const idToken = await u.getIdToken();
            await fetch('/api/registration/request', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                name: (formData.get('name') as string) || '',
                registration: (formData.get('registration') as string) || '',
                email,
              }),
            });
            await fetch('/api/notifications/pending-user', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
            });
          } catch (notifyErr) {
            console.warn('Falha ao notificar admin sobre cadastro pendente (email em uso):', notifyErr);
          }

          setError('Solicitação registrada. Aguarde a autorização do administrador para acessar o sistema.');
          try {
            await signOut(auth);
          } catch {}
          return;
        } catch (e: any) {
          const c = e?.code as string | undefined;
          if (c === 'auth/invalid-credential' || c === 'auth/wrong-password') {
            setError('Este e-mail já existe, mas a senha informada está incorreta. Use a senha correta para registrar a solicitação.');
            return;
          }
          setError('Não foi possível registrar sua solicitação automaticamente. Tente entrar com sua conta e, se ainda não estiver autorizado, o sistema registrará sua solicitação.');
          return;
        }
      }

      // Conta criada só com Google: e-mail/senha nunca vai funcionar até criar senha no Firebase ou usar Google.
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, email);
          if (methods.includes('google.com') && !methods.includes('password')) {
            setError(
              'Este e-mail está vinculado ao Google. Use «Entrar com Google» neste aparelho (ou peça ao administrador para adicionar login por senha no Firebase).',
            );
            setLoading(false);
            return;
          }
          if (
            methods.length === 0 &&
            (code === 'auth/user-not-found' || code === 'auth/invalid-credential')
          ) {
            setError(
              'Não há conta com este e-mail ou a proteção anti-enumeração ocultou os métodos. Tente «Entrar com Google» ou confira o e-mail digitado.',
            );
            setLoading(false);
            return;
          }
        } catch {
          /* fetchSignInMethods pode falhar com proteção do projeto */
        }
      }

      const msg =
        code === 'auth/user-disabled'
          ? 'Sua conta está bloqueada/desativada no sistema. Peça ao administrador para desbloquear.'
          : code === 'auth/invalid-credential' || code === 'auth/wrong-password'
            ? 'E-mail ou senha incorretos. Se você costuma entrar com Google, use «Entrar com Google». Confira também CAPS LOCK e espaços.'
          : code === 'auth/user-not-found'
            ? 'Nenhuma conta encontrada com este e-mail. Cadastre-se, use Google ou confira o endereço.'
            : code === 'auth/invalid-email'
              ? 'E-mail inválido.'
              : code === 'auth/email-already-in-use'
                ? 'Este e-mail já está em uso. Clique em "Entrar" com esse e-mail/senha; se ainda não estiver autorizado, o sistema vai registrar sua solicitação para o administrador aprovar.'
                : code === 'auth/weak-password'
                  ? 'Senha fraca (mínimo 6 caracteres).'
                  : code === 'auth/operation-not-allowed'
                    ? 'Login por e-mail/senha está desativado no projeto Firebase. No Console → Authentication → Sign-in method, ative «E-mail/senha». Quem só tem conta Google deve usar «Entrar com Google».'
                    : (err?.message || code)
                      ? `Falha no login/cadastro: ${code || err.message}`
                      : 'Erro no processo. Verifique os dados ou se a conta está bloqueada.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const [isBiometricSupported, setIsBiometricSupported] = useState<boolean>(false);
  const [biometricSupportMsg, setBiometricSupportMsg] = useState<string>('Verificando suporte...');

  useEffect(() => {
    const checkSupport = async () => {
      // APK (Capacitor): WebAuthn não é confiável no WebView; usamos biometria nativa.
      if (isNativeApp()) {
        try {
          const mod = await import('@capgo/capacitor-native-biometric');
          const { NativeBiometric } = mod as any;
          const availability = await NativeBiometric.isAvailable();
          const ok = !!availability?.isAvailable;
          setIsBiometricSupported(ok);
          setBiometricSupportMsg(ok ? 'Suportado e pronto para uso' : 'Não suportado neste dispositivo');
        } catch (e) {
          setIsBiometricSupported(false);
          setBiometricSupportMsg('Não suportado neste dispositivo');
        }
        return;
      }

      if (!window.PublicKeyCredential) {
        setIsBiometricSupported(false);
        setBiometricSupportMsg('Não suportado neste navegador');
        return;
      }

      if (!window.isSecureContext) {
        setIsBiometricSupported(false);
        setBiometricSupportMsg('Requer conexão segura (HTTPS)');
        return;
      }

      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        setIsBiometricSupported(available);
        setBiometricSupportMsg(available ? 'Suportado e pronto para uso' : 'Nenhum autenticador biométrico encontrado');
      } catch (e) {
        console.error('Error checking biometric support:', e);
        setIsBiometricSupported(false);
        setBiometricSupportMsg('Erro ao verificar suporte');
      }
    };

    checkSupport();
  }, []);

  // Admin notifications: pending approvals
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.role !== 'admin' || profile.status !== 'ATIVO') return;

    const qPend = query(collection(db, 'users'), where('status', '==', 'PENDENTE'));
    const unsub = onSnapshot(qPend, (snap) => {
      const count = snap.size;
      setPendingUsersCount(count);
      if (count > 0 && !hasShownPendingAlertRef.current) {
        hasShownPendingAlertRef.current = true;
        // Simples e claro (web + APK). O admin pode abrir o painel e aprovar.
        alert(`Você tem ${count} cadastro(s) pendente(s) para aprovação no Painel Administrativo.`);
        setShowAdminPanel(true);
      }
    }, (err) => {
      console.error('Erro ao consultar usuários pendentes:', err);
    });

    return () => unsub();
  }, [user, profile]);

  const handleBiometricLogin = async () => {
    if (!isBiometricSupported) {
      alert(`Biometria não disponível: ${biometricSupportMsg}`);
      return;
    }

    // No APK: use biometria nativa como "desbloqueio" de sessão já persistida pelo Firebase.
    // Se o usuário ainda não tem sessão salva, ele precisa logar 1x com e-mail/senha.
    if (isNativeApp()) {
      try {
        const mod = await import('@capgo/capacitor-native-biometric');
        const { NativeBiometric } = mod as any;
        await NativeBiometric.verifyIdentity({
          reason: 'Autenticação biométrica para acessar o SIGMA-GCM',
          title: 'SIGMA-GCM',
          subtitle: 'Confirme sua identidade',
          description: 'Use sua biometria para desbloquear o acesso',
        });
        if (!auth.currentUser) {
          alert('Biometria confirmada, mas não há sessão salva neste aparelho. Faça login 1 vez com e-mail/senha.');
          return;
        }
        alert('Acesso liberado com biometria!');
        return;
      } catch (e: any) {
        console.error('Native biometrics error:', e);
        alert('Biometria não disponível ou cancelada.');
        return;
      }
    }

    const registration = prompt('Informe sua matrícula para login biométrico:');
    if (!registration) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Get options from server
      const optionsRes = await fetch(`/api/webauthn/login-options?registration=${encodeURIComponent(registration)}`);
      if (!optionsRes.ok) {
        const err = await optionsRes.json();
        throw new Error(err.error || 'Erro ao buscar opções de biometria. Verifique se sua matrícula está correta e se a biometria foi ativada.');
      }
      const options = await optionsRes.json();

      // 2. Start authentication
      const assertion = await startAuthentication(options);

      // 3. Verify with server
      const verifyRes = await fetch('/api/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: assertion, registration }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || 'Falha na verificação biométrica');
      }

      const { firebaseCustomToken } = await verifyRes.json();
      if (!firebaseCustomToken) {
        throw new Error('Servidor não retornou token do Firebase. Atualize o servidor e tente novamente.');
      }

      // Troca custom token por sessão Firebase real
      await signInWithCustomToken(auth, firebaseCustomToken);
      setLastLoginTime(Date.now());
      
      alert('Autenticação biométrica realizada com sucesso!');
    } catch (err: any) {
      console.error('Biometric Login Error:', err);
      setError(err.message || 'Erro na autenticação biométrica');
      alert('Erro na biometria: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  const handleEnableBiometrics = async () => {
    if (!profile || !user) return;

    if (!isBiometricSupported) {
      alert(`Biometria não disponível: ${biometricSupportMsg}`);
      return;
    }

    try {
      setLoading(true);

      // No APK: não usamos WebAuthn; apenas marcamos o perfil como "biometria habilitada".
      // A autenticação em si é feita localmente via biometria nativa (desbloqueio do app).
      if (isNativeApp()) {
        try {
          const mod = await import('@capgo/capacitor-native-biometric');
          const { NativeBiometric } = mod as any;
          await NativeBiometric.verifyIdentity({
            reason: 'Habilitar biometria para acesso rápido',
            title: 'SIGMA-GCM',
          });
        } catch (e) {
          throw new Error('Não foi possível validar a biometria neste aparelho.');
        }

        await updateDocClean(doc(db, 'users', profile.uid), { biometricEnabled: true });
        setProfile({ ...profile, biometricEnabled: true });
        alert('Biometria habilitada com sucesso neste dispositivo!');
        return;
      }
      
      // 1. Get options from server
      const optionsRes = await fetch(`/api/webauthn/register-options?userId=${profile.uid}&userName=${encodeURIComponent(profile.name)}`);
      if (!optionsRes.ok) {
        const err = await optionsRes.json();
        throw new Error(err.error || 'Erro ao obter opções de registro');
      }
      const options = await optionsRes.json();

      // 2. Start registration
      const credential = await startRegistration(options);

      // 3. Verify with server
      const verifyRes = await fetch('/api/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: credential, userId: profile.uid }),
      });

      if (verifyRes.ok) {
        setProfile({ ...profile, biometricEnabled: true });
        alert('Biometria habilitada com sucesso neste dispositivo!');
      } else {
        const err = await verifyRes.json();
        throw new Error(err.error || 'Falha ao verificar biometria no servidor');
      }
    } catch (err: any) {
      console.error('Enable Biometrics Error:', err);
      alert('Erro ao habilitar biometria: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteGoogleRegistration = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const registration = formData.get('registration') as string;

    try {
      setLoading(true);
      const isAdminEmail = user.email === SUPER_ADMIN_EMAIL;

      const profileData: UserProfile = {
        uid: user.uid,
        name,
        registration,
        // Segurança: ninguém escolhe admin no cadastro. Só e-mails "whitelist" viram admin.
        role: isAdminEmail ? 'admin' : 'agent',
        status: isAdminEmail ? 'ATIVO' : 'PENDENTE',
        email: user.email || '',
        createdAt: new Date().toISOString()
      };
      // Firestore NÃO aceita `undefined`. Só adiciona photoUrl se existir.
      if (user.photoURL) {
        (profileData as any).photoUrl = user.photoURL;
      }

      const docRef = doc(db, 'users', user.uid);
      await setDocClean(docRef, profileData as unknown as Record<string, unknown>, { merge: true });

      if (!isAdminEmail) {
        // Notificação interna (backend) para admin aprovar o cadastro.
        // Best-effort: se falhar, não bloqueia o fluxo.
        try {
          const idToken = await user.getIdToken();
          await fetch('/api/notifications/pending-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
          });
        } catch (notifyErr) {
          console.warn('Falha ao notificar admin sobre cadastro pendente:', notifyErr);
        }

        setProfile(null);
        setError('Cadastro enviado para aprovação do administrador. Aguarde a liberação para acessar.');
        try {
          await signOut(auth);
        } catch {}
        return;
      }

      setProfile(profileData);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Erro ao concluir cadastro: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      // getPlatform() === 'web' é mais confiável que !isNativePlatform() (evita cair no fluxo nativo+Firebase no browser e dar auth/unauthorized-domain).
      if (Capacitor.getPlatform() === 'web') {
        window.location.href = '/api/auth/google/start';
        return;
      }
      const result = await GoogleSignIn.signIn();
      const idToken = result.idToken;
      if (!idToken) {
        throw new Error('Google Sign-In não retornou idToken.');
      }
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      // Profile check and completion will be handled by the UI when profile is null
      setError(null);
    } catch (err: any) {
      console.error(err);
      const code = err?.code as string | undefined;
      const msg =
        code === 'auth/unauthorized-domain'
          ? 'Este domínio não está autorizado no Firebase. Em Authentication → Configurações → Domínios autorizados, inclua exatamente: ' +
            (typeof window !== 'undefined' ? window.location.hostname : 'seu-site')
          : code === 'auth/popup-blocked'
            ? 'O navegador bloqueou o login do Google. Permita pop-ups para este site ou tente outro navegador.'
            : code === 'auth/popup-closed-by-user'
              ? 'Login do Google foi cancelado. Tente novamente.'
              : 'Erro ao entrar com Google: ' + (err.message || 'Erro desconhecido');
      setError(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const processPhotoUpload = async (file: Blob | File) => {
    if (!profile) {
      alert('Perfil não carregado. Tente novamente.');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem é muito grande. O limite é 5MB.');
      return;
    }

    // Validate file type (only if it's a File object)
    if (file instanceof File && !file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: any;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
      });
      try {
        return await Promise.race([p, timeout]);
      } finally {
        try { clearTimeout(timer); } catch {}
      }
    };

    try {
      setPhotoLoading(true);
      setPhotoLoadingStep('PREPARANDO');
      const contentType =
        file instanceof File ? (file.type || 'image/jpeg') : ((file as any).type || 'image/jpeg');
      const ext =
        contentType === 'image/png'
          ? 'png'
          : contentType === 'image/webp'
            ? 'webp'
            : 'jpg';
      const version = Date.now();
      const storageRef = ref(storage, `profiles/${profile.uid}/avatar_${version}.${ext}`);
      
      // Upload to Firebase Storage with timeout
      setPhotoLoadingStep('UPLOAD');
      // Em alguns Android WebViews, uploadBytes(Blob) pode "pendurar".
      // Enviamos como bytes para maior compatibilidade.
      const bytes = new Uint8Array(await withTimeout(file.arrayBuffer(), 15_000, 'READ_FILE_BYTES'));
      await withTimeout(
        uploadBytes(storageRef, bytes, { contentType, cacheControl: 'public,max-age=31536000,immutable' }),
        45_000,
        'UPLOAD',
      );
      
      // Get download URL
      setPhotoLoadingStep('DOWNLOAD_URL');
      const photoUrl = await withTimeout(getDownloadURL(storageRef), 20_000, 'DOWNLOAD_URL');
      
      // Update user profile in Firestore
      setPhotoLoadingStep('FIRESTORE_UPDATE');
      const path = 'users';
      await withTimeout(
        updateDocClean(doc(db, path, profile.uid), { photoUrl, photoVersion: version }),
        20_000,
        'FIRESTORE_UPDATE',
      );

      // Also update Firebase Auth profile (keeps Google/photo sync consistent across sessions)
      try {
        setPhotoLoadingStep('AUTH_PROFILE');
        const { updateProfile } = await import('firebase/auth');
        if (auth.currentUser) {
          await withTimeout(updateProfile(auth.currentUser, { photoURL: photoUrl }), 15_000, 'AUTH_PROFILE');
        }
      } catch (e) {
        console.warn('Falha ao sincronizar photoURL no Firebase Auth (ok):', e);
      }
      
      // Update local state
      setProfile({ ...profile, photoUrl, photoVersion: version });
      alert('Foto de perfil atualizada com sucesso!');
    } catch (err) {
      console.error('Erro no upload da foto:', err);
      let errorMessage = 'Erro ao atualizar foto.';
      
      if (err instanceof Error) {
        if (err.message.startsWith('TIMEOUT:')) {
          const step = err.message.split(':')[1] || 'PROCESSO';
          errorMessage = `Tempo excedido ao atualizar foto (${step}). Verifique sua conexão e tente novamente.`;
        } else if (err.message.includes('storage/unauthorized')) {
          errorMessage = 'Sem permissão para upload. Verifique as regras do Firebase Storage.';
        } else if (err.message.includes('storage/')) {
          errorMessage = 'Falha no Storage. Verifique conexão/permissões do Firebase Storage.';
        } else {
          errorMessage += ' ' + err.message;
        }
      }
      
      alert(errorMessage);
    } finally {
      setPhotoLoading(false);
      setPhotoLoadingStep(null);
      // Reset input value to allow selecting same file again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processPhotoUpload(file);
  };

  const handlePhotoClick = async () => {
    if (photoLoading) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: true,
          resultType: CameraResultType.Uri,
          source: CameraSource.Prompt,
          promptLabelHeader: 'Foto de Perfil',
          promptLabelPhoto: 'Escolher da Galeria',
          promptLabelPicture: 'Tirar Foto'
        });

        const pickUrl = image.webPath || (image.path ? Capacitor.convertFileSrc(image.path) : null);
        if (pickUrl) {
          // Evita travar indefinidamente em alguns WebViews caso o fetch do arquivo não resolva.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15_000);
          try {
            const response = await fetch(pickUrl, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`Falha ao ler imagem (${response.status} ${response.statusText})`);
            }
            const blob = await response.blob();
            if (!blob || blob.size === 0) {
              throw new Error('Imagem inválida (arquivo vazio).');
            }
            await processPhotoUpload(blob);
          } finally {
            clearTimeout(timer);
          }
        }
      } catch (err) {
        console.error('Erro ao capturar foto:', err);
        // User might have cancelled
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleSyncGooglePhoto = async () => {
    if (!user || !profile || !user.photoURL) return;
    
    try {
      setPhotoLoading(true);
      const photoUrl = user.photoURL;
      const path = 'users';
      const version = Date.now();
      await updateDocClean(doc(db, path, profile.uid), { photoUrl, photoVersion: version });
      setProfile({ ...profile, photoUrl, photoVersion: version });
      alert('Foto sincronizada com o Google!');
    } catch (err) {
      console.error('Erro ao sincronizar foto:', err);
      alert('Erro ao sincronizar foto: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPhotoLoading(false);
    }
  };

  const handleLogout = async () => {
    // Se o relatório do plantão estiver pendente, bloqueia logout até enviar.
    // Checamos na hora do clique para evitar depender apenas do timer.
    try {
      if (profile && profile.teamId && profile.role !== 'admin') {
        const team = teams.find((t) => t.id === profile.teamId);
        if (team) {
          const now = new Date();
          const window = getShiftWindow(now, team.shift);
          const startIso = window.start.toISOString();
          const hasReport = recentShiftReports.some(
            (r) => r.teamId === profile.teamId && r.windowStart === startIso,
          );
          // Regra rígida: não permite sair enquanto não existir relatório do plantão atual.
          if (!hasReport || forceShiftReportModal) {
            setForceShiftReportWindow({ start: window.start, end: window.end, label: window.label });
            setForceShiftReportModal(true);
            setPendingLogoutAfterReport(true);
            setShowProfileModal(false);
            alert('Relatório do plantão pendente. Gere e envie o relatório antes de sair.');
            return;
          }
        } else if (forceShiftReportModal) {
          setShowProfileModal(false);
          alert('Relatório do plantão pendente. Gere e envie o relatório antes de sair.');
          return;
        }
      } else if (forceShiftReportModal) {
        setShowProfileModal(false);
        alert('Relatório do plantão pendente. Gere e envie o relatório antes de sair.');
        return;
      }
    } catch (e) {
      console.warn('Falha ao validar pendência de relatório no logout:', e);
      if (forceShiftReportModal) return;
    }
    await signOut(auth);
  };

  const handleDeleteProperty = (id: string, name: string) => {
    setPropertyToDelete({ id, name });
    setShowDeleteConfirmModal(true);
  };

  const confirmDeleteProperty = async () => {
    if (!propertyToDelete) return;
    
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'properties', propertyToDelete.id));
      setShowDeleteConfirmModal(false);
      setPropertyToDelete(null);
      // We don't need alert() here, the UI will update automatically via onSnapshot
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'properties');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProperty = (prop: PublicProperty) => {
    setEditingProperty(prop);
    setShowEditPropertyModal(true);
  };

  const handleUpdateTeam = async () => {
    if (!user || !profile) return;
    if (profile.role === 'admin') {
      alert(
        'Contas administrativas não utilizam plantão/equipe neste painel. Gerencie equipes pelo Painel Administrativo.',
      );
      setIsEditingTeam(false);
      return;
    }
    setLoading(true);
    try {
      const teamResolved = await resolveOperationalTeam(
        db,
        user.uid,
        profile.teamId,
        teams,
      );
      if (!teamResolved) {
        alert(
          'Não foi possível localizar sua equipe (rede ou vínculo no sistema). Verifique a internet, abra Configurar plantão ou peça ao administrador para conferir seu vínculo em Equipes.',
        );
        return;
      }

      const prevTid = profile.teamId?.trim() ?? "";
      if (!prevTid || teamResolved.id !== prevTid) {
        try {
          await setDocClean(doc(db, 'users', user.uid), { teamId: teamResolved.id }, { merge: true });
          setProfile((prev) => (prev ? { ...prev, teamId: teamResolved.id } : prev));
          setTeamId(teamResolved.id);
        } catch (e) {
          console.warn('[plantão] ajuste de teamId no perfil:', e);
        }
      }

      const teamRef = doc(db, 'teams', teamResolved.id);
      let agentIds = teamResolved.agentIds;
      try {
        const fresh = await getDocFromServer(teamRef);
        if (fresh.exists()) {
          agentIds = (fresh.data().agentIds as string[] | undefined) ?? agentIds;
        }
      } catch {
        /* usa agentIds já resolvidos */
      }
      if (!agentIds?.includes(user.uid)) {
        await updateDocClean(teamRef, { agentIds: arrayUnion(user.uid) });
      }

      const updatedData = {
        name: editTeamName,
        vehiclePrefix: editVehiclePrefix,
        driver: editDriver,
        inCharge: editInCharge,
        aux1: editAux1,
        aux2: editAux2,
      };

      await updateDocClean(teamRef, updatedData as unknown as Record<string, unknown>);
      setIsEditingTeam(false);
      alert('Dados do plantão atualizados com sucesso!');
    } catch (err: unknown) {
      console.error('Error updating team:', err);
      const fe = err as { code?: string; message?: string };
      const code = fe?.code || '';
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'permission-denied' || msg.toLowerCase().includes('permission')) {
        alert(
          'Sem permissão para salvar esta equipe. Confira no Firebase se as regras foram publicadas (deploy) e se seu perfil tem o campo teamId correto.',
        );
      } else if (code === 'not-found' || msg.includes('No document to update')) {
        alert('Equipe não encontrada. Configure o plantão novamente no perfil.');
      } else if (code === 'unavailable' || msg.includes('offline')) {
        alert('Serviço temporariamente indisponível ou sem internet. Tente novamente.');
      } else {
        alert(`Erro ao salvar o plantão (${code || 'desconhecido'}). Se persistir, avise o administrador.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetupTeamVehicle = async (teamData: Partial<Team>) => {
    if (!user || !profile) return;
    setSetupTeamVehicleSaving(true);
    try {
      // Create a new team entry for this shift
      const teamRef = await addDocClean(collection(db, 'teams'), {
        ...teamData,
        agentIds: [user.uid],
        createdAt: new Date().toISOString(),
        active: true,
      });

      const userRef = doc(db, 'users', user.uid);
      const updatedData = {
        teamId: teamRef.id,
        vehicleId: teamData.vehicleId || ''
      };
      
      // `setDoc(merge)` evita falha caso o doc ainda não exista (updateDoc falha).
      await setDocClean(userRef, updatedData as unknown as Record<string, unknown>, { merge: true });
      
      // Update local profile immediately to avoid waiting for snapshot
      setProfile((prev) => (prev ? { ...prev, ...updatedData } : prev));
      setTeamId(teamRef.id);
      setVehicleId(teamData.vehicleId || '');

      void getDocFromServer(doc(db, 'teams', teamRef.id)).catch(() => {
        /* aquece cache servidor no APK após criar plantão */
      });

      setShowTeamVehicleSetup(false);
      alert('Plantão configurado com sucesso!');
    } catch (err) {
      console.error("Error setting up team/vehicle:", err);
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    } finally {
      setSetupTeamVehicleSaving(false);
    }
  };

  const handleAdminCreateUser = async (data: {
    name: string;
    registration: string;
    email: string;
    password: string;
    role: UserRole;
  }) => {
    if (!user || !profile) throw new Error('Não autenticado.');

    // 1) Caminho preferido (funciona no APK e no web): cria usuário sem trocar sessão usando Auth secundário
    try {
      const { createUserWithEmailAndPassword, updateProfile, signOut } = await import('firebase/auth');
      const secondaryAuth = await getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondaryAuth, data.email, data.password);
      await updateProfile(cred.user, { displayName: data.name });

      const profileData: UserProfile = {
        uid: cred.user.uid,
        name: data.name,
        registration: data.registration,
        role: data.role,
        status: 'PENDENTE',
        email: data.email,
        biometricEnabled: false,
        failedAttempts: 0,
        createdAt: new Date().toISOString(),
      };

      await setDocClean(doc(db, 'users', cred.user.uid), profileData as unknown as Record<string, unknown>, { merge: true });
      // Garante que não fica “logado” no auth secundário.
      await signOut(secondaryAuth);
      return;
    } catch (err) {
      // 2) Fallback opcional: se você quiser manter o backend web, tenta também.
      // No APK isso deve falhar (sem servidor), então seguimos com a mensagem do erro do caminho 1.
      console.warn('Admin create via secondary auth failed; trying backend fallback.', err);
    }

    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(json?.error || 'Falha ao criar usuário.');
  };

  const openQrScanner = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const perm = await Camera.requestPermissions({ permissions: ['camera'] as any });
        const state = (perm as any)?.camera ?? (perm as any)?.permissions?.camera;
        if (state === 'denied') {
          alert('Permissão de câmera negada. Ative em Configurações do Android > Apps > SIGMA-GCM > Permissões.');
          return;
        }
      } catch (e) {
        console.error('Camera permission request failed:', e);
      }
    }
    setShowScanner(true);
  };

  const [patrolMessage, setPatrolMessage] = useState<string>('');
  /** Não usar `loading` global na ronda — senão o APK inteiro vira “Carregando sistema…” por vários segundos. */
  const [patrolFlowBusy, setPatrolFlowBusy] = useState(false);

  const handleScan = (qrCode: string) => {
    // console.log("QR Code Scanned:", qrCode);
    if (!profile) {
      alert('Perfil não carregado. Por favor, faça login novamente.');
      return;
    }

    if (properties.length === 0) {
      alert('A base de dados de propriedades está vazia. Por favor, use o botão "Sincronizar" no menu de configurações.');
      return;
    }

    const property = properties.find(p => 
      p.qrCode === qrCode || 
      p.id === qrCode || 
      p.name === qrCode
    );

    if (!property) {
      console.warn("Property not found for QR:", qrCode);
      alert(`Propriedade não encontrada: ${qrCode}`);
      return;
    }
    
    setScannedProperty(property);
    setShowScanner(false);
  };

  const handleSimulateScan = (property: PublicProperty) => {
    if (!profile) {
      alert('Perfil não carregado. Por favor, faça login novamente.');
      return;
    }
    if (!property?.qrCode) {
      alert('Propriedade inválida para simulação.');
      return;
    }
    // Fecha scanner e abre modal da propriedade.
    setScannedProperty(property);
    setShowScanner(false);

    // Em seguida, executa a ronda com posição simulada = coordenadas do próprio ponto (distância 0m).
    // Usamos um pequeno delay para garantir que o state foi aplicado.
    setTimeout(() => {
      const a = patrolAnchorFromProperty(property);
      void confirmPatrol({ latitude: a.latitude, longitude: a.longitude }, property);
    }, 50);
  };

  const confirmPatrol = async (
    simulatedPos?: { latitude: number, longitude: number },
    propertyOverride?: PublicProperty,
  ) => {
    if (!profile) {
      alert('Perfil não carregado. Por favor, faça login novamente.');
      return;
    }

    if (!profile.teamId) {
      // UX: ao invés de apenas alertar, encaminha direto para configurar o plantão.
      // Fecha o modal atual para não parecer "travado".
      setScannedProperty(null);
      setShowTeamVehicleSetup(true);
      return;
    }

    const selectedProperty = propertyOverride ?? scannedProperty;
    if (!selectedProperty) {
      alert('Nenhuma propriedade selecionada.');
      return;
    }

    // Validate property coordinates
    if (typeof selectedProperty.latitude !== 'number' || typeof selectedProperty.longitude !== 'number') {
      console.error("Invalid property coordinates:", selectedProperty);
      alert('Erro: Coordenadas da propriedade inválidas ou não encontradas.');
      return;
    }

    // If simulated position is provided, use it directly
    if (simulatedPos) {
      // console.log("Using simulated position:", simulatedPos);
      setPatrolMessage("Processando localização simulada...");
      setPatrolFlowBusy(true);
      await processPatrol(selectedProperty, simulatedPos.latitude, simulatedPos.longitude, {
        simulatedLocation: true,
      });
      return;
    }

    // Get GPS
    if (!navigator.geolocation) {
      alert('GPS não suportado pelo seu navegador.');
      return;
    }
    
    setPatrolFlowBusy(true);
    setPatrolMessage("Solicitando GPS...");
    // console.log("Requesting GPS for property:", scannedProperty.name);

    const geoOptions = {
      enableHighAccuracy: true,
      timeout: 20000, // 20 seconds timeout
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setPatrolMessage("GPS Recebido. Validando...");
      await processPatrol(selectedProperty, latitude, longitude, {
        accuracyMeters: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
      });
    }, (err) => {
      console.error("GPS Error:", err);
      let msg = 'Erro ao obter localização GPS.';
      if (err.code === 1) msg = 'Permissão de GPS negada.';
      if (err.code === 2) msg = 'Localização indisponível (verifique se o GPS está ligado).';
      if (err.code === 3) msg = 'Tempo esgotado ao tentar obter localização.';
      
      setPatrolMessage("");
      alert(`${msg} (Erro: ${err.message})`);
      setPatrolFlowBusy(false);
    }, geoOptions);
  };

  const processPatrol = async (
    property: PublicProperty,
    latitude: number,
    longitude: number,
    gpsMeta?: PatrolGpsMeta,
  ) => {
    try {
      const profileTeamId = profile?.teamId?.trim();
      if (!profile) {
        throw new Error("Perfil não carregado. Faça login novamente.");
      }

      const simulated = !!gpsMeta?.simulatedLocation;
      const accRaw = gpsMeta?.accuracyMeters;
      const acc = typeof accRaw === 'number' && Number.isFinite(accRaw) ? accRaw : null;

      if (!simulated && acc != null && acc > PATROL_GPS_ACCURACY_BLOCK_M) {
        setPatrolMessage('');
        setPatrolFlowBusy(false);
        alert(
          `GPS impreciso demais (±${Math.round(acc)} m). Limite para registrar: ±${PATROL_GPS_ACCURACY_BLOCK_M} m. Aguarde melhor sinal ou vá a área aberta.`,
        );
        return;
      }

      const allowedRadius = resolvePatrolRadiusMeters(property);
      const anchor = patrolAnchorFromProperty(property);
      const distance = calculateDistanceMeters(
        latitude,
        longitude,
        anchor.latitude,
        anchor.longitude,
      );
      const validationStatus: PatrolValidationStatus =
        distance <= allowedRadius ? 'VALIDO' : 'FORA_DO_RAIO';
      const gpsLowConfidence = !simulated && acc != null && acc > PATROL_GPS_LOW_CONFIDENCE_M;

      let currentPlusCode = 'N/A';
      try {
        // @ts-ignore
        const OLC = OpenLocationCode.OpenLocationCode || OpenLocationCode;
        const olc = new OLC();
        currentPlusCode = olc.encode(latitude, longitude);
      } catch (olcErr) {
        console.warn("Plus Code generation failed, continuing without it:", olcErr);
      }

      setPatrolMessage("Salvando registro no sistema...");

      const tidNorm = profile.teamId?.trim() ?? '';
      /** 1) Cache React (instantâneo — evita travar no desktop se o listener já trouxe a equipe). */
      let team: Team | null = tidNorm
        ? teams.find((t) => t.id === tidNorm) ?? null
        : null;

      /** 2) Resolver via Firestore com teto de tempo — getDocs sem resposta pode pendurar a UI indefinidamente. */
      const PATROL_TEAM_RESOLVE_MS = 12000;
      if (!team) {
        try {
          team = await Promise.race([
            resolveOperationalTeam(db, profile.uid, profile.teamId?.trim(), teams),
            new Promise<null>((resolve) => {
              window.setTimeout(() => {
                console.warn(
                  '[patrol] resolução de equipe excedeu',
                  PATROL_TEAM_RESOLVE_MS,
                  'ms; usando fallbacks.',
                );
                resolve(null);
              }, PATROL_TEAM_RESOLVE_MS);
            }),
          ]);
        } catch {
          team = null;
        }
      }

      if (!team && tidNorm) {
        try {
          const ref = doc(db, 'teams', tidNorm);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            team = { id: snap.id, ...snap.data() } as Team;
          }
        } catch (e) {
          console.warn('[patrol] último getDoc da equipe:', e);
        }
      }

      let usedPatrolTeamFallback = false;
      if (!team && tidNorm) {
        console.warn(
          '[patrol] equipe não carregada do servidor; usando dados mínimos do perfil. teamId:',
          tidNorm,
        );
        team = fallbackTeamForPatrol(profile, tidNorm);
        usedPatrolTeamFallback = true;
      }

      if (!team) {
        console.error("Team not resolved. profile.teamId:", profile.teamId);
        throw new Error(
          "Sem equipe vinculada ao perfil (teamId). Abra o plantão e salve viatura + equipe, ou peça ao administrador para corrigir seu cadastro.",
        );
      }

      if (!profileTeamId || team.id !== profileTeamId) {
        try {
          await setDocClean(doc(db, "users", profile.uid), { teamId: team.id }, { merge: true });
          setProfile((prev) => (prev ? { ...prev, teamId: team.id } : prev));
          setTeamId(team.id);
        } catch (e) {
          console.warn("[patrol] sincronizar teamId no perfil:", e);
        }
      }

      const effectiveTeamId = team.id;

      let baseObservation = usedPatrolTeamFallback
        ? 'Ronda via QR Code. Detalhes do plantão não foram lidos do servidor — confira teamId e documento da equipe no Firebase.'
        : 'Ronda realizada com sucesso via QR Code.';
      const obsParts: string[] = [];
      if (validationStatus === 'FORA_DO_RAIO') {
        obsParts.push(
          `VALIDAÇÃO ANTIFRAUDE: FORA_DO_RAIO (~${Math.round(distance)} m do posto; permitido ${allowedRadius} m).`,
        );
      }
      if (gpsLowConfidence && acc != null) {
        obsParts.push(`GPS com baixa confiança (precisão ±${Math.round(acc)} m).`);
      }
      if (simulated) {
        obsParts.push('Localização simulada (teste).');
      }
      if (obsParts.length) {
        baseObservation = `${baseObservation} ${obsParts.join(' ')}`;
      }

      const patrolData: Omit<PatrolRecord, 'id'> = {
        agentId: profile.uid,
        agentName: profile.name,
        teamId: effectiveTeamId,
        teamName: team.name || 'Equipe sem nome',
        vehicleId: profile.vehicleId || '',
        vehiclePrefix: team.vehiclePrefix || 'N/A',
        driver: team.driver || 'N/A',
        inCharge: team.inCharge || 'N/A',
        aux1: team.aux1 || '',
        aux2: team.aux2 || '',
        propertyId: property.id,
        propertyName: property.name,
        plusCode: currentPlusCode,
        timestamp: new Date().toISOString(),
        latitude,
        longitude,
        propertyLatitude: anchor.latitude,
        propertyLongitude: anchor.longitude,
        propertyAnchorSource: anchor.source,
        distanceMeters: Math.round(distance),
        allowedRadiusMeters: allowedRadius,
        validationStatus,
        gpsAccuracyMeters: acc ?? null,
        gpsLowConfidence: gpsLowConfidence ?? false,
        simulatedLocation: simulated ?? false,
        mockLocationSuspected: false,
        status: validationStatus === 'FORA_DO_RAIO' ? 'attention' : 'normal',
        observation: baseObservation,
      };

      // console.log("Attempting to save patrolData:", patrolData);
      const path = 'patrols';
      
      try {
        const docRef = await Promise.race([
          addDocClean(collection(db, path), patrolData as unknown as Record<string, unknown>),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              reject(new Error('Tempo esgotado ao salvar a ronda. Verifique a rede e tente de novo.'));
            }, 28_000);
          }),
        ]);
        const newRecord = { id: docRef.id, ...patrolData } as PatrolRecord;
        setPatrols((prev) => {
          const filtered = prev.filter((p) => p.id !== docRef.id);
          const merged = [newRecord, ...filtered];
          merged.sort((a, b) => {
            const ta = new Date(a.timestamp).getTime();
            const tb = new Date(b.timestamp).getTime();
            return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
          });
          return merged;
        });

        setPatrolMessage("Sucesso!");
        const propName = property.name;
        setScannedProperty(null);

        if (validationStatus === 'FORA_DO_RAIO') {
          alert(
            'ATENÇÃO: Você está fora da área do posto.\n\nO registro foi salvo para auditoria antifraude e aparecerá no Painel Administrativo.',
          );
          try {
            await addDocClean(collection(db, 'alerts'), {
              type: 'security',
              severity: 'high',
              title: 'Ronda fora do raio do posto',
              message: `${profile.name} • ${team.vehiclePrefix || 'VTR'} • ${property.name} • ~${Math.round(distance)} m (limite ${allowedRadius} m)`,
              timestamp: new Date().toISOString(),
              targetId: property.id,
              targetName: property.name,
              resolved: false,
            });
          } catch (ae) {
            console.warn('[patrol] alerta operacional:', ae);
          }
          try {
            await addDocClean(collection(db, 'audit_logs'), {
              adminId: profile.uid,
              adminName: profile.name,
              action: 'RONDA_FORA_DO_RAIO',
              details: `Posto: ${property.name} (${property.id}). Distância ~${Math.round(distance)} m. Raio ${allowedRadius} m. PatrolId: ${docRef.id}`,
              targetId: docRef.id,
              targetType: 'patrol',
              timestamp: new Date().toISOString(),
            });
          } catch (le) {
            console.warn('[patrol] auditoria antifraude:', le);
          }
        } else {
          setTimeout(() => {
            let msg = `Ronda registrada com sucesso em: ${propName}`;
            if (gpsLowConfidence && acc != null) {
              msg += `\n\nAviso: precisão do GPS ±${Math.round(acc)} m (ideal ≤ ${PATROL_GPS_LOW_CONFIDENCE_M} m).`;
            }
            alert(msg);
          }, 100);
        }
      } catch (dbErr: unknown) {
        console.error('Firestore addDoc error:', dbErr);
        const code =
          typeof dbErr === 'object' && dbErr !== null && 'code' in dbErr
            ? String((dbErr as { code?: string }).code)
            : '';
        let friendly =
          dbErr instanceof Error ? dbErr.message : typeof dbErr === 'string' ? dbErr : JSON.stringify(dbErr);
        if (code === 'permission-denied') {
          friendly =
            'Permissão negada. No Firebase, seu usuário precisa estar com status ATIVO e cadastro em users/{uid}. Peça ao administrador para conferir o perfil.';
        }
        alert(`Erro ao salvar ronda: ${friendly}`);
      }
      
    } catch (err: any) {
      console.error("Error in processPatrol:", err);
      alert(`Erro ao registrar ronda: ${err.message || 'Erro interno do sistema'}`);
    } finally {
      setPatrolMessage("");
      setPatrolFlowBusy(false);
    }
  };

  const generateQRCodePDF = async (property: PublicProperty) => {
    try {
      if (!isMasterAdmin) {
        alert('Apenas o ADM MASTER tem permissão para imprimir/baixar o QR Code do posto.');
        return;
      }
      const { jsPDF } = await import('jspdf');
      const canvas = document.getElementById('qr-canvas-print') as HTMLCanvasElement;
      if (!canvas) {
        alert('Erro ao gerar QR Code para impressão.');
        return;
      }

      const qrImage = canvas.toDataURL('image/png');
      const pdfDoc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      await addSigmaHeader(pdfDoc as any, {
        title: 'SIGMA-GCM',
        subtitleLine1: 'Sistema Inteligente de Gestão e Monitoramento Avançado da Guarda Civil Municipal',
        subtitleLine2: 'Guarda Civil Municipal de Araçoiaba da Serra',
        centerLine: 'QR Code do Local',
        generatedAt: new Date(),
      });

      // QR Code
      pdfDoc.addImage(qrImage, 'PNG', 55, 70, 100, 100);
      
      // Property Info
      pdfDoc.setTextColor(0, 0, 0);
      pdfDoc.setFontSize(18);
      pdfDoc.setFont('helvetica', 'bold');
      pdfDoc.text(property.name, 105, 185, { align: 'center' });
      
      pdfDoc.setFontSize(12);
      pdfDoc.setFont('helvetica', 'normal');
      pdfDoc.text(property.address, 105, 195, { align: 'center' });
      
      pdfDoc.setFontSize(14);
      pdfDoc.setFont('helvetica', 'bold');
      pdfDoc.text(property.qrCode, 105, 210, { align: 'center' });

      // Footer
      pdfDoc.setFontSize(8);
      pdfDoc.setFont('helvetica', 'italic');
      pdfDoc.setTextColor(150, 150, 150);
      pdfDoc.text('Este QR Code deve ser fixado em local visível para registro de rondas.', 105, 280, { align: 'center' });

      pdfDoc.save(`QRCode_${property.name.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('Error generating QR Code PDF:', error);
      alert('Erro ao gerar PDF do QR Code.');
    }
  };


  // --- Renderers ---

  if (loading) {
    return (
      <div className="min-h-dvh bg-blue-900 flex flex-col items-center justify-center text-white p-6 safe-pt safe-pb">
        <div className="sigma-brand-frame mx-auto mb-4 aspect-square w-36 max-w-[85vw] shrink-0 animate-pulse shadow-xl ring-2 ring-white/25">
          <img src={appLogo} alt="" decoding="async" />
        </div>
        <h1 className="text-2xl font-bold tracking-widest">SIGMA-GCM</h1>
        <p className="text-blue-200 mt-2">Carregando sistema...</p>
      </div>
    );
  }

  if (user && !profile) {
    const isAdminEmail = user.email === SUPER_ADMIN_EMAIL;
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center p-6 safe-pt safe-pb">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="sigma-brand-frame mx-auto mb-4 aspect-square w-full max-w-[min(240px,88vw)] shadow-xl ring-2 ring-black/[0.08]">
              <img src={appLogo} alt="SIGMA-GCM" loading="eager" decoding="async" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Concluir Cadastro</h1>
            <p className="text-gray-500 mt-1">Olá, {user.displayName}! Complete seus dados para acessar o sistema.</p>
          </div>

          <Card className="p-8">
            <form onSubmit={handleCompleteGoogleRegistration} className="space-y-5">
              <Input 
                name="name"
                label="Nome Completo" 
                defaultValue={user.displayName || ''}
                placeholder="GCM João Silva" 
                icon={User}
                required
              />
              <Input 
                name="registration"
                label="Matrícula" 
                placeholder="12.345-6" 
                icon={FileText}
                required
              />
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Perfil de Acesso</label>
                {isAdminEmail ? (
                  <>
                    <select
                      disabled
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all opacity-70 cursor-not-allowed"
                    >
                      <option value="admin">Administrador</option>
                    </select>
                    <p className="text-[11px] text-gray-500 font-medium">
                      Conta administrativa reconhecida. O acesso será liberado automaticamente após concluir.
                    </p>
                  </>
                ) : (
                  <>
                    <select
                      disabled
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all opacity-70 cursor-not-allowed"
                    >
                      <option value="agent">Agente Operacional</option>
                    </select>
                    <p className="text-[11px] text-gray-500 font-medium">
                      O perfil e a liberação de acesso serão definidos pelo administrador.
                    </p>
                  </>
                )}
              </div>

              {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

              <Button type="submit" className="w-full" size="lg">
                Concluir e Solicitar Acesso
              </Button>

              <button 
                type="button"
                onClick={handleLogout}
                className="w-full text-sm text-gray-500 font-semibold hover:underline mt-4"
              >
                Sair e entrar com outra conta
              </button>
            </form>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center p-6 safe-pt safe-pb">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="sigma-brand-frame mx-auto mb-4 aspect-square w-full max-w-[min(240px,88vw)] shadow-xl ring-2 ring-black/[0.08]">
              <img src={appLogo} alt="SIGMA-GCM" loading="eager" decoding="async" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">SIGMA-GCM</h1>
            <p className="text-gray-500 mt-1">Gestão e Monitoramento Avançado</p>
          </div>

          <Card className="p-8">
            <form onSubmit={handleLogin} className="space-y-5">
              {isRegistering && (
                <>
                  <Input 
                    name="name"
                    label="Nome Completo" 
                    placeholder="GCM João Silva" 
                    icon={User}
                    required
                  />
                  <Input 
                    name="registration"
                    label="Matrícula" 
                    placeholder="12.345-6" 
                    icon={FileText}
                    required
                  />
                </>
              )}
              <Input 
                name="email"
                label="E-mail Institucional" 
                placeholder="exemplo@gcm.gov.br" 
                icon={User}
                required
              />
              <Input 
                name="password"
                type="password"
                label="Senha" 
                placeholder="••••••••" 
                icon={Lock}
                required
              />

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Perfil de Acesso</label>
                <select name="role" className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all">
                  <option value="agent">Agente Operacional</option>
                  <option value="supervisor">Supervisor de Dia</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

              <Button type="submit" className="w-full" size="lg">
                {isRegistering ? 'Solicitar Cadastro' : 'Acessar Sistema'}
              </Button>

              {!isRegistering && (
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full border-blue-200 text-blue-900 hover:bg-blue-50"
                  size="lg"
                  onClick={handleBiometricLogin}
                >
                  <Fingerprint className="w-5 h-5 mr-2" /> Entrar com Biometria
                </Button>
              )}

              <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400 uppercase font-bold tracking-widest">
                <Lock className="w-3 h-3" />
                Sistema protegido por autenticação biométrica
              </div>

              {!isRegistering && (
                <div className="space-y-4">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200"></span></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">Ou continue com</span></div>
                  </div>
                  
                  <button 
                    type="button"
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 py-2.5 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Entrar com Google
                  </button>
                </div>
              )}

              <button 
                type="button"
                onClick={() => setIsRegistering(!isRegistering)}
                className="w-full text-sm text-blue-900 font-semibold hover:underline"
              >
                {isRegistering ? 'Já tenho conta' : 'Primeiro acesso? Cadastre-se'}
              </button>
            </form>
          </Card>

          <p className="text-center text-gray-400 text-xs mt-8">
            © 2026 Guarda Civil Municipal - Sistema Seguro e Monitorado
          </p>
        </motion.div>
      </div>
    );
  }

  if (user && profile && profile.status === 'PENDENTE' && user.email !== SUPER_ADMIN_EMAIL) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center p-4 safe-pt safe-pb">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center border border-slate-700"
        >
          <div className="sigma-brand-frame mx-auto mb-6 aspect-square w-32 max-w-[min(200px,70vw)] ring-2 ring-amber-500/40">
            <img src={appLogo} alt="SIGMA-GCM" decoding="async" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Acesso Pendente</h1>
          <p className="text-slate-400 mb-8">
            Seu cadastro foi realizado com sucesso, mas ainda aguarda aprovação de um administrador.
            Você será notificado assim que seu acesso for liberado.
          </p>
          <Button 
            onClick={handleLogout}
            className="w-full"
            variant="outline"
          >
            Sair do Sistema
          </Button>
        </motion.div>
      </div>
    );
  }

  if (user && profile && profile.status === 'BLOQUEADO' && user.email !== SUPER_ADMIN_EMAIL) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center p-4 safe-pt safe-pb">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center border border-slate-700"
        >
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Acesso Bloqueado</h1>
          <p className="text-slate-400 mb-8">
            Sua conta foi bloqueada por um administrador.
            Entre em contato com o comando para mais informações.
          </p>
          <Button 
            onClick={handleLogout}
            className="w-full"
            variant="outline"
          >
            Sair do Sistema
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50 pb-24 safe-pb">
      <AnimatePresence>
        {showAdminPanel && (profile || user?.email === SUPER_ADMIN_EMAIL) && (
          <React.Suspense fallback={null}>
            <AdminPanel 
              profile={profile || { uid: user!.uid, name: user!.displayName || 'Admin', email: user!.email!, role: 'admin', status: 'ATIVO', registration: 'ADMIN', createdAt: new Date().toISOString() }} 
              onClose={() => setShowAdminPanel(false)} 
              logAdminAction={logAdminAction}
            />
          </React.Suspense>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className={cn(
        "bg-blue-900 text-white p-4 sm:p-6 rounded-b-3xl sm:rounded-b-[2.5rem] shadow-lg sticky top-0 z-[1000] transition-all duration-300",
        activeTab === 'map' ? "p-3 sm:p-4 rounded-b-none" : "p-4 sm:p-6 rounded-b-3xl sm:rounded-b-[2.5rem]",
        isHeaderCollapsed ? "py-2 sm:py-3 overflow-hidden" : undefined
      )}>
        <div className={cn("flex items-center justify-between gap-2", activeTab === 'map' ? "mb-0" : "mb-3 sm:mb-4")}>
          <div className="flex items-center gap-3">
            <div className="sigma-brand-frame sigma-brand-frame--sm h-11 w-11 shrink-0 border border-white/20 shadow-sm sm:h-12 sm:w-12">
              <img src={appLogo} alt="SIGMA-GCM" loading="eager" decoding="async" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight">SIGMA-GCM</h1>
              {activeTab !== 'map' && (
                <p className="text-blue-200 text-[10px] uppercase tracking-widest font-bold">
                  Sistema de Gestão Municipal
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(profile?.role === 'admin' || user?.email === SUPER_ADMIN_EMAIL) && (
              <button 
                onClick={() => setShowAdminPanel(true)} 
                className="relative flex items-center gap-2 px-2.5 sm:px-3 py-1.5 bg-amber-500/20 text-amber-300 rounded-full hover:bg-amber-500/30 transition-colors"
                title="Painel Administrativo"
              >
                {pendingUsersCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full ring-2 ring-blue-900"
                    aria-label={`${pendingUsersCount} cadastro(s) pendente(s)`}
                    title={`${pendingUsersCount} cadastro(s) pendente(s)`}
                  />
                )}
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider">Admin</span>
              </button>
            )}
            {activeTab === 'map' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full border border-white/10">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setShowTeamDetails(false);
                setIsHeaderCollapsed((v) => !v);
              }}
              className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
              title={isHeaderCollapsed ? 'Mostrar cabeçalho' : 'Ocultar cabeçalho'}
            >
              {isHeaderCollapsed ? <ChevronDown className="w-5 h-5" /> : <X className="w-5 h-5" />}
            </button>
            <button onClick={handleLogout} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Operational Info Banner */}
        {!isHeaderCollapsed &&
          profile?.teamId &&
          profile.role !== 'admin' &&
          activeTab !== 'map' && (
          <div className="bg-white/10 rounded-2xl mb-4 backdrop-blur-md border border-white/10 overflow-hidden">
            {(() => {
              const team = teams.find(t => t.id === profile.teamId);
              return (
                <>
                  <div 
                    onClick={() => setShowTeamDetails(!showTeamDetails)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-500/20 rounded-lg">
                          <Truck className="w-4 h-4 text-blue-300" />
                        </div>
                        <div>
                          <p className="text-[10px] text-blue-300 uppercase font-bold leading-none mb-1">Viatura</p>
                          <p className="font-bold text-sm leading-none">{team?.vehiclePrefix || 'N/A'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="sigma-brand-frame sigma-brand-frame--sm h-8 w-8 flex-shrink-0 ring-1 ring-white/15">
                          <img src={appLogo} alt="" decoding="async" />
                        </div>
                        <div>
                          <p className="text-[10px] text-blue-300 uppercase font-bold leading-none mb-1">Equipe</p>
                          <p className="font-bold text-sm leading-none">{team?.name || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                    {showTeamDetails ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                  </div>

                  <AnimatePresence>
                    {showTeamDetails && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 pb-4 border-t border-white/5"
                      >
                        {!isEditingTeam ? (
                          <>
                            <div className="grid grid-cols-2 gap-4 pt-4">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                  <User className="w-4 h-4 text-blue-200" />
                                </div>
                                <div>
                                  <p className="text-[9px] text-blue-300 uppercase font-bold leading-none mb-1">Condutor</p>
                                  <p className="text-xs font-medium leading-none">{team?.driver || 'N/A'}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                  <User className="w-4 h-4 text-blue-200" />
                                </div>
                                <div>
                                  <p className="text-[9px] text-blue-300 uppercase font-bold leading-none mb-1">Encarregado</p>
                                  <p className="text-xs font-medium leading-none">{team?.inCharge || 'N/A'}</p>
                                </div>
                              </div>
                              {team?.aux1 && (
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                    <User className="w-4 h-4 text-blue-200" />
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-blue-300 uppercase font-bold leading-none mb-1">Aux 01</p>
                                    <p className="text-xs font-medium leading-none">{team.aux1}</p>
                                  </div>
                                </div>
                              )}
                              {team?.aux2 && (
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                    <User className="w-4 h-4 text-blue-200" />
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-blue-300 uppercase font-bold leading-none mb-1">Aux 02</p>
                                    <p className="text-xs font-medium leading-none">{team.aux2}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditTeamName(team?.name || '');
                                setEditVehiclePrefix(team?.vehiclePrefix || '');
                                setEditDriver(team?.driver || '');
                                setEditInCharge(team?.inCharge || '');
                                setEditAux1(team?.aux1 || '');
                                setEditAux2(team?.aux2 || '');
                                setIsEditingTeam(true);
                              }}
                              className="mt-4 w-full py-2 bg-white/10 rounded-lg text-xs font-bold hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
                            >
                              <Edit2 className="w-3 h-3" /> Editar Dados do Plantão
                            </button>
                          </>
                        ) : (
                          <div className="space-y-3 pt-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Viatura</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editVehiclePrefix}
                                  onChange={(e) => setEditVehiclePrefix(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Equipe</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editTeamName}
                                  onChange={(e) => setEditTeamName(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Condutor</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editDriver}
                                  onChange={(e) => setEditDriver(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Encarregado</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editInCharge}
                                  onChange={(e) => setEditInCharge(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Aux 01</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editAux1}
                                  onChange={(e) => setEditAux1(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] text-blue-300 uppercase font-bold">Aux 02</label>
                                <input 
                                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                                  value={editAux2}
                                  onChange={(e) => setEditAux2(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                              <button 
                                onClick={() => setIsEditingTeam(false)}
                                className="flex-1 py-2 bg-white/5 rounded-lg text-xs font-bold hover:bg-white/10 transition-colors"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={handleUpdateTeam}
                                className="flex-1 py-2 bg-blue-500 rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Salvar
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              );
            })()}
          </div>
        )}

        {!isHeaderCollapsed && activeTab !== 'map' && (
          <div 
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-4 bg-white/10 p-4 rounded-2xl backdrop-blur-sm cursor-pointer hover:bg-white/20 transition-all active:scale-[0.98] border border-white/5"
          >
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center font-bold text-xl border-2 border-white/20 overflow-hidden shadow-inner">
                {profile?.photoUrl ? (
                  <img
                    src={`${profile.photoUrl}${profile.photoVersion ? `?v=${profile.photoVersion}` : ''}`}
                    alt="Perfil"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-white/90">{profile?.name?.[0] || '?'}</span>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-2 border-blue-900 rounded-full shadow-sm" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="px-1.5 py-0.5 bg-blue-500/30 text-blue-100 text-[9px] uppercase tracking-wider font-black rounded-md">
                  {profile?.role === 'admin' ? 'Comando' : 'Agente'}
                </span>
                <span className="text-blue-200/60 text-[10px] font-medium">• Matrícula: {profile?.registration}</span>
              </div>
              <h2 className="font-bold text-lg text-white leading-tight">{profile?.name}</h2>
            </div>
            <div className="p-2 bg-white/5 rounded-xl">
              <ChevronRight className="w-5 h-5 text-white/40" />
            </div>
          </div>
        )}
      </header>

      {activeTab === 'map' && (
        <div style={{ height: "100dvh", width: "100%" }} className="fixed inset-0 z-0 overflow-hidden">
          <React.Suspense fallback={null}>
            <MapComponent 
              patrols={patrols} 
              occurrences={occurrences} 
              properties={properties}
              vehicleLocations={vehicleLocations}
              geofences={geofences}
              alerts={alerts}
              userRole={profile?.role}
              onStartPatrol={(prop) => {
                setSelectedPropertyForQR(prop);
                void openQrScanner();
              }}
            />
          </React.Suspense>
        </div>
      )}

      {/* Main Content */}
      <main className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
        
        {activeTab === 'home' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => {
                  void openQrScanner();
                }}
                className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-blue-900 transition-all group"
              >
                <div className="p-3 bg-blue-50 rounded-xl mb-3 group-hover:bg-blue-900 group-hover:text-white transition-all">
                  <QrCode className="w-8 h-8" />
                </div>
                <span className="font-bold text-gray-800">Escanear QR</span>
                <span className="text-xs text-gray-400">Registrar Ronda</span>
              </button>

              <button 
                onClick={() => {
                  setShowOccurrenceModal(true);
                }}
                className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-red-600 transition-all group"
              >
                <div className="p-3 bg-red-50 rounded-xl mb-3 group-hover:bg-red-600 group-hover:text-white transition-all">
                  <AlertTriangle className="w-8 h-8 text-red-600 group-hover:text-white" />
                </div>
                <span className="font-bold text-gray-800">Ocorrência</span>
                <span className="text-xs text-gray-400">Relato Operacional</span>
              </button>
            </div>

            <Button 
              variant="outline" 
              className="w-full bg-white" 
              size="lg"
              onClick={() => {
                void generateEndOfShiftReport();
              }}
            >
              <FileText className="w-5 h-5" />
              Gerar Relatório de Plantão
            </Button>

            {/* Recent History */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-900" />
                  Rondas Recentes
                </h3>
                <button onClick={() => setActiveTab('history')} className="text-blue-900 text-sm font-semibold">Ver tudo</button>
              </div>

              <div className="space-y-3">
                {groupByDay<PatrolRecord>(patrols.slice(0, 5)).map((group) => (
                  <div key={group.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                    {group.items.map((patrol) => {
                      const irr = patrolEffectiveValidationStatus(patrol) === 'FORA_DO_RAIO';
                      return (
                      <Card key={patrol.id} className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center',
                            irr ? 'bg-amber-50' : 'bg-green-50',
                          )}>
                            {irr ? (
                              <AlertTriangle className="w-6 h-6 text-amber-600" />
                            ) : (
                              <CheckCircle2 className="w-6 h-6 text-green-600" />
                            )}
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-900">{patrol.propertyName}</h4>
                            <p className="text-xs text-blue-600 font-mono font-bold mt-0.5">{patrol.plusCode}</p>
                            <p className="text-xs text-gray-500 mt-1">{format(new Date(patrol.timestamp), 'HH:mm')} • {patrol.vehicleId}</p>
                            {irr && (
                              <p className="text-[10px] font-black text-amber-700 uppercase mt-1">Fora do raio</p>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-300" />
                      </Card>
                    );})}
                  </div>
                ))}
                {patrols.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                    <p className="text-gray-400">Nenhuma ronda registrada hoje.</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Histórico Completo</h3>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                <button 
                  onClick={() => setHistoryTab('patrols')}
                  className={cn(
                    "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                    historyTab === 'patrols' ? "bg-white text-blue-900 shadow-sm" : "text-gray-500"
                  )}
                >
                  Rondas
                </button>
                <button 
                  onClick={() => setHistoryTab('occurrences')}
                  className={cn(
                    "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                    historyTab === 'occurrences' ? "bg-white text-red-600 shadow-sm" : "text-gray-500"
                  )}
                >
                  Ocorrências
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {historyTab === 'patrols' ? (
                groupByDay<PatrolRecord>(patrols).map((group) => (
                  <div key={group.key} className="space-y-2">
                    <div className="flex items-center gap-2 sticky top-0 bg-gray-50/80 backdrop-blur-sm py-2 z-10">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                    {group.items.map((patrol) => (
                      <Card
                        key={patrol.id}
                        className={cn(
                          'p-4 border-l-4',
                          patrolEffectiveValidationStatus(patrol) === 'FORA_DO_RAIO'
                            ? 'border-l-amber-500 bg-amber-50/30'
                            : 'border-l-transparent',
                        )}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-bold text-gray-900">{patrol.propertyName}</h4>
                            <p className="text-xs text-blue-600 font-mono font-bold mt-0.5">{patrol.plusCode}</p>
                            <p className="text-sm text-gray-500 mt-1">{format(new Date(patrol.timestamp), 'dd/MM/yyyy HH:mm')}</p>
                            {patrolEffectiveValidationStatus(patrol) === 'FORA_DO_RAIO' && typeof patrol.distanceMeters === 'number' && (
                              <p className="text-[11px] font-bold text-amber-700 mt-1">
                                Antifraude: ~{patrol.distanceMeters} m do posto (limite {patrol.allowedRadiusMeters ?? 50} m)
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                          <Badge variant={patrol.status === 'normal' ? 'success' : patrol.status === 'attention' ? 'warning' : 'error'}>
                            {patrol.status?.toUpperCase() || 'N/A'}
                          </Badge>
                          {patrolEffectiveValidationStatus(patrol) === 'FORA_DO_RAIO' && (
                            <Badge variant="warning">FORA DO RAIO</Badge>
                          )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-4">
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> {patrol.agentName}</span>
                            <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> {patrol.vehicleId}</span>
                          </div>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-8 text-blue-900 hover:bg-blue-50"
                            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${patrol.latitude},${patrol.longitude}`, '_blank')}
                          >
                            <MapPin className="w-3 h-3 mr-1" />
                            Ver no Mapa
                          </Button>
                        </div>
                        <p className="mt-2 text-sm text-gray-600 italic">"{patrol.observation}"</p>
                      </Card>
                    ))}
                  </div>
                ))
              ) : (
                groupByDay<OccurrenceRecord>(occurrences).map((group) => (
                  <div key={group.key} className="space-y-2">
                    <div className="flex items-center gap-2 sticky top-0 bg-gray-50/80 backdrop-blur-sm py-2 z-10">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                    {group.items.map((occ) => (
                      <Card key={occ.id} className="p-4 border-l-4 border-l-red-500">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-bold text-gray-900">{occ.type}</h4>
                            <p className="text-xs text-red-600 font-bold mt-0.5">{occ.propertyName || 'Local não informado'}</p>
                            <p className="text-sm text-gray-500 mt-1">{format(new Date(occ.timestamp), 'dd/MM/yyyy HH:mm')}</p>
                          </div>
                          <Badge variant="error">OCORRÊNCIA</Badge>
                        </div>
                        
                        <p className="mt-2 text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-100">
                          {occ.description}
                        </p>

                        {occ.photoUrl && (
                          <div className="mt-3 rounded-xl overflow-hidden border border-gray-200">
                            <img src={occ.photoUrl} alt="Evidência" className="w-full h-48 object-cover" />
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-4">
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> {occ.agentName}</span>
                          </div>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-8 text-red-600 hover:bg-red-50"
                            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${occ.latitude},${occ.longitude}`, '_blank')}
                          >
                            <MapPin className="w-3 h-3 mr-1" />
                            Localização
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                ))
              )}
              {((historyTab === 'patrols' && patrols.length === 0) || (historyTab === 'occurrences' && occurrences.length === 0)) && (
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                  <p className="text-gray-400">Nenhum registro encontrado.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}


        {activeTab === 'dashboard' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 pb-20"
          >
            <React.Suspense fallback={null}>
              <StrategicDashboard 
                profile={profile!}
                patrols={patrols}
                occurrences={occurrences}
                properties={properties}
                vehicleLocations={vehicleLocations}
                alerts={alerts}
                teams={teams}
                vehicles={vehicles}
                geofences={geofences}
                onGenerateReport={generateEndOfShiftReport}
                onResolveAlert={handleResolveAlert}
                onTriggerAlert={handleTriggerAlert}
              />
            </React.Suspense>
          </motion.div>
        )}

        {activeTab === 'properties' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Próprios Públicos</h3>
              <div className="flex gap-2">
                {isMasterAdmin && (
                  <>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setShowSyncConfirmModal(true)}
                    >
                      Sincronizar
                    </Button>
                    <Button size="sm" onClick={() => setShowNewPropertyModal(true)}>
                      <Plus className="w-4 h-4" /> Novo
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input 
                  type="text"
                  placeholder="Pesquisar por nome..."
                  className="w-full bg-white border border-gray-200 rounded-xl py-2.5 pl-10 pr-4 outline-none focus:ring-2 focus:ring-blue-900/20"
                  value={propertySearch}
                  onChange={(e) => setPropertySearch(e.target.value)}
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {['all', 'Administrativo', 'Segurança', 'Educação', 'Saúde', 'Esporte e Lazer', 'Assistência Social', 'Serviços Urbanos', 'Cultura e Turismo'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setPropertyCategory(cat)}
                    className={cn(
                      'px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all',
                      propertyCategory === cat 
                        ? 'bg-blue-900 text-white' 
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    )}
                  >
                    {cat === 'all' ? 'Todos' : 
                     cat === 'Administrativo' ? 'Administrativo' :
                     cat === 'Segurança' ? 'Segurança Pública' :
                     cat === 'Educação' ? 'Educação' :
                     cat === 'Saúde' ? 'Saúde Pública' :
                     cat === 'Esporte e Lazer' ? 'Esporte e Lazer' :
                     cat === 'Assistência Social' ? 'Assistência Social' :
                     cat === 'Serviços Urbanos' ? 'Serviços Urbanos' :
                     'Cultura e Turismo'}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="grid gap-4">
              {properties.length === 0 && (
                <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                  <MapIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 font-medium">Nenhum local cadastrado.</p>
                  {profile?.role === 'agent' && (
                    <p className="text-xs text-gray-400 mt-1">Aguardando sincronização pelo Comando ou Supervisor.</p>
                  )}
                </div>
              )}
              {properties
                .filter(p => {
                  const matchesSearch = p.name.toLowerCase().includes(propertySearch.toLowerCase());
                  const matchesCategory = propertyCategory === 'all' || p.category === propertyCategory;
                  return matchesSearch && matchesCategory;
                })
                .map(prop => (
                <Card 
                  key={prop.id} 
                  className="p-4 cursor-pointer hover:border-blue-900/30 transition-all active:scale-[0.98]"
                  onClick={() => setSelectedPropertyForQR(prop)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Badge variant="info" className="mb-1">{prop.category}</Badge>
                      <h4 className="font-bold text-gray-900">{prop.name}</h4>
                      <p className="text-[10px] text-gray-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {prop.address}
                      </p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-bold">Status</p>
                        <span className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full',
                          prop.status === 'operational' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        )}>
                          {prop.status === 'operational' ? 'OPERACIONAL' : 'MANUTENÇÃO'}
                        </span>
                      </div>
                      {isMasterAdmin && (
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditProperty(prop);
                            }}
                            className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-blue-100 hover:text-blue-900 transition-all"
                            title="Editar posto"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProperty(prop.id, prop.name);
                            }}
                            className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-red-100 hover:text-red-600 transition-all"
                            title="Excluir posto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                    <div className="flex gap-4">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-bold">QR Code</p>
                        <code className="text-xs font-mono font-bold text-blue-900">{prop.qrCode}</code>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-bold">Coordenadas</p>
                        <p className="text-[10px] font-mono text-gray-600">{prop.latitude.toFixed(4)}, {prop.longitude.toFixed(4)}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'teams' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Gestão de Equipes</h3>
              <Button size="sm" onClick={() => setShowTeamVehicleSetup(true)}>
                <Plus className="w-4 h-4" /> Nova Escala
              </Button>
            </div>

            <div className="grid gap-4">
              {teams.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).map(team => (
                <Card key={team.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <Users className="w-6 h-6 text-blue-900" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-gray-900">{team.name}</h4>
                          <Badge variant={team.active ? 'success' : 'info'} className="text-[8px] px-1.5 py-0">
                            {team.active ? 'ATIVA' : 'INATIVA'}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500 font-medium mb-2">VTR: {team.vehiclePrefix} • {team.shift}</p>
                        
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <p className="text-[10px] text-gray-400 font-bold uppercase">Condutor: <span className="text-gray-700 font-medium normal-case">{team.driver}</span></p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase">Encarregado: <span className="text-gray-700 font-medium normal-case">{team.inCharge}</span></p>
                          {team.aux1 && <p className="text-[10px] text-gray-400 font-bold uppercase">Aux 01: <span className="text-gray-700 font-medium normal-case">{team.aux1}</span></p>}
                          {team.aux2 && <p className="text-[10px] text-gray-400 font-bold uppercase">Aux 02: <span className="text-gray-700 font-medium normal-case">{team.aux2}</span></p>}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium">
                      {team.createdAt ? format(new Date(team.createdAt), 'dd/MM/yy') : ''}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'vehicles' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Gestão de Viaturas</h3>
              <Button size="sm" onClick={() => setShowTeamVehicleSetup(true)}>
                <Plus className="w-4 h-4" /> Nova Viatura
              </Button>
            </div>

            <div className="grid gap-4">
              {vehicles.map(v => (
                <Card key={v.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <Truck className="w-6 h-6 text-blue-900" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">{v.prefix}</h4>
                        <p className="text-xs text-gray-500">{v.model} • {v.plate}</p>
                        <p className="text-[10px] text-blue-600 font-bold uppercase mt-1">{v.type}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={v.status === 'Em serviço' ? 'success' : v.status === 'Em manutenção' ? 'warning' : 'error'}>
                        {v.status}
                      </Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'manual' && (
          <React.Suspense fallback={null}>
            <SystemManual onClose={() => setActiveTab('home')} />
          </React.Suspense>
        )}

      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 safe-pb flex items-center justify-between z-40 overflow-x-auto scrollbar-hide">
        <NavButton active={activeTab === 'home'} onClick={() => setActiveTab('home')} icon={Home} label="Início" />
        <NavButton active={activeTab === 'map'} onClick={() => setActiveTab('map')} icon={MapIcon} label="Mapa" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={History} label="Rondas" />
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={LayoutDashboard} label="Painel" />
        <NavButton active={activeTab === 'properties'} onClick={() => setActiveTab('properties')} icon={MapPin} label="Locais" />
        <NavButton active={activeTab === 'manual'} onClick={() => setActiveTab('manual')} icon={BookOpen} label="Manual" />
        {(profile?.role === 'supervisor' || profile?.role === 'command') && (
          <>
            <NavButton active={activeTab === 'teams'} onClick={() => setActiveTab('teams')} icon={Users} label="Equipes" />
            <NavButton active={activeTab === 'vehicles'} onClick={() => setActiveTab('vehicles')} icon={Truck} label="VTRs" />
          </>
        )}
      </nav>

      {/* Modals */}
      <AnimatePresence>
        {forceShiftReportModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2500] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-100"
            >
              <div className="bg-blue-900 p-6 text-white">
                <h3 className="text-xl font-bold">Relatório obrigatório</h3>
                <p className="text-blue-200 text-sm mt-1">
                  O plantão foi encerrado e o relatório ainda não foi enviado ao ADM MASTER.
                </p>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-sm leading-relaxed">
                  <p className="font-bold">Ação necessária</p>
                  <p className="mt-1">
                    Para continuar usando o sistema ou sair, você precisa <b>gerar e enviar</b> o relatório deste plantão.
                  </p>
                  {forceShiftReportWindow && (
                    <p className="mt-2 text-xs text-amber-900/80">
                      Turno: <b>{forceShiftReportWindow.label}</b> • Período:{' '}
                      <b>{format(forceShiftReportWindow.start, 'dd/MM HH:mm')}</b> –{' '}
                      <b>{format(forceShiftReportWindow.end, 'dd/MM HH:mm')}</b>
                    </p>
                  )}
                </div>

                <Button
                  size="lg"
                  className="w-full"
                  disabled={forceShiftReportLoading}
                  onClick={async () => {
                    setForceShiftReportLoading(true);
                    try {
                      await generateEndOfShiftReport();
                      // Se enviou com sucesso, fecha o modal e, se o usuário tentou sair,
                      // conclui o logout automaticamente.
                      setForceShiftReportModal(false);
                      setForceShiftReportWindow(null);
                      if (pendingLogoutAfterReport) {
                        setPendingLogoutAfterReport(false);
                        await signOut(auth);
                      }
                    } finally {
                      setForceShiftReportLoading(false);
                    }
                  }}
                >
                  {forceShiftReportLoading ? 'Enviando...' : 'Gerar e Enviar Relatório'}
                </Button>

                <p className="text-[11px] text-gray-400 leading-relaxed">
                  O relatório será enviado automaticamente para o painel do ADM MASTER em{' '}
                  <b>Painel Administrativo → Relatórios</b>.
                </p>
              </div>
            </motion.div>
          </div>
        )}
        {showTeamVehicleSetup && (
          <TeamVehicleSetupModal 
            teams={teams} 
            vehicles={vehicles} 
            initialVehicleId={profile?.vehicleId}
            loading={setupTeamVehicleSaving}
            onSave={handleSetupTeamVehicle} 
            canCreateUsers={profile?.role === 'admin' || profile?.role === 'supervisor' || profile?.role === 'command'}
            onCreateUser={handleAdminCreateUser}
          />
        )}
        {showSyncConfirmModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-8 space-y-6"
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto">
                  <MapIcon className="w-8 h-8 text-blue-900" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Sincronizar Base</h3>
                  <p className="text-gray-500 text-sm mt-2">
                    Deseja sincronizar a base de dados completa? Isso pode gerar duplicatas se já existirem itens.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  variant="ghost" 
                  className="flex-1" 
                  onClick={() => setShowSyncConfirmModal(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={async () => {
                    setShowSyncConfirmModal(false);
                    const initialProps = [
                      // 1. ÓRGÃOS ADMINISTRATIVOS E PRÉDIOS INSTITUCIONAIS
                      { name: 'PAÇO MUNICIPAL / PREFEITURA MUNICIPAL', category: 'Administrativo', latitude: -23.5042, longitude: -47.4831, address: 'Araçoiaba da Serra', qrCode: 'PAÇO MUNICIPAL / PREFEITURA MUNICIPAL - ADM001', plusCode: '8798C2R2+V2', status: 'operational' },
                      { name: 'PREFEITURA MUNICIPAL DE ARAÇOIABA DA SERRA', category: 'Administrativo', latitude: -23.5043, longitude: -47.4832, address: 'Araçoiaba da Serra', qrCode: 'PREFEITURA MUNICIPAL DE ARAÇOIABA DA SERRA - ADM002', plusCode: '8798C2R2+W2', status: 'operational' },
                      { name: 'CÂMARA MUNICIPAL DE ARAÇOIABA DA SERRA', category: 'Administrativo', latitude: -23.5045, longitude: -47.4835, address: 'Araçoiaba da Serra', qrCode: 'CÂMARA MUNICIPAL DE ARAÇOIABA DA SERRA - ADM003', plusCode: '8798C2R2+X2', status: 'operational' },
                      { name: 'SECRETARIAS MUNICIPAIS', category: 'Administrativo', latitude: -23.5046, longitude: -47.4836, address: 'Araçoiaba da Serra', qrCode: 'SECRETARIAS MUNICIPAIS - ADM004', plusCode: '8798C2R2+Y2', status: 'operational' },
                      { name: 'DEPARTAMENTOS MUNICIPAIS', category: 'Administrativo', latitude: -23.5047, longitude: -47.4837, address: 'Araçoiaba da Serra', qrCode: 'DEPARTAMENTOS MUNICIPAIS - ADM005', plusCode: '8798C2R2+Z2', status: 'operational' },
                      { name: 'ALMOXARIFADO MUNICIPAL', category: 'Administrativo', latitude: -23.5048, longitude: -47.4838, address: 'Araçoiaba da Serra', qrCode: 'ALMOXARIFADO MUNICIPAL - ADM006', plusCode: '8798C2R3+22', status: 'operational' },
                      { name: 'GARAGEM MUNICIPAL', category: 'Administrativo', latitude: -23.5049, longitude: -47.4839, address: 'Araçoiaba da Serra', qrCode: 'GARAGEM MUNICIPAL - ADM007', plusCode: '8798C2R3+32', status: 'operational' },
                      { name: 'ARQUIVO PÚBLICO MUNICIPAL', category: 'Administrativo', latitude: -23.5050, longitude: -47.4840, address: 'Araçoiaba da Serra', qrCode: 'ARQUIVO PÚBLICO MUNICIPAL - ADM008', plusCode: '8798C2R3+42', status: 'operational' },
                      { name: 'SEDE DA GUARDA CIVIL MUNICIPAL', category: 'Segurança', latitude: -23.5051, longitude: -47.4841, address: 'Araçoiaba da Serra', qrCode: 'SEDE DA GUARDA CIVIL MUNICIPAL - SEG001', plusCode: '8798C2R3+52', status: 'operational' },
                      { name: 'BASES OPERACIONAIS DA GUARDA CIVIL MUNICIPAL', category: 'Segurança', latitude: -23.5052, longitude: -47.4842, address: 'Araçoiaba da Serra', qrCode: 'BASES OPERACIONAIS DA GUARDA CIVIL MUNICIPAL - SEG002', plusCode: '8798C2R3+62', status: 'operational' },
                      { name: 'CENTRAL DE MONITORAMENTO MUNICIPAL', category: 'Segurança', latitude: -23.5053, longitude: -47.4843, address: 'Araçoiaba da Serra', qrCode: 'CENTRAL DE MONITORAMENTO MUNICIPAL - SEG003', plusCode: '8798C2R3+72', status: 'operational' },
                      { name: 'ESCOLAS MUNICIPAIS DE ENSINO FUNDAMENTAL', category: 'Educação', latitude: -23.5054, longitude: -47.4844, address: 'Araçoiaba da Serra', qrCode: 'ESCOLAS MUNICIPAIS DE ENSINO FUNDAMENTAL - EDU001', plusCode: '8798C2R3+82', status: 'operational' },
                      { name: 'ESCOLAS MUNICIPAIS DE EDUCAÇÃO INFANTIL (EMEI)', category: 'Educação', latitude: -23.5055, longitude: -47.4845, address: 'Araçoiaba da Serra', qrCode: 'ESCOLAS MUNICIPAIS DE EDUCAÇÃO INFANTIL (EMEI) - EDU002', plusCode: '8798C2R3+92', status: 'operational' },
                      { name: 'CRECHES MUNICIPAIS', category: 'Educação', latitude: -23.5056, longitude: -47.4846, address: 'Araçoiaba da Serra', qrCode: 'CRECHES MUNICIPAIS - EDU003', plusCode: '8798C2R4+22', status: 'operational' },
                      { name: 'CENTROS EDUCACIONAIS MUNICIPAIS', category: 'Educação', latitude: -23.5057, longitude: -47.4847, address: 'Araçoiaba da Serra', qrCode: 'CENTROS EDUCACIONAIS MUNICIPAIS - EDU004', plusCode: '8798C2R4+32', status: 'operational' },
                      { name: 'QUADRAS ESCOLARES MUNICIPAIS', category: 'Educação', latitude: -23.5058, longitude: -47.4848, address: 'Araçoiaba da Serra', qrCode: 'QUADRAS ESCOLARES MUNICIPAIS - EDU005', plusCode: '8798C2R4+42', status: 'operational' },
                      { name: 'PÁTIOS E COMPLEXOS EDUCACIONAIS', category: 'Educação', latitude: -23.5059, longitude: -47.4849, address: 'Araçoiaba da Serra', qrCode: 'PÁTIOS E COMPLEXOS EDUCACIONAIS - EDU006', plusCode: '8798C2R4+52', status: 'operational' },
                      { name: 'UNIDADES BÁSICAS DE SAÚDE (UBS)', category: 'Saúde', latitude: -23.5060, longitude: -47.4850, address: 'Araçoiaba da Serra', qrCode: 'UNIDADES BÁSICAS DE SAÚDE (UBS) - SAU001', plusCode: '8798C2R4+62', status: 'operational' },
                      { name: 'POSTOS DE SAÚDE', category: 'Saúde', latitude: -23.5061, longitude: -47.4851, address: 'Araçoiaba da Serra', qrCode: 'POSTOS DE SAÚDE - SAU002', plusCode: '8798C2R4+72', status: 'operational' },
                      { name: 'CENTRO DE ESPECIALIDADES MÉDICAS', category: 'Saúde', latitude: -23.5062, longitude: -47.4852, address: 'Araçoiaba da Serra', qrCode: 'CENTRO DE ESPECIALIDADES MÉDICAS - SAU003', plusCode: '8798C2R4+82', status: 'operational' },
                      { name: 'CENTRO ODONTOLÓGICO MUNICIPAL', category: 'Saúde', latitude: -23.5063, longitude: -47.4853, address: 'Araçoiaba da Serra', qrCode: 'CENTRO ODONTOLÓGICO MUNICIPAL - SAU004', plusCode: '8798C2R4+92', status: 'operational' },
                      { name: 'FARMÁCIA MUNICIPAL', category: 'Saúde', latitude: -23.5064, longitude: -47.4854, address: 'Araçoiaba da Serra', qrCode: 'FARMÁCIA MUNICIPAL - SAU005', plusCode: '8798C2R5+22', status: 'operational' },
                      { name: 'PARQUE MUNICIPAL VEREADOR ORLANDO FERREIRA DUARTE', category: 'Esporte e Lazer', latitude: -23.5065, longitude: -47.4855, address: 'Araçoiaba da Serra', qrCode: 'PARQUE MUNICIPAL VEREADOR ORLANDO FERREIRA DUARTE - ESP001', plusCode: '8798C2R5+32', status: 'operational' },
                      { name: 'LAGO MUNICIPAL DE ARAÇOIABA DA SERRA', category: 'Esporte e Lazer', latitude: -23.5066, longitude: -47.4856, address: 'Araçoiaba da Serra', qrCode: 'LAGO MUNICIPAL DE ARAÇOIABA DA SERRA - ESP002', plusCode: '8798C2R5+42', status: 'operational' },
                      { name: 'PRAÇAS PÚBLICAS MUNICIPAIS', category: 'Esporte e Lazer', latitude: -23.5067, longitude: -47.4857, address: 'Araçoiaba da Serra', qrCode: 'PRAÇAS PÚBLICAS MUNICIPAIS - ESP003', plusCode: '8798C2R5+52', status: 'operational' },
                      { name: 'ÁREAS VERDES MUNICIPAIS', category: 'Esporte e Lazer', latitude: -23.5068, longitude: -47.4858, address: 'Araçoiaba da Serra', qrCode: 'ÁREAS VERDES MUNICIPAIS - ESP004', plusCode: '8798C2R5+62', status: 'operational' },
                      { name: 'ACADEMIAS AO AR LIVRE', category: 'Esporte e Lazer', latitude: -23.5069, longitude: -47.4859, address: 'Araçoiaba da Serra', qrCode: 'ACADEMIAS AO AR LIVRE - ESP005', plusCode: '8798C2R5+72', status: 'operational' },
                      { name: 'QUADRAS POLIESPORTIVAS PÚBLICAS', category: 'Esporte e Lazer', latitude: -23.5070, longitude: -47.4860, address: 'Araçoiaba da Serra', qrCode: 'QUADRAS POLIESPORTIVAS PÚBLICAS - ESP006', plusCode: '8798C2R5+82', status: 'operational' },
                      { name: 'CAMPOS DE FUTEBOL MUNICIPAIS', category: 'Esporte e Lazer', latitude: -23.5071, longitude: -47.4861, address: 'Araçoiaba da Serra', qrCode: 'CAMPOS DE FUTEBOL MUNICIPAIS - ESP007', plusCode: '8798C2R5+92', status: 'operational' },
                      { name: 'GINÁSIOS MUNICIPAIS', category: 'Esporte e Lazer', latitude: -23.5072, longitude: -47.4862, address: 'Araçoiaba da Serra', qrCode: 'GINÁSIOS MUNICIPAIS - ESP008', plusCode: '8798C2R6+22', status: 'operational' },
                      { name: 'CENTROS ESPORTIVOS MUNICIPAIS', category: 'Esporte e Lazer', latitude: -23.5073, longitude: -47.4863, address: 'Araçoiaba da Serra', qrCode: 'CENTROS ESPORTIVOS MUNICIPAIS - ESP009', plusCode: '8798C2R6+32', status: 'operational' },
                      { name: 'CRAS – CENTRO DE REFERÊNCIA DE ASSISTÊNCIA SOCIAL', category: 'Assistência Social', latitude: -23.5074, longitude: -47.4864, address: 'Araçoiaba da Serra', qrCode: 'CRAS – CENTRO DE REFERÊNCIA DE ASSISTÊNCIA SOCIAL - SOC001', plusCode: '8798C2R6+42', status: 'operational' },
                      { name: 'CREAS – CENTRO DE REFERÊNCIA ESPECIALIZADO DE ASSISTÊNCIA SOCIAL', category: 'Assistência Social', latitude: -23.5075, longitude: -47.4865, address: 'Araçoiaba da Serra', qrCode: 'CREAS – CENTRO DE REFERÊNCIA ESPECIALIZADO DE ASSISTÊNCIA SOCIAL - SOC002', plusCode: '8798C2R6+52', status: 'operational' },
                      { name: 'CENTROS COMUNITÁRIOS MUNICIPAIS', category: 'Assistência Social', latitude: -23.5076, longitude: -47.4866, address: 'Araçoiaba da Serra', qrCode: 'CENTROS COMUNITÁRIOS MUNICIPAIS - SOC003', plusCode: '8798C2R6+62', status: 'operational' },
                      { name: 'CEMITÉRIO MUNICIPAL', category: 'Serviços Urbanos', latitude: -23.5077, longitude: -47.4867, address: 'Araçoiaba da Serra', qrCode: 'CEMITÉRIO MUNICIPAL - SRV001', plusCode: '8798C2R6+72', status: 'operational' },
                      { name: 'VELÓRIO MUNICIPAL', category: 'Serviços Urbanos', latitude: -23.5078, longitude: -47.4868, address: 'Araçoiaba da Serra', qrCode: 'VELÓRIO MUNICIPAL - SRV002', plusCode: '8798C2R6+82', status: 'operational' },
                      { name: 'PÁTIO DE SERVIÇOS MUNICIPAIS', category: 'Serviços Urbanos', latitude: -23.5079, longitude: -47.4869, address: 'Araçoiaba da Serra', qrCode: 'PÁTIO DE SERVIÇOS MUNICIPAIS - SRV003', plusCode: '8798C2R6+92', status: 'operational' },
                      { name: 'ESTAÇÃO DE TRATAMENTO', category: 'Serviços Urbanos', latitude: -23.5080, longitude: -47.4870, address: 'Araçoiaba da Serra', qrCode: 'ESTAÇÃO DE TRATAMENTO - SRV004', plusCode: '8798C2R7+22', status: 'operational' },
                      { name: 'PRÉDIOS ADMINISTRATIVOS DE OBRAS E SERVIÇOS', category: 'Serviços Urbanos', latitude: -23.5081, longitude: -47.4871, address: 'Araçoiaba da Serra', qrCode: 'PRÉDIOS ADMINISTRATIVOS DE OBRAS E SERVIÇOS - SRV005', plusCode: '8798C2R7+32', status: 'operational' },
                      { name: 'MUSEU MUNICIPAL', category: 'Cultura e Turismo', latitude: -23.5082, longitude: -47.4872, address: 'Araçoiaba da Serra', qrCode: 'MUSEU MUNICIPAL - CUL001', plusCode: '8798C2R7+42', status: 'operational' },
                      { name: 'BIBLIOTECA PÚBLICA MUNICIPAL', category: 'Cultura e Turismo', latitude: -23.5083, longitude: -47.4873, address: 'Araçoiaba da Serra', qrCode: 'BIBLIOTECA PÚBLICA MUNICIPAL - CUL002', plusCode: '8798C2R7+52', status: 'operational' },
                      { name: 'CENTROS CULTURAIS MUNICIPAIS', category: 'Cultura e Turismo', latitude: -23.5084, longitude: -47.4874, address: 'Araçoiaba da Serra', qrCode: 'CENTROS CULTURAIS MUNICIPAIS - CUL003', plusCode: '8798C2R7+62', status: 'operational' },
                      { name: 'ESPAÇOS DE EVENTOS MUNICIPAIS', category: 'Cultura e Turismo', latitude: -23.5085, longitude: -47.4875, address: 'Araçoiaba da Serra', qrCode: 'ESPAÇOS DE EVENTOS MUNICIPAIS - CUL004', plusCode: '8798C2R7+72', status: 'operational' },
                    ];
                    const initialVehicles = [
                      { prefix: 'VTR-01', plate: 'ABC-1234', model: 'Duster', type: 'Motorizada', status: 'Em serviço' },
                      { prefix: 'VTR-02', plate: 'XYZ-5678', model: 'Corolla', type: 'Motorizada', status: 'Em serviço' },
                      { prefix: 'VTR-ROMU-01', plate: 'ROM-0001', model: 'Hilux', type: 'Motorizada', status: 'Em serviço' },
                    ];
                    const initialTeams = [
                      { name: 'Alfa', type: 'Ordinária', shift: 'Manhã', agentIds: [] },
                      { name: 'Bravo', type: 'Ordinária', shift: 'Tarde', agentIds: [] },
                      { name: 'ROMU', type: 'Tática', shift: 'Noite', agentIds: [] },
                    ];
                    setLoading(true);
                    try {
                      for (const prop of initialProps) {
                        await addDocClean(collection(db, 'properties'), prop as unknown as Record<string, unknown>);
                      }
                      for (const v of initialVehicles) {
                        await addDocClean(collection(db, 'vehicles'), v as unknown as Record<string, unknown>);
                      }
                      for (const t of initialTeams) {
                        await addDocClean(collection(db, 'teams'), t as unknown as Record<string, unknown>);
                      }
                    } catch (err) {
                      handleFirestoreError(err, OperationType.CREATE, 'properties');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Sincronizar
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {showDeleteConfirmModal && propertyToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-8 space-y-6"
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
                  <Trash2 className="w-8 h-8 text-red-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Confirmar Exclusão</h3>
                  <p className="text-gray-500 text-sm mt-2">
                    Deseja realmente excluir o local <span className="font-bold text-gray-900">"{propertyToDelete.name}"</span>?
                  </p>
                  <p className="text-xs text-red-500 mt-2 font-medium">Esta ação não pode ser desfeita.</p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  variant="ghost" 
                  className="flex-1" 
                  onClick={() => {
                    setShowDeleteConfirmModal(false);
                    setPropertyToDelete(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white border-none" 
                  onClick={confirmDeleteProperty}
                  disabled={loading}
                >
                  {loading ? 'Excluindo...' : 'Excluir'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {showEditPropertyModal && editingProperty && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="bg-blue-900 p-6 text-white flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Editar Próprio Público</h3>
                  <p className="text-blue-200 text-sm">Atualizar dados do local</p>
                </div>
                <button 
                  onClick={() => setShowEditPropertyModal(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <Input 
                  label="Nome do Local" 
                  placeholder="Ex: UBS Centro" 
                  icon={MapPin}
                  value={editingProperty.name}
                  onChange={(e) => setEditingProperty({...editingProperty, name: e.target.value})}
                />
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Categoria</label>
                  <select 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all"
                    value={editingProperty.category}
                    onChange={(e) => setEditingProperty({...editingProperty, category: e.target.value})}
                  >
                    <option value="Administrativo">Administrativo</option>
                    <option value="Segurança">Segurança Pública</option>
                    <option value="Educação">Educação</option>
                    <option value="Saúde">Saúde Pública</option>
                    <option value="Esporte e Lazer">Esporte e Lazer</option>
                    <option value="Assistência Social">Assistência Social</option>
                    <option value="Serviços Urbanos">Serviços Urbanos</option>
                    <option value="Cultura e Turismo">Cultura e Turismo</option>
                  </select>
                </div>

                <Input 
                  label="Endereço" 
                  placeholder="Rua, Número, Bairro" 
                  icon={MapPin}
                  value={editingProperty.address}
                  onChange={(e) => setEditingProperty({...editingProperty, address: e.target.value})}
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input 
                    label="Latitude" 
                    type="number"
                    step="any"
                    value={editingProperty.latitude}
                    onChange={(e) => setEditingProperty({...editingProperty, latitude: parseFloat(e.target.value)})}
                  />
                  <Input 
                    label="Longitude" 
                    type="number"
                    step="any"
                    value={editingProperty.longitude}
                    onChange={(e) => setEditingProperty({...editingProperty, longitude: parseFloat(e.target.value)})}
                  />
                </div>

                <Input 
                  label="Plus Code Oficial" 
                  placeholder="Ex: 8798C2R2+V2" 
                  icon={QrCode}
                  value={editingProperty.plusCode}
                  onChange={(e) => setEditingProperty({...editingProperty, plusCode: e.target.value})}
                />

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <select 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all"
                    value={editingProperty.status}
                    onChange={(e) => setEditingProperty({...editingProperty, status: e.target.value as any})}
                  >
                    <option value="operational">Operacional</option>
                    <option value="maintenance">Manutenção</option>
                    <option value="closed">Fechado</option>
                  </select>
                </div>

                <div className="pt-4 flex gap-3">
                  <Button 
                    variant="ghost" 
                    className="flex-1"
                    onClick={() => setShowEditPropertyModal(false)}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    className="flex-1"
                    onClick={async () => {
                      if (!editingProperty.name) {
                        alert('Por favor, insira o nome do local.');
                        return;
                      }
                      setLoading(true);
                      try {
                        const { id, ...data } = editingProperty;
                        await updateDocClean(doc(db, 'properties', id), data as unknown as Record<string, unknown>);
                        setShowEditPropertyModal(false);
                        // Evita alerta modal persistente no navegador/Android; feedback vem pela atualização em tempo real.
                      } catch (err) {
                        handleFirestoreError(err, OperationType.UPDATE, 'properties');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Salvar Alterações
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showNewPropertyModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="bg-blue-900 p-6 text-white flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Novo Próprio Público</h3>
                  <p className="text-blue-200 text-sm">Cadastro manual de local</p>
                </div>
                <button 
                  onClick={() => setShowNewPropertyModal(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <Input 
                  label="Nome do Local" 
                  placeholder="Ex: UBS Centro" 
                  icon={MapPin}
                  value={newProperty.name}
                  onChange={(e) => setNewProperty({...newProperty, name: e.target.value})}
                />
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Categoria</label>
                  <select 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 text-gray-900 focus:ring-2 focus:ring-blue-900/20 focus:border-blue-900 outline-none transition-all"
                    value={newProperty.category}
                    onChange={(e) => setNewProperty({...newProperty, category: e.target.value})}
                  >
                    <option value="Administrativo">Administrativo</option>
                    <option value="Segurança">Segurança Pública</option>
                    <option value="Educação">Educação</option>
                    <option value="Saúde">Saúde Pública</option>
                    <option value="Esporte e Lazer">Esporte e Lazer</option>
                    <option value="Assistência Social">Assistência Social</option>
                    <option value="Serviços Urbanos">Serviços Urbanos</option>
                    <option value="Cultura e Turismo">Cultura e Turismo</option>
                  </select>
                </div>

                <Input 
                  label="Endereço" 
                  placeholder="Rua, Número, Bairro" 
                  icon={MapPin}
                  value={newProperty.address}
                  onChange={(e) => setNewProperty({...newProperty, address: e.target.value})}
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input 
                    label="Latitude" 
                    type="number"
                    step="any"
                    value={newProperty.latitude}
                    onChange={(e) => setNewProperty({...newProperty, latitude: parseFloat(e.target.value)})}
                  />
                  <Input 
                    label="Longitude" 
                    type="number"
                    step="any"
                    value={newProperty.longitude}
                    onChange={(e) => setNewProperty({...newProperty, longitude: parseFloat(e.target.value)})}
                  />
                </div>

                <Input 
                  label="Plus Code Oficial" 
                  placeholder="Ex: 8798C2R2+V2" 
                  icon={QrCode}
                  value={newProperty.plusCode}
                  onChange={(e) => setNewProperty({...newProperty, plusCode: e.target.value})}
                />

                <div className="pt-4 flex gap-3">
                  <Button 
                    variant="ghost" 
                    className="flex-1"
                    onClick={() => setShowNewPropertyModal(false)}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    className="flex-1"
                    onClick={async () => {
                      if (!newProperty.name) {
                        alert('Por favor, insira o nome do local.');
                        return;
                      }
                      setLoading(true);
                      try {
                        const path = 'properties';
                        const randomCode = Math.random().toString(36).substring(7).toUpperCase();
                        const qrCode = `${newProperty.name.toUpperCase()} - ${randomCode}`;
                        
                        await addDocClean(collection(db, path), {
                          ...newProperty,
                          qrCode,
                          status: 'operational',
                        });
                        setShowNewPropertyModal(false);
                        setNewProperty({
                          name: '',
                          category: 'Administrativo',
                          address: 'Araçoiaba da Serra',
                          latitude: -23.5042,
                          longitude: -47.4831
                        });
                        // Evita alerta modal persistente no navegador/Android; o novo local aparece na lista via onSnapshot.
                      } catch (err) {
                        handleFirestoreError(err, OperationType.CREATE, 'properties');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Cadastrar
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {selectedPropertyForQR && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl sm:rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl p-5 sm:p-8 text-center space-y-5 sm:space-y-6 my-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900">QR Code do Local</h3>
                <button onClick={() => setSelectedPropertyForQR(null)} className="p-2 bg-gray-100 rounded-full">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <div className="bg-gray-50 p-8 rounded-3xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200">
                <QRCodeCanvas id="qr-canvas-print" value={selectedPropertyForQR.qrCode} size={200} level="H" includeMargin={true} />
                <p className="mt-4 font-mono text-sm font-bold text-blue-900 tracking-widest">{selectedPropertyForQR.qrCode}</p>
              </div>

              <div>
                <h4 className="font-bold text-lg text-gray-900">{selectedPropertyForQR.name}</h4>
                <p className="text-sm text-gray-500">{selectedPropertyForQR.address}</p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedPropertyForQR(null)}>
                  Fechar
                </Button>
                {isMasterAdmin ? (
                  <Button className="flex-1" onClick={() => generateQRCodePDF(selectedPropertyForQR)}>
                    <Download className="w-4 h-4" /> Imprimir
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    variant="secondary"
                    disabled
                    title="Somente o ADM MASTER pode imprimir o QR Code"
                  >
                    <Lock className="w-4 h-4" /> Bloqueado
                  </Button>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {scannedProperty && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl sm:rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl p-5 sm:p-8 space-y-5 sm:space-y-6 my-6"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-8 h-8 text-blue-900" />
                </div>
                <Badge variant="info">{scannedProperty.category}</Badge>
                <h3 className="text-2xl font-bold text-gray-900">{scannedProperty.name}</h3>
                <p className="text-gray-500 text-sm">{scannedProperty.address}</p>
                {(() => {
                  const host = window.location.hostname;
                  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
                  return isLocalhost ? (
                    <p className="text-[10px] text-gray-400 font-mono mt-2">
                      BUILD: {__BUILD_ID__}
                    </p>
                  ) : null;
                })()}
              </div>

              <div className="bg-gray-50 p-4 rounded-2xl space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Código:</span>
                  <span className="font-mono font-bold text-blue-900">{scannedProperty.qrCode}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status:</span>
                  <Badge variant={scannedProperty.status === 'operational' ? 'success' : 'warning'}>
                    {scannedProperty.status.toUpperCase()}
                  </Badge>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  variant="ghost" 
                  className="flex-1" 
                  onClick={() => setScannedProperty(null)}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={() => {
                    // Sempre GPS real: o WebView do Capacitor usa host `localhost` e, com a lógica antiga,
                    // a posição simulada no posto zerava a distância (antifraude nunca disparava no APK).
                    // Teste "como se estivesse no posto" só via "Simular Localização" abaixo.
                    void confirmPatrol();
                  }}
                  disabled={loading || patrolFlowBusy}
                >
                  {patrolFlowBusy ? (patrolMessage || 'Processando...') : 'Confirmar Ronda'}
                </Button>
              </div>
              
              {patrolMessage && (
                <p className="mt-2 text-[10px] text-blue-600 font-bold uppercase text-center animate-pulse">
                  {patrolMessage}
                </p>
              )}
              
              {/* Simulation Option for Testing */}
              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                <button 
                  onClick={() => {
                    if (scannedProperty) {
                      const a = patrolAnchorFromProperty(scannedProperty);
                      void confirmPatrol({ latitude: a.latitude, longitude: a.longitude }, scannedProperty);
                    }
                  }}
                  className="text-[10px] text-gray-400 hover:text-blue-600 transition-colors uppercase font-bold tracking-widest"
                >
                  Simular Localização (Apenas para Testes)
                </button>

                {(() => {
                  const enabled =
                    (import.meta.env.VITE_ENABLE_ANTIFRAUD_TEST as string | undefined) === 'true' ||
                    window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname === '::1';
                  const canUse = (profile?.role || '') === 'admin';
                  if (!enabled || !canUse) return null;
                  return (
                    <div className="mt-3">
                      <button
                        onClick={() => {
                          if (!scannedProperty) return;
                          const a = patrolAnchorFromProperty(scannedProperty);
                          const far = offsetLatLngByMeters({ latitude: a.latitude, longitude: a.longitude }, 0, 1000);
                          void confirmPatrol(far, scannedProperty);
                        }}
                        className="text-[10px] text-amber-700 hover:text-amber-900 transition-colors uppercase font-bold tracking-widest"
                        title="Simula uma posição ~1 km longe do posto (força FORA_DO_RAIO)"
                      >
                        Testar Antifraude (Simular ~1 km)
                      </button>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}

        {showScanner && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[2000] flex flex-col"
          >
            <div className="p-4 sm:p-6 flex items-center justify-between text-white">
              <div className="flex flex-col">
                <h3 className="font-bold text-lg">Escanear QR Code</h3>
                <span id="scanner-status" className="text-[10px] text-white/40 uppercase tracking-widest">Iniciando câmera...</span>
              </div>
              <button onClick={() => setShowScanner(false)} className="p-2 bg-white/10 rounded-full">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 gap-4 sm:gap-6 overflow-y-auto">
              <div 
                id="reader" 
                className="w-full max-w-sm rounded-2xl overflow-hidden border-4 border-blue-900 bg-black relative min-h-[300px]"
                style={{ position: 'relative' }}
              >
                {/* Visual feedback overlay */}
                <div className="absolute inset-0 border-2 border-white/20 pointer-events-none z-10"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-blue-500/50 rounded-xl pointer-events-none z-10"></div>
              </div>
              
              {/* Simulation for testing */}
              <div className="w-full max-w-sm space-y-3">
                <p className="text-white/40 text-[10px] uppercase font-bold text-center">Simulação de Teste</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {properties.slice(0, 4).map(p => (
                    <button 
                      key={p.id}
                      onClick={() => handleSimulateScan(p)}
                      className="text-[10px] bg-white/5 hover:bg-white/10 text-white/60 p-2 rounded-lg border border-white/10 truncate"
                    >
                      Simular: {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <ScannerInitializer onScan={handleScan} />
            </div>

            <div className="p-6 sm:p-12 text-center text-white/60">
              <p className="text-sm">Aponte a câmera para o QR Code fixado no local.</p>
              <p className="text-xs mt-2">A validação GPS será realizada automaticamente.</p>
            </div>
          </motion.div>
        )}

        {showProfileModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] p-8 space-y-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Perfil do Agente</h3>
                <button onClick={() => { setShowProfileModal(false); setIsEditingProfile(false); }} className="p-2 bg-gray-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-col items-center gap-4 py-4">
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full bg-blue-900 flex items-center justify-center text-white text-4xl font-bold shadow-xl border-4 border-blue-50 overflow-hidden relative">
                    {photoLoading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                          <div className="text-[10px] font-black tracking-widest text-white/90">
                            {photoLoadingStep || 'PROCESSANDO'}
                          </div>
                        </div>
                      </div>
                    )}
                    {profile?.photoUrl ? (
                      <img
                        src={`${profile.photoUrl}${profile.photoVersion ? `?v=${profile.photoVersion}` : ''}`}
                        alt="Perfil"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      profile?.name?.[0] || '?'
                    )}
                  </div>
                  <button 
                    onClick={handlePhotoClick}
                    disabled={photoLoading}
                    className="absolute bottom-0 right-0 p-2 bg-blue-900 text-white rounded-full shadow-lg border-2 border-white hover:bg-blue-800 transition-all disabled:opacity-50"
                  >
                    <CameraIcon className="w-4 h-4" />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handlePhotoUpload} 
                  />
                </div>
                {user?.photoURL && profile?.photoUrl !== user.photoURL && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSyncGooglePhoto}
                    className="text-blue-600 hover:bg-blue-50 text-[10px] uppercase tracking-widest font-bold"
                  >
                    Sincronizar com Google
                  </Button>
                )}
                <div className="text-center">
                  <h4 className="text-2xl font-bold text-gray-900">{profile?.name}</h4>
                  <p className="text-gray-500 font-medium">Matrícula: {profile?.registration}</p>
                  <Badge variant="info" className="mt-2">{profile?.role?.toUpperCase() || 'AGENTE'}</Badge>
                </div>
              </div>

              {!isEditingProfile ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">E-mail</p>
                      <p className="text-sm font-semibold text-gray-700 truncate">{profile?.email}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Viatura Atual</p>
                      <p className="text-sm font-semibold text-gray-700">{vehicleId || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="sigma-brand-frame sigma-brand-frame--sm h-9 w-9 flex-shrink-0 ring-1 ring-blue-200">
                        <img src={appLogo} alt="" decoding="async" />
                      </div>
                      <h5 className="font-bold text-blue-900 text-sm">Status Operacional</h5>
                    </div>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      Agente em serviço ativo. Todas as ações são registradas com carimbo de tempo e coordenadas GPS para fins de auditoria.
                    </p>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isBiometricSupported ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">Biometria no Dispositivo</p>
                          <p className="text-xs text-gray-500">
                            {biometricSupportMsg}
                          </p>
                        </div>
                      </div>
                      {profile?.biometricEnabled ? (
                        <Badge variant="success">Ativado</Badge>
                      ) : (
                        isBiometricSupported && (
                          <Button 
                            size="sm"
                            onClick={handleEnableBiometrics}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            Ativar
                          </Button>
                        )
                      )}
                    </div>

                    <div className="flex gap-3">
                      <Button 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => setIsEditingProfile(true)}
                      >
                        <Edit2 className="w-4 h-4 mr-2" /> Editar Perfil
                      </Button>
                      <Button 
                        variant="outline" 
                        className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                        onClick={handleLogout}
                      >
                        <LogOut className="w-4 h-4 mr-2" /> Sair
                      </Button>
                    </div>
                    <Button 
                      variant="outline" 
                      className="w-full border-blue-200 text-blue-900 hover:bg-blue-50"
                      onClick={() => {
                        setShowProfileModal(false);
                        setShowTeamVehicleSetup(true);
                      }}
                    >
                      <Truck className="w-4 h-4 mr-2" /> Trocar Equipe / Viatura
                    </Button>
                  </div>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  const newName = formData.get('name') as string;
                  const newReg = formData.get('registration') as string;
                  
                  if (!profile) return;
                  
                  try {
                    setLoading(true);
                    const updatedProfile = { ...profile, name: newName, registration: newReg };
                    const path = 'users';
                    await setDocClean(doc(db, path, profile.uid), updatedProfile as unknown as Record<string, unknown>, { merge: true });
                    setProfile(updatedProfile);
                    setIsEditingProfile(false);
                    alert('Perfil atualizado com sucesso!');
                  } catch (err) {
                    handleFirestoreError(err, OperationType.UPDATE, 'users');
                  } finally {
                    setLoading(false);
                  }
                }}>
                  <Input 
                    name="name"
                    label="Nome Completo" 
                    defaultValue={profile?.name}
                    icon={User}
                    required
                  />
                  <Input 
                    name="registration"
                    label="Matrícula" 
                    defaultValue={profile?.registration}
                    icon={FileText}
                    required
                  />
                  <div className="flex gap-3 pt-2">
                    <Button 
                      type="button"
                      variant="ghost" 
                      className="flex-1"
                      onClick={() => setIsEditingProfile(false)}
                    >
                      Cancelar
                    </Button>
                    <Button 
                      type="submit"
                      className="flex-1"
                    >
                      Salvar Alterações
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}

        {showOccurrenceModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] p-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Registrar Ocorrência</h3>
                <button onClick={() => { setShowOccurrenceModal(false); setOccurrencePhoto(null); }} className="p-2 bg-gray-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                if (submittingOccurrence) return;
                setSubmittingOccurrence(true);
                
                const formData = new FormData(e.target as HTMLFormElement);
                const description = formData.get('description') as string;
                const type = formData.get('type') as string;
                const propertyId = formData.get('propertyId') as string;
                const propertyName = properties.find(p => p.id === propertyId)?.name || '';

                const submitData = async (lat: number, lng: number) => {
                  try {
                    const path = 'occurrences';
                    await addDoc(
                      collection(db, path),
                      limparDados({
                        agentId: profile?.uid,
                        agentName: profile?.name,
                        teamId: profile?.teamId,
                        timestamp: new Date().toISOString(),
                        description,
                        type,
                        propertyId,
                        propertyName,
                        photoUrl: occurrencePhoto ?? null,
                        latitude: lat,
                        longitude: lng,
                      } as Record<string, unknown>),
                    );
                    alert('Ocorrência registrada com sucesso!');
                    setOccurrencePhoto(null);
                    setShowOccurrenceModal(false);
                  } catch (err) {
                    handleFirestoreError(err, OperationType.CREATE, 'occurrences');
                  } finally {
                    setSubmittingOccurrence(false);
                  }
                };

                navigator.geolocation.getCurrentPosition(
                  (pos) => submitData(pos.coords.latitude, pos.coords.longitude),
                  (err) => {
                    console.error("Erro de geolocalização:", err);
                    // Fallback to default coordinates if geolocation fails
                    submitData(-23.5042, -47.4831);
                  },
                  { timeout: 10000 }
                );
              }}>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Posto / Próprio Público</label>
                  <select name="propertyId" className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 outline-none focus:ring-2 focus:ring-blue-900/20">
                    <option value="">Selecione o Posto (Opcional)</option>
                    {properties.map(prop => (
                      <option key={prop.id} value={prop.id}>{prop.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Tipo de Ocorrência</label>
                  <select name="type" className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 outline-none focus:ring-2 focus:ring-blue-900/20">
                    <option>Averiguação de Atitude Suspeita</option>
                    <option>Dano ao Patrimônio Público</option>
                    <option>Invasão de Próprio</option>
                    <option>Furto / Roubo</option>
                    <option>Outros</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Descrição dos Fatos</label>
                  <textarea 
                    name="description"
                    rows={4}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 outline-none focus:ring-2 focus:ring-blue-900/20"
                    placeholder="Relate detalhadamente o ocorrido..."
                    required
                  ></textarea>
                </div>

                <div className="space-y-1.5">
                  <input 
                    type="file" 
                    id="occurrence-photo" 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 800 * 1024) { // 800KB limit
                          alert('A foto é muito grande. Por favor, escolha uma imagem menor (máx 800KB).');
                          e.target.value = '';
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setOccurrencePhoto(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  {occurrencePhoto && (
                    <div className="relative w-full h-32 rounded-lg overflow-hidden border border-gray-200">
                      <img src={occurrencePhoto} alt="Preview" className="w-full h-full object-cover" />
                      <button 
                        type="button"
                        onClick={() => setOccurrencePhoto(null)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full shadow-lg"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full" 
                    onClick={() => document.getElementById('occurrence-photo')?.click()}
                  >
                    <CameraIcon className="w-5 h-5 mr-2" /> 
                    {occurrencePhoto ? 'Alterar Foto' : 'Anexar Foto'}
                  </Button>
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  size="lg" 
                  variant="danger"
                  disabled={submittingOccurrence}
                >
                  {submittingOccurrence ? 'Enviando...' : 'Enviar Relato Operacional'}
                </Button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const NavButton = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) => (
  <button 
    onClick={onClick}
    className={cn(
      'flex flex-col items-center gap-1 transition-all',
      active ? 'text-blue-900' : 'text-gray-400'
    )}
  >
    <div className={cn(
      'p-2 rounded-xl transition-all',
      active ? 'bg-blue-50' : 'bg-transparent'
    )}>
      <Icon className="w-6 h-6" />
    </div>
    <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
  </button>
);

const ScannerInitializer = ({ onScan }: { onScan: (data: string) => void }) => {
  useEffect(() => {
    let isMounted = true;
    let html5QrCode: any = null;

    const initScanner = async () => {
      // Small delay to ensure DOM is ready
      await new Promise(resolve => setTimeout(resolve, 800));
      
      if (!isMounted) return;

      const readerElement = document.getElementById('reader');
      if (!readerElement) return;

      try {
        const statusEl = document.getElementById('scanner-status');
        if (statusEl) statusEl.innerText = "Acessando câmera...";

        // Use the lower-level API for more control
        const { Html5Qrcode } = await import('html5-qrcode');
        html5QrCode = new Html5Qrcode("reader");
        
        const config = { 
          fps: 15, // Higher FPS for faster detection
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          videoConstraints: {
            facingMode: "environment",
            focusMode: "continuous",
            width: { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 }
          }
        };

        // Ensure we don't start if already scanning (though unlikely here)
        if (!html5QrCode.isScanning) {
          await html5QrCode.start(
            { facingMode: "environment" }, 
            config, 
            (decodedText: string) => {
              if (isMounted) {
                // console.log("QR Code detected:", decodedText);
                onScan(decodedText);
              }
            },
            (errorMessage: string) => {
              // Silent scanning errors are normal
            }
          );
        }
        
        if (statusEl) statusEl.innerText = "Câmera Ativa - Aponte para o QR";
        // console.log("Scanner started successfully");
      } catch (err: any) {
        console.error("Scanner initialization failed:", err);
        const statusEl = document.getElementById('scanner-status');
        if (statusEl) statusEl.innerText = `Erro: ${err.message || 'Falha ao abrir câmera'}`;
      }
    };

    initScanner();

    return () => {
      isMounted = false;
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
          // console.log("Scanner stopped");
        }).catch((e: any) => console.error("Failed to stop scanner", e));
      }
    };
  }, []);

  return null;
};

// --- Error Boundary ---
class AppErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-red-50 flex flex-col items-center justify-center p-6 text-center safe-pt safe-pb">
          <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Ops! Algo deu errado.</h1>
          <p className="text-gray-600 mb-6 max-w-md">
            O sistema encontrou um erro inesperado. Tente recarregar a página ou contate o suporte técnico.
          </p>
          <div className="bg-white p-4 rounded-xl border border-red-100 text-left mb-6 w-full max-w-md overflow-auto max-h-40">
            <code className="text-xs text-red-500">{this.state.error?.toString()}</code>
          </div>
          <Button onClick={() => window.location.reload()}>Recarregar Sistema</Button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function AppWrapper() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
