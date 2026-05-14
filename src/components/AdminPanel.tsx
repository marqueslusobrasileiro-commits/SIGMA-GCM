import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, 
  MapPin, 
  Truck, 
  History, 
  FileText,
  Plus,
  Edit2,
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Search, 
  Trash2, 
  Lock, 
  Unlock,
  Printer,
  Bell,
  ChevronRight,
  ChevronLeft,
  Filter,
  Download,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  setDoc,
  query, 
  orderBy, 
  limit,
  where,
  getDocs,
  Timestamp,
  type QuerySnapshot,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { UserProfile, PublicProperty, Team, Vehicle, AuditLog, UserStatus, UserRole, ShiftReport, PatrolRecord } from '../types';
import { patrolEffectiveValidationStatus } from '../lib/patrolGeo';
import { format } from 'date-fns';
import { SUPER_ADMIN_EMAIL } from '../config';
import { groupByDayBy } from '../lib/groupByDay';
import { Capacitor } from '@capacitor/core';
import { apiFetch, apiFetchExternal, getApiBaseUrl, getExternalApiBaseUrl } from '../lib/apiClient';
import {
  resolveShiftReportPdfBlob,
  shiftReportHasResolvablePdfSource,
  trashShiftReportFirestore,
  restoreShiftReportFirestore,
  purgeShiftReportFirestore,
} from '../lib/shiftReportFirebase';
import { sharePdfBlob } from '../lib/nativePdf';
import { addDocClean, setDocClean, updateDocClean } from '../lib/firestoreData';
import appLogo from '../assets/sigma-brand.png';

function formatUserFacingError(message: string, maxLen = 320): string {
  const line = String(message || '').trim().split(/\n/)[0] || 'Erro desconhecido.';
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

function patrolTimestampIsoFromFirestore(data: Record<string, unknown>): string {
  const raw = data.timestamp;
  if (raw instanceof Timestamp) return raw.toDate().toISOString();
  if (typeof raw === 'string') return raw;
  return '';
}

function mapFirestoreDocToPatrolRecord(d: { id: string; data: () => Record<string, unknown> }): PatrolRecord {
  const data = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    ...data,
    timestamp: patrolTimestampIsoFromFirestore(data),
  } as PatrolRecord;
}

function patrolTimeMs(p: PatrolRecord): number {
  const t = new Date(p.timestamp).getTime();
  return Number.isFinite(t) ? t : 0;
}

interface AdminPanelProps {
  profile: UserProfile;
  onClose: () => void;
  logAdminAction: (admin: UserProfile, action: string, details: string, targetId?: string, targetType?: 'user' | 'property' | 'vehicle' | 'team') => Promise<void>;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ profile, onClose, logAdminAction }) => {
  const [activeTab, setActiveTab] = useState<
    'users' | 'properties' | 'vehicles' | 'teams' | 'logs' | 'reports' | 'antifraud'
  >('users');
  const [reportsView, setReportsView] = useState<'active' | 'trash'>('active');
  const [propertiesView, setPropertiesView] = useState<'active' | 'trash'>('active');
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingFsUsers, setPendingFsUsers] = useState<UserProfile[]>([]);
  const [pendingApiUsers, setPendingApiUsers] = useState<UserProfile[]>([]);
  const [pendingApiError, setPendingApiError] = useState<string | null>(null);
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [reports, setReports] = useState<ShiftReport[]>([]);
  const [sendingReportEmailIds, setSendingReportEmailIds] = useState<Set<string>>(new Set());
  const [hasUnreadReports, setHasUnreadReports] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authWarning, setAuthWarning] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<UserStatus | 'ALL'>('ALL');
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PublicProperty | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [patrolAntifraudRows, setPatrolAntifraudRows] = useState<PatrolRecord[]>([]);
  const [patrolAntifraudError, setPatrolAntifraudError] = useState<string | null>(null);
  const [antifraudSince, setAntifraudSince] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return format(d, 'yyyy-MM-dd');
  });

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local'));

  const isVitePreviewPort =
    typeof window !== 'undefined' && (window.location.port === '4173' || window.location.port === '5173');

  const isMasterAdmin = (profile.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  /** Qualquer administrador ATIVO pode mover/restaurar relatório na lixeira (metadados). Purge continua só master. */
  const canModerateShiftReports = profile.role === 'admin' && profile.status === 'ATIVO';
  /** Antifraude: leitura de rondas — qualquer admin ATIVO (Firestore já permite read em patrols para isAtivo). */
  const canViewAntifraud = profile.role === 'admin' && profile.status === 'ATIVO';
  const activeReports = reports.filter((r) => !r.deletedAt);
  const trashedReports = reports.filter((r) => !!r.deletedAt);
  const visibleReports = reportsView === 'trash' ? trashedReports : activeReports;

  const activeProperties = properties.filter((p) => !p.deletedAt);
  const trashedProperties = properties.filter((p) => !!p.deletedAt);
  const visibleProperties = propertiesView === 'trash' ? trashedProperties : activeProperties;

  const visiblePropertyIds = useMemo(() => visibleProperties.map((p) => p.id), [visibleProperties]);
  const allVisiblePropertiesSelected = useMemo(() => {
    if (visiblePropertyIds.length === 0) return false;
    for (const id of visiblePropertyIds) if (!selectedPropertyIds.has(id)) return false;
    return true;
  }, [selectedPropertyIds, visiblePropertyIds]);
  const someVisiblePropertiesSelected = useMemo(() => {
    for (const id of visiblePropertyIds) if (selectedPropertyIds.has(id)) return true;
    return false;
  }, [selectedPropertyIds, visiblePropertyIds]);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someVisiblePropertiesSelected && !allVisiblePropertiesSelected;
  }, [someVisiblePropertiesSelected, allVisiblePropertiesSelected]);

  const platoonOrder = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'OUTROS'] as const;
  type Platoon = (typeof platoonOrder)[number];
  const platoonFromTeamName = (teamName?: string | null): Platoon => {
    const name = String(teamName || '').toUpperCase();
    for (const p of platoonOrder) {
      if (p !== 'OUTROS' && name.includes(p)) return p;
    }
    return 'OUTROS';
  };
  const platoonShiftHint: Partial<Record<Platoon, 'Noturno' | 'Diurno'>> = {
    BRAVO: 'Noturno',
    DELTA: 'Noturno',
  };

  const reportHasPdfSource = (r: ShiftReport) => shiftReportHasResolvablePdfSource(r);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'relatorio.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const openBlobForPrint = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      downloadBlob(blob, filename);
      return;
    }
    // Alguns navegadores bloqueiam print automático; ainda assim abrimos o PDF para o ADM imprimir.
    const tryPrint = () => {
      try { w.focus(); w.print(); } catch {}
    };
    w.addEventListener?.('load', tryPrint);
    window.setTimeout(tryPrint, 1200);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const isShareCanceledError = (e: unknown): boolean => {
    const msg = (e instanceof Error ? e.message : String(e || '')).toLowerCase();
    return msg.includes('share canceled') || msg.includes('share cancelled') || msg.includes('canceled') || msg.includes('cancelled');
  };

  const isShareBusyError = (e: unknown): boolean => {
    const msg = (e instanceof Error ? e.message : String(e || '')).toLowerCase();
    return msg.includes("can't share while sharing is in progress");
  };

  const markSendingEmail = (reportId: string, sending: boolean) => {
    setSendingReportEmailIds((prev) => {
      const next = new Set(prev);
      if (sending) next.add(reportId);
      else next.delete(reportId);
      return next;
    });
  };

  useEffect(() => {
    // Relatórios de plantão (metadados + link do Storage)
    const qReports = query(collection(db, 'shift_reports'), orderBy('createdAt', 'desc'), limit(200));
    const unsubReports = onSnapshot(qReports, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ShiftReport, 'id'>) })));
    });
    return () => unsubReports();
  }, []);

  // Notificação de novos relatórios (badge no tab "Relatórios")
  useEffect(() => {
    const uid = profile?.uid || 'anonymous';
    const storageKey = `admin:lastSeenReportsAt:${uid}`;
    const lastSeenIso = localStorage.getItem(storageKey);
    const lastSeenMs = lastSeenIso ? new Date(lastSeenIso).getTime() : 0;
    const newestMs = activeReports.length > 0 ? new Date(activeReports[0].createdAt).getTime() : 0;
    setHasUnreadReports(newestMs > lastSeenMs);
  }, [profile?.uid, activeReports]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    const uid = profile?.uid || 'anonymous';
    const storageKey = `admin:lastSeenReportsAt:${uid}`;
    const newestIso = activeReports.length > 0 ? activeReports[0].createdAt : new Date().toISOString();
    localStorage.setItem(storageKey, newestIso);
    setHasUnreadReports(false);
  }, [activeTab, profile?.uid, activeReports]);

  useEffect(() => {
    if (!canViewAntifraud || activeTab !== 'antifraud') return;
    setPatrolAntifraudError(null);
    let unsub: (() => void) | undefined;

    const applySnapshot = (snap: QuerySnapshot) => {
      const rows = snap.docs.map(mapFirestoreDocToPatrolRecord);
      rows.sort((a, b) => patrolTimeMs(b) - patrolTimeMs(a));
      setPatrolAntifraudError(null);
      setPatrolAntifraudRows(rows.slice(0, 2000));
    };

    const qOrdered = query(collection(db, 'patrols'), orderBy('timestamp', 'desc'), limit(1500));
    unsub = onSnapshot(
      qOrdered,
      applySnapshot,
      (err) => {
        // Tipos mistos em `timestamp` (string ISO vs Timestamp) quebram orderBy no Firestore.
        console.warn('[antifraude] orderBy(timestamp) falhou; usando leitura sem ordenação do servidor:', err);
        try {
          unsub?.();
        } catch {
          /* noop */
        }
        unsub = undefined;
        const qPlain = query(collection(db, 'patrols'), limit(2500));
        unsub = onSnapshot(
          qPlain,
          applySnapshot,
          (err2) => {
            console.error('[antifraude] patrols (fallback):', err2);
            setPatrolAntifraudError(
              (err2 as Error)?.message ||
                'Não foi possível carregar rondas. Confira permissões (admin ATIVO) e conexão.',
            );
            setPatrolAntifraudRows([]);
          },
        );
      },
    );

    return () => {
      try {
        unsub?.();
      } catch {
        /* noop */
      }
    };
  }, [canViewAntifraud, activeTab]);

  /** Irregulares entre as rondas já carregadas (ignora filtro de data — diagnóstico). */
  const irregularAllLoaded = useMemo(
    () => patrolAntifraudRows.filter((p) => patrolEffectiveValidationStatus(p) === 'FORA_DO_RAIO'),
    [patrolAntifraudRows],
  );

  const irregularPatrolsFiltered = useMemo(() => {
    const sinceMs = new Date(`${antifraudSince}T00:00:00`).getTime();
    return patrolAntifraudRows.filter((p) => {
      if (patrolEffectiveValidationStatus(p) !== 'FORA_DO_RAIO') return false;
      const t = new Date(p.timestamp).getTime();
      return Number.isFinite(t) && t >= sinceMs;
    });
  }, [patrolAntifraudRows, antifraudSince]);

  const irregularByAgent = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const p of irregularPatrolsFiltered) {
      const prev = m.get(p.agentId) || { name: p.agentName, count: 0 };
      prev.count += 1;
      m.set(p.agentId, prev);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [irregularPatrolsFiltered]);

  const handleSaveVehicle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const vehicleData = {
      prefix: formData.get('prefix') as string,
      model: formData.get('model') as string,
      plate: formData.get('plate') as string,
      type: formData.get('type') as string,
      status: formData.get('status') as any
    };

    try {
      if (editingVehicle) {
        await updateDocClean(doc(db, 'vehicles', editingVehicle.id), vehicleData as unknown as Record<string, unknown>);
        await logAdminAction(profile, 'EDIÇÃO DE VIATURA', `Viatura ${vehicleData.prefix} editada.`, editingVehicle.id, 'vehicle');
      } else {
        const docRef = await addDocClean(collection(db, 'vehicles'), vehicleData as unknown as Record<string, unknown>);
        await logAdminAction(profile, 'CRIAÇÃO DE VIATURA', `Viatura ${vehicleData.prefix} criada.`, docRef.id, 'vehicle');
      }
      setShowVehicleModal(false);
      setEditingVehicle(null);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar viatura');
    }
  };

  const handleDeleteVehicle = async (v: Vehicle) => {
    if (!window.confirm(`Tem certeza que deseja excluir a viatura ${v.prefix}?`)) return;
    try {
      await deleteDoc(doc(db, 'vehicles', v.id));
      await logAdminAction(profile, 'EXCLUSÃO DE VIATURA', `Viatura ${v.prefix} excluída.`, v.id, 'vehicle');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir viatura');
    }
  };

  const handleSaveTeam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const teamData = {
      name: formData.get('name') as string,
      shift: formData.get('shift') as string,
      vehiclePrefix: formData.get('vehiclePrefix') as string,
      inCharge: formData.get('inCharge') as string,
      driver: formData.get('driver') as string,
      members: (formData.get('members') as string || '').split(',').map(m => m.trim()).filter(m => m !== ''),
      active: true
    };

    try {
      if (editingTeam) {
        await updateDocClean(doc(db, 'teams', editingTeam.id), teamData as unknown as Record<string, unknown>);
        await logAdminAction(profile, 'EDIÇÃO DE EQUIPE', `Equipe ${teamData.name} editada.`, editingTeam.id, 'team');
      } else {
        const docRef = await addDocClean(collection(db, 'teams'), teamData as unknown as Record<string, unknown>);
        await logAdminAction(profile, 'CRIAÇÃO DE EQUIPE', `Equipe ${teamData.name} criada.`, docRef.id, 'team');
      }
      setShowTeamModal(false);
      setEditingTeam(null);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar equipe');
    }
  };

  const handleDeleteTeam = async (t: Team) => {
    if (!window.confirm(`Tem certeza que deseja excluir a equipe ${t.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'teams', t.id));
      await logAdminAction(profile, 'EXCLUSÃO DE EQUIPE', `Equipe ${t.name} excluída.`, t.id, 'team');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir equipe');
    }
  };

  const handleSaveProperty = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const vrRaw = formData.get('validationRadiusMeters');
    let validationRadiusMeters: number | null = null;
    if (vrRaw != null && String(vrRaw).trim() !== '') {
      const n = Number(vrRaw);
      if (Number.isFinite(n) && n >= 10 && n <= 5000) validationRadiusMeters = Math.round(n);
    }

    const propData = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      address: formData.get('address') as string,
      latitude: Number(formData.get('latitude')),
      longitude: Number(formData.get('longitude')),
      plusCode: formData.get('plusCode') as string,
      qrCode: formData.get('qrCode') as string || `GCM-${Date.now()}`,
      validationRadiusMeters,
      status: 'operational' as const,
      deletedAt: null as string | null,
      deletedBy: null as string | null,
    };

    try {
      if (editingProperty) {
        await updateDocClean(doc(db, 'properties', editingProperty.id), propData as unknown as Record<string, unknown>);
        // Fecha o modal imediatamente após salvar o Firestore.
        // Auditoria roda em segundo plano para não travar UX.
        setShowPropertyModal(false);
        setEditingProperty(null);
        void logAdminAction(profile, 'EDIÇÃO DE POSTO', `Posto ${propData.name} editado.`, editingProperty.id, 'property')
          .catch((logErr) => console.warn('Falha ao registrar auditoria (edição de posto):', logErr));
      } else {
        const docRef = await addDocClean(collection(db, 'properties'), propData as unknown as Record<string, unknown>);
        setShowPropertyModal(false);
        setEditingProperty(null);
        void logAdminAction(profile, 'CRIAÇÃO DE POSTO', `Posto ${propData.name} criado.`, docRef.id, 'property')
          .catch((logErr) => console.warn('Falha ao registrar auditoria (criação de posto):', logErr));
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar posto');
    }
  };

  const handleDeleteProperty = async (prop: PublicProperty) => {
    // Agora "excluir" é Lixeira (soft delete). Purge é separado.
    if (!window.confirm(`Mover o posto "${prop.name}" para a Lixeira?`)) return;
    try {
      await updateDocClean(doc(db, 'properties', prop.id), {
        deletedAt: new Date().toISOString(),
        deletedBy: profile.uid,
      });
      await logAdminAction(profile, 'LIXEIRA (POSTO)', `Posto ${prop.name} movido para a Lixeira.`, prop.id, 'property');
    } catch (err) {
      console.error(err);
      alert('Erro ao mover posto para lixeira');
    }
  };

  const handleRestoreProperty = async (prop: PublicProperty) => {
    if (!window.confirm(`Restaurar o posto "${prop.name}" da Lixeira?`)) return;
    try {
      await updateDocClean(doc(db, 'properties', prop.id), { deletedAt: null, deletedBy: null });
      await logAdminAction(profile, 'RESTAURAR (POSTO)', `Posto ${prop.name} restaurado da Lixeira.`, prop.id, 'property');
    } catch (err) {
      console.error(err);
      alert('Erro ao restaurar posto');
    }
  };

  const handlePurgeProperty = async (prop: PublicProperty) => {
    if (!window.confirm(`Excluir DEFINITIVAMENTE o posto "${prop.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteDoc(doc(db, 'properties', prop.id));
      await logAdminAction(profile, 'PURGE (POSTO)', `Posto ${prop.name} excluído definitivamente.`, prop.id, 'property');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir definitivamente');
    }
  };

  const togglePropertySelection = (id: string, checked: boolean) => {
    setSelectedPropertyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clearPropertySelection = () => setSelectedPropertyIds(new Set());

  const selectAllVisibleProperties = () => {
    setSelectedPropertyIds(new Set(visibleProperties.map((p) => p.id)));
  };

  const bulkTrashProperties = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Mover ${label} para a Lixeira?`)) return;
    try {
      await Promise.all(
        ids.map((id) =>
          updateDocClean(doc(db, 'properties', id), { deletedAt: new Date().toISOString(), deletedBy: profile.uid }),
        ),
      );
      void logAdminAction(profile, 'LIXEIRA (POSTO) EM MASSA', `${ids.length} posto(s) movido(s) para a Lixeira.`, undefined, 'property');
      clearPropertySelection();
    } catch (err) {
      console.error(err);
      alert('Erro ao mover itens para a lixeira');
    }
  };

  const bulkRestoreProperties = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Restaurar ${label} da Lixeira?`)) return;
    try {
      await Promise.all(
        ids.map((id) => updateDocClean(doc(db, 'properties', id), { deletedAt: null, deletedBy: null })),
      );
      void logAdminAction(profile, 'RESTAURAR (POSTO) EM MASSA', `${ids.length} posto(s) restaurado(s) da Lixeira.`, undefined, 'property');
      clearPropertySelection();
    } catch (err) {
      console.error(err);
      alert('Erro ao restaurar itens');
    }
  };

  const bulkPurgeProperties = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Excluir DEFINITIVAMENTE ${label}? Esta ação não pode ser desfeita.`)) return;
    try {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, 'properties', id))));
      void logAdminAction(profile, 'PURGE (POSTO) EM MASSA', `${ids.length} posto(s) excluído(s) definitivamente.`, undefined, 'property');
      clearPropertySelection();
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir definitivamente (massa)');
    }
  };

  useEffect(() => {
    let unsubUsers: (() => void) | null = null;
    let unsubPending: (() => void) | null = null;
    let unsubProperties: (() => void) | null = null;
    let unsubVehicles: (() => void) | null = null;
    let unsubTeams: (() => void) | null = null;
    let unsubLogs: (() => void) | null = null;
    let interval: any = null;

    const cleanup = () => {
      try { unsubUsers?.(); } catch {}
      try { unsubPending?.(); } catch {}
      try { unsubProperties?.(); } catch {}
      try { unsubVehicles?.(); } catch {}
      try { unsubTeams?.(); } catch {}
      try { unsubLogs?.(); } catch {}
      unsubUsers = unsubPending = unsubProperties = unsubVehicles = unsubTeams = unsubLogs = null;
      if (interval) clearInterval(interval);
      interval = null;
    };

    const setup = async () => {
      setLoading(true);
      setAuthWarning(null);

      unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setUsers(snap.docs.map(d => ({ ...d.data() as UserProfile, uid: d.id })));
        setLoading(false);
      }, (err) => {
        console.error('Erro ao ler usuários (Firestore):', err);
        setLoading(false);
        alert('Admin: não foi possível carregar usuários (permissão/rede).');
      });

      // Dedicated real-time pending list + counter
      unsubPending = onSnapshot(
        query(collection(db, 'users'), where('status', '==', 'PENDENTE')),
        (snap) => {
          setPendingCount(snap.size);
          setPendingFsUsers(snap.docs.map(d => ({ ...d.data() as UserProfile, uid: d.id })));
        },
        (err) => console.warn('Falha ao consultar pendentes (Firestore):', err),
      );

      unsubProperties = onSnapshot(collection(db, 'properties'), (snap) => {
        setProperties(snap.docs.map(d => ({ ...d.data() as PublicProperty, id: d.id })));
      });
      unsubVehicles = onSnapshot(collection(db, 'vehicles'), (snap) => {
        setVehicles(snap.docs.map(d => ({ ...d.data() as Vehicle, id: d.id })));
      });
      unsubTeams = onSnapshot(collection(db, 'teams'), (snap) => {
        setTeams(snap.docs.map(d => ({ ...d.data() as Team, id: d.id })));
      });
      unsubLogs = onSnapshot(
        query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100)),
        (snap) => setLogs(snap.docs.map(d => ({ ...d.data() as AuditLog, id: d.id }))),
        (err) => console.warn('Falha ao ler audit_logs (ok se regras bloquearem):', err),
      );

      const fetchPendingFromApi = async () => {
        try {
          setPendingApiError(null);
          const idToken = await auth.currentUser?.getIdToken();
          if (!idToken) return;
          const tryFetch = async (url: string) => {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
            const data = await res.json().catch(() => ({}));
            return { res, data };
          };

          let { res, data } = await tryFetch('/admin/pending-users');
          if (!res.ok) {
            ({ res, data } = await tryFetch('/api/admin/pending-users'));
          }
          if (!res.ok) {
            const details = data?.details
              ? ` ${JSON.stringify(data.details)}`
              : '';
            setPendingApiError((data?.error || 'Falha ao buscar pendentes (API).') + details);
            return;
          }

          const apiUsers = Array.isArray(data?.users) ? (data.users as any[]) : [];
          setPendingApiUsers(
            apiUsers.map((u) => ({
              uid: u.uid || u.id,
              name: u.name || '',
              registration: u.registration || '',
              role: (u.role || 'agent') as any,
              status: (u.status || 'PENDENTE') as any,
              email: u.email || '',
              photoUrl: u.photoUrl,
              photoVersion: u.photoVersion,
              biometricEnabled: u.biometricEnabled,
              failedAttempts: u.failedAttempts,
              lockedUntil: u.lockedUntil,
              createdAt: u.createdAt || new Date().toISOString(),
            })),
          );

          if (process.env.NODE_ENV !== 'production') {
            console.log('[admin] pendentes:', apiUsers.length);
          }
        } catch (e) {
          setPendingApiError(e instanceof Error ? e.message : String(e));
        }
      };

      void fetchPendingFromApi();
      interval = setInterval(fetchPendingFromApi, 5_000);
    };

    // Wait for Firebase Auth to be ready, otherwise auth.currentUser may be null on first render.
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      cleanup();
      if (!u) {
        setAuthWarning(
          'Para aprovar usuários, faça login como ADMIN usando e-mail/senha ou Google (Firebase Auth). ' +
            'Login biométrico não cria sessão do Firestore neste navegador.',
        );
        setLoading(false);
        return;
      }
      void setup();
    });

    return () => {
      try { unsubAuth(); } catch {}
      cleanup();
    };
  }, []);

  const handleUserStatus = async (user: UserProfile, newStatus: UserStatus) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert('Sessão inválida. Faça login novamente.');
        return;
      }
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(user.uid)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Erro ao atualizar status');
        return;
      }
      await logAdminAction(profile, 'ALTERAÇÃO DE STATUS', `Usuário ${user.name} alterado para ${newStatus}`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar status');
    }
  };

  const handleUserRole = async (user: UserProfile, newRole: UserRole) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert('Sessão inválida. Faça login novamente.');
        return;
      }
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(user.uid)}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Erro ao atualizar perfil');
        return;
      }
      await logAdminAction(profile, 'ALTERAÇÃO DE PERFIL', `Usuário ${user.name} alterado para ${newRole}`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar perfil');
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário ${user.name}?`)) return;
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert('Sessão inválida. Faça login novamente.');
        return;
      }
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(user.uid)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || 'Erro ao excluir usuário');
        return;
      }
      await logAdminAction(profile, 'EXCLUSÃO DE USUÁRIO', `Usuário ${user.name} excluído do sistema.`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir usuário');
    }
  };

  const filteredUsers = users
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    })
    .filter(u => {
    const q = (searchTerm || '').toLowerCase();
    const name = (u.name || '').toString().toLowerCase();
    const reg = (u.registration || '').toString().toLowerCase();
    const email = (u.email || '').toString().toLowerCase();
    const matchesSearch = name.includes(q) || reg.includes(q) || email.includes(q);
    const matchesStatus = filterStatus === 'ALL' || u.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const pendingUsersView = (() => {
    const byUid = new Map<string, UserProfile>();
    // Prefer dedicated Firestore query for pending (more reliable than filtering the full list)
    for (const u of pendingFsUsers) byUid.set(u.uid, u);
    // Still include any pending that came through the full snapshot (defensive)
    for (const u of filteredUsers.filter((u) => u.status === 'PENDENTE')) byUid.set(u.uid, u);
    for (const u of pendingApiUsers) byUid.set(u.uid, u);
    return Array.from(byUid.values()).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  })();

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 w-full max-w-6xl h-[95vh] sm:h-[90vh] rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="sigma-brand-frame sigma-brand-frame--sm flex h-10 w-10 flex-shrink-0 ring-1 ring-amber-500/40">
              <img src={appLogo} alt="SIGMA-GCM" decoding="async" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Painel Administrativo</h2>
              <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">SIGMA-GCM Control Center</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/30 overflow-x-auto no-scrollbar">
          {[
            { id: 'users', label: 'Usuários', icon: Users },
            { id: 'properties', label: 'Postos/Próprios', icon: MapPin },
            { id: 'vehicles', label: 'Viaturas', icon: Truck },
            { id: 'teams', label: 'Equipes', icon: Users },
            { id: 'reports', label: 'Relatórios', icon: FileText },
            ...(canViewAntifraud ? [{ id: 'antifraud' as const, label: 'Antifraude', icon: AlertTriangle }] : []),
            { id: 'logs', label: 'Auditoria', icon: History },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`relative flex items-center gap-2 px-6 py-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'text-amber-500 border-amber-500 bg-amber-500/5' 
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.id === 'reports' && hasUnreadReports && (
                <span
                  className="absolute top-2 right-2 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg pointer-events-none"
                  title="Novos relatórios"
                >
                  <Bell className="w-2.5 h-2.5" />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-900/50">
          {isLocalhost && isVitePreviewPort && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-200 rounded-2xl p-4 text-sm">
              <p className="font-bold mb-1">Backend não disponível neste preview</p>
              <p className="text-xs text-red-200/80 leading-relaxed">
                Você está em <span className="font-mono">{window.location.host}</span> (Vite preview). Aqui as rotas{' '}
                <span className="font-mono">/api/*</span> não rodam, então criar/aprovar usuários pode falhar.
                Abra pelo servidor completo em <span className="font-mono">http://127.0.0.1:3000</span>.
              </p>
            </div>
          )}
          {authWarning && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-2xl p-4 text-sm">
              <p className="font-bold mb-1">Sessão de admin não detectada</p>
              <p className="text-xs text-amber-200/80 leading-relaxed">{authWarning}</p>
            </div>
          )}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    placeholder="Buscar por nome, matrícula ou email..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <Filter className="w-4 h-4 text-slate-500" />
                  <select 
                    className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-amber-500"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as any)}
                  >
                    <option value="ALL">Todos os Status</option>
                    <option value="PENDENTE">Pendentes ({Math.max(pendingCount, pendingApiUsers.length)})</option>
                    <option value="ATIVO">Ativos</option>
                    <option value="BLOQUEADO">Bloqueados</option>
                    <option value="DESATIVADO">Desativados</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4">
                {filterStatus === 'PENDENTE' && pendingApiError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded-2xl p-4 text-sm">
                    <p className="font-bold mb-1">Falha ao sincronizar pendentes (API)</p>
                    <p className="text-xs text-red-200/80 leading-relaxed">{pendingApiError}</p>
                  </div>
                )}

                {((filterStatus === 'PENDENTE' ? pendingUsersView : filteredUsers).length === 0) && (
                  <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6 text-slate-300">
                    <p className="font-bold text-white mb-1">Nenhum usuário encontrado</p>
                    <p className="text-sm text-slate-400">
                      Se alguém acabou de se cadastrar, confirme que o ADMIN está logado via Firebase Auth e que o usuário criou o perfil no Firestore com status <span className="font-mono">PENDENTE</span>.
                    </p>
                  </div>
                )}
                {(filterStatus === 'PENDENTE' ? pendingUsersView : filteredUsers).map((user) => {
                  const isMaster = (user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

                  return (
                    <motion.div 
                      layout
                      key={user.uid}
                      className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-slate-600 transition-colors"
                    >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                        {user.photoUrl ? (
                          <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <Users className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-white">{user.name}</h3>
                          {isMaster && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-black uppercase bg-indigo-500/20 text-indigo-300">
                              MASTER
                            </span>
                          )}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            user.status === 'ATIVO' ? 'bg-emerald-500/20 text-emerald-400' :
                            user.status === 'PENDENTE' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {user.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">Matrícula: {user.registration} • {user.email}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold mt-1">Perfil: {user.role === 'admin' ? 'ADMINISTRADOR' : user.role === 'supervisor' ? 'SUPERVISOR' : 'AGENTE'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-nowrap max-w-full overflow-x-auto no-scrollbar">
                      {user.status === 'PENDENTE' && (
                        <>
                          <button 
                            onClick={() => handleUserStatus(user, 'ATIVO')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                            disabled={isMaster}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Aprovar
                          </button>
                          <button
                            onClick={() => handleUserStatus(user, 'BLOQUEADO')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                            title="Bloqueia o acesso no Auth e no Firestore"
                            disabled={isMaster}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Bloquear
                          </button>
                          <button
                            onClick={() => handleUserStatus(user, 'DESATIVADO')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                            title="Recusa a solicitação (desativa)"
                            disabled={isMaster}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Recusar
                          </button>
                        </>
                      )}
                      
                      {user.status === 'ATIVO' ? (
                        <button 
                          onClick={() => handleUserStatus(user, 'BLOQUEADO')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                          disabled={isMaster}
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Bloquear
                        </button>
                      ) : user.status === 'BLOQUEADO' ? (
                        <button 
                          onClick={() => handleUserStatus(user, 'ATIVO')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                          disabled={isMaster}
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          Desbloquear
                        </button>
                      ) : null}

                      <select 
                        className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white outline-none shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                        value={user.role}
                        onChange={(e) => handleUserRole(user, e.target.value as UserRole)}
                        disabled={isMaster}
                      >
                        <option value="agent">Agente</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Administrador</option>
                      </select>

                      <button 
                        onClick={() => handleDeleteUser(user)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                        title="Excluir usuário"
                        disabled={isMaster || !isMasterAdmin}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'antifraud' && canViewAntifraud && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Antifraude — rondas fora do raio</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  QR escaneado com o agente além do raio configurado no posto: o registro é salvo como irregular para auditoria.
                  Para testar: em <span className="text-slate-300">Postos/Próprios</span> defina um raio pequeno (ex.: 15 m) no posto, afaste-se com o celular e registre a ronda pelo QR — o app avisa e o registro aparece aqui.
                </p>
              </div>
              {patrolAntifraudError && (
                <div className="bg-red-500/15 border border-red-500/40 text-red-200 rounded-2xl p-4 text-sm">
                  <p className="font-bold mb-1">Erro ao carregar rondas</p>
                  <p className="text-xs opacity-90">{patrolAntifraudError}</p>
                </div>
              )}
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Diagnóstico: <span className="text-slate-300 font-mono">{patrolAntifraudRows.length}</span> rondas
                carregadas • <span className="text-slate-300 font-mono">{irregularAllLoaded.length}</span> irregular(es)
                nos dados • <span className="text-amber-400/90 font-mono">{irregularPatrolsFiltered.length}</span> no
                período. Se o 1º for &gt;0 e o 3º for 0, ajuste &quot;Período desde&quot; para uma data mais antiga.
              </p>
              <div className="flex flex-wrap gap-4 items-end">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wide">
                  Período desde
                  <input
                    type="date"
                    value={antifraudSince}
                    onChange={(e) => setAntifraudSince(e.target.value)}
                    className="block mt-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                  <p className="text-[10px] font-black uppercase text-amber-400 tracking-wide">
                    Total irregular (período)
                  </p>
                  <p className="text-2xl font-black text-white mt-1">{irregularPatrolsFiltered.length}</p>
                </div>
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 sm:col-span-2">
                  <p className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-wide">
                    Agentes com ocorrência
                  </p>
                  {irregularByAgent.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma irregularidade no período.</p>
                  ) : (
                    <ul className="text-sm text-slate-200 space-y-1">
                      {irregularByAgent.map(([agentUid, { name, count }]) => (
                        <li key={agentUid}>
                          <span className="font-bold text-white">{name}</span>{' '}
                          <span className="text-amber-400">({count})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="bg-slate-800/30 rounded-2xl border border-slate-800 overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-bold">
                    <tr>
                      <th className="px-4 py-3">Data/Hora</th>
                      <th className="px-4 py-3">Agente</th>
                      <th className="px-4 py-3">Posto</th>
                      <th className="px-4 py-3">Referência do posto</th>
                      <th className="px-4 py-3">Distância / limite</th>
                      <th className="px-4 py-3">Viatura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {irregularPatrolsFiltered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                          Nenhum registro irregular neste período.
                        </td>
                      </tr>
                    ) : (
                      irregularPatrolsFiltered.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                            {(() => {
                              try {
                                const d = new Date(p.timestamp);
                                return Number.isFinite(d.getTime()) ? format(d, 'dd/MM/yyyy HH:mm') : '—';
                              } catch {
                                return '—';
                              }
                            })()}
                          </td>
                          <td className="px-4 py-3 text-white font-medium">{p.agentName}</td>
                          <td className="px-4 py-3 text-slate-300">{p.propertyName}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {p.propertyAnchorSource === 'plusCode' ? (
                              <span className="text-emerald-400/90 font-semibold">Plus Code</span>
                            ) : p.propertyAnchorSource === 'coordinates' ? (
                              <span className="text-slate-300">Cadastro (lat/lng)</span>
                            ) : (
                              <span className="text-slate-500" title="Registro anterior ao campo propertyAnchorSource">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-amber-400 font-bold whitespace-nowrap">
                            {typeof p.distanceMeters === 'number' ? `${p.distanceMeters} m` : '—'} /{' '}
                            {p.allowedRadiusMeters ?? 50} m
                          </td>
                          <td className="px-4 py-3 text-slate-400">{p.vehiclePrefix || p.vehicleId}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Logs de Auditoria</h3>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors">
                  <Download className="w-4 h-4" />
                  Exportar CSV
                </button>
              </div>
              <div className="bg-slate-800/30 rounded-2xl border border-slate-800 overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-bold">
                    <tr>
                      <th className="px-4 py-3">Data/Hora</th>
                      <th className="px-4 py-3">Administrador</th>
                      <th className="px-4 py-3">Ação</th>
                      <th className="px-4 py-3">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                          {format(new Date(log.timestamp), 'dd/MM/yy HH:mm:ss')}
                        </td>
                        <td className="px-4 py-3 text-white font-medium">{log.adminName}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            log.action.includes('EXCLUSÃO') ? 'bg-red-500/20 text-red-400' :
                            log.action.includes('ALTERAÇÃO') ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs break-words">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white">Relatórios de Plantão</h3>
                  <div className="flex items-center bg-slate-800/40 border border-slate-700 rounded-xl p-1">
                    <button
                      type="button"
                      onClick={() => setReportsView('active')}
                      className={[
                        'px-3 py-1.5 text-xs font-black rounded-lg transition-colors',
                        reportsView === 'active' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:text-white',
                      ].join(' ')}
                      title="Relatórios ativos"
                    >
                      Ativos
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportsView('trash')}
                      className={[
                        'px-3 py-1.5 text-xs font-black rounded-lg transition-colors',
                        reportsView === 'trash' ? 'bg-red-600 text-white' : 'text-slate-300 hover:text-white',
                      ].join(' ')}
                      title="Lixeira"
                    >
                      Lixeira
                    </button>
                  </div>
                </div>
                <span className="text-xs text-slate-400 font-bold whitespace-nowrap">
                  {reportsView === 'trash' ? 'Lixeira' : 'Ativos'}: {visibleReports.length} • Total: {Math.min(reports.length, 200)}
                </span>
              </div>

              {visibleReports.length === 0 ? (
                <div className="bg-slate-800/30 rounded-2xl border border-slate-800 p-8 text-center text-slate-400">
                  {reportsView === 'trash'
                    ? 'Nenhum relatório na lixeira.'
                    : 'Nenhum relatório encontrado ainda.'}
                </div>
              ) : (
                <div className="space-y-4">
                  {platoonOrder
                    .map((p) => {
                      const items = visibleReports.filter((r) => platoonFromTeamName(r.teamName) === p);
                      return { p, items };
                    })
                    .filter(({ items }) => items.length > 0)
                    .map(({ p, items }) => (
                      <div key={p} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-white tracking-widest">
                              PELOTÃO {p}
                            </span>
                            {platoonShiftHint[p] && (
                              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
                                {platoonShiftHint[p]}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 font-bold">
                            {items.length} relatório(s)
                          </span>
                        </div>

                        <div className="space-y-4">
                          {groupByDayBy<ShiftReport>(
                            items,
                            (r: ShiftReport) => (r.deletedAt ? r.deletedAt : r.createdAt),
                          ).map((group) => (
                            <div key={`${p}-${group.key}`} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-slate-800" />
                                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                                  {group.label}
                                </span>
                                <div className="h-px flex-1 bg-slate-800" />
                              </div>

                              <div className="grid gap-3">
                                {group.items.map((r) => (
                                  <div
                                    key={r.id}
                                    className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-white font-bold truncate">
                                          {r.agentName}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300">
                                          {r.shift}
                                        </span>
                                        {r.vehiclePrefix && (
                                          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300">
                                            {r.vehiclePrefix}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-slate-400 mt-1">
                                        {r.teamName ? `Equipe: ${r.teamName} • ` : ''}
                                        {format(new Date(r.createdAt), 'dd/MM/yyyy HH:mm')}
                                      </p>
                                      <p className="text-[11px] text-slate-500 font-mono mt-1 break-all">
                                        {r.filename}
                                      </p>
                                      {r.delivery === 'metadata_only' && (
                                        <p className="text-[10px] text-amber-400/90 mt-1 font-bold uppercase tracking-wide">
                                          Registro sem PDF no Firebase — configure Storage ou API para anexar arquivo.
                                        </p>
                                      )}
                                      <p className="text-[11px] text-slate-500 mt-1">
                                        Período: {format(new Date(r.windowStart), 'dd/MM HH:mm')} – {format(new Date(r.windowEnd), 'dd/MM HH:mm')}
                                      </p>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        disabled={!reportHasPdfSource(r)}
                                        onClick={async () => {
                                          if (!reportHasPdfSource(r)) return;
                                          try {
                                            const blob = await resolveShiftReportPdfBlob(r);
                                            if (Capacitor.isNativePlatform()) {
                                              await sharePdfBlob(blob, r.filename, 'Relatório de Plantão');
                                            } else {
                                              downloadBlob(blob, r.filename);
                                            }
                                          } catch (e) {
                                            console.error(e);
                                            if (Capacitor.isNativePlatform() && isShareCanceledError(e)) return;
                                            if (Capacitor.isNativePlatform() && isShareBusyError(e)) return;
                                            const msg = e instanceof Error ? e.message : String(e);
                                            const base = getApiBaseUrl();
                                            const extra =
                                              Capacitor.isNativePlatform() && msg.toLowerCase().includes('failed to fetch')
                                                ? `\n\nDiagnóstico:\n- apiBaseUrl: ${base || '(null)'}\n- origin: ${window.location.origin}`
                                                : '';
                                            alert(`Não foi possível baixar o PDF.\n\n${formatUserFacingError(msg)}${extra}`);
                                          }
                                        }}
                                        className={[
                                          'flex items-center gap-2 px-3 py-2 text-white text-xs font-bold rounded-xl transition-colors',
                                          reportHasPdfSource(r)
                                            ? 'bg-amber-600 hover:bg-amber-500'
                                            : 'bg-slate-700/60 opacity-60 cursor-not-allowed',
                                        ].join(' ')}
                                        title={
                                          reportHasPdfSource(r)
                                            ? 'Baixar PDF'
                                            : 'Sem URL, Storage ou API para obter o arquivo'
                                        }
                                      >
                                        <Download className="w-4 h-4" />
                                        Baixar
                                      </button>

                                      <button
                                        type="button"
                                        disabled={!reportHasPdfSource(r)}
                                        onClick={async () => {
                                          if (!reportHasPdfSource(r)) return;
                                          try {
                                            const blob = await resolveShiftReportPdfBlob(r);
                                            if (Capacitor.isNativePlatform()) {
                                              // Em Android WebView, não há `window.print()` confiável. Compartilhar abre em apps que imprimem/visualizam PDF.
                                              await sharePdfBlob(blob, r.filename, 'Imprimir/abrir relatório');
                                            } else {
                                              openBlobForPrint(blob, r.filename);
                                            }
                                          } catch (e) {
                                            console.error(e);
                                            if (Capacitor.isNativePlatform() && isShareCanceledError(e)) return;
                                            if (Capacitor.isNativePlatform() && isShareBusyError(e)) return;
                                            const msg = e instanceof Error ? e.message : String(e);
                                            const base = getApiBaseUrl();
                                            const extra =
                                              Capacitor.isNativePlatform() && msg.toLowerCase().includes('failed to fetch')
                                                ? `\n\nDiagnóstico:\n- apiBaseUrl: ${base || '(null)'}\n- origin: ${window.location.origin}`
                                                : '';
                                            alert(`Não foi possível abrir para impressão.\n\n${formatUserFacingError(msg)}${extra}`);
                                          }
                                        }}
                                        className={[
                                          'flex items-center gap-2 px-3 py-2 text-white text-xs font-bold rounded-xl transition-colors',
                                          reportHasPdfSource(r)
                                            ? 'bg-slate-700 hover:bg-slate-600'
                                            : 'bg-slate-700/60 opacity-60 cursor-not-allowed',
                                        ].join(' ')}
                                        title={
                                          reportHasPdfSource(r)
                                            ? 'Imprimir'
                                            : 'Sem fonte de PDF para abrir/imprimir'
                                        }
                                      >
                                        <Printer className="w-4 h-4" />
                                        Imprimir
                                      </button>

                                      <button
                                        type="button"
                                        disabled={!isMasterAdmin || !reportHasPdfSource(r) || sendingReportEmailIds.has(r.id)}
                                        onClick={async () => {
                                          if (
                                            !isMasterAdmin ||
                                            !reportHasPdfSource(r) ||
                                            sendingReportEmailIds.has(r.id)
                                          )
                                            return;
                                          try {
                                            markSendingEmail(r.id, true);
                                            const u = auth.currentUser;
                                            if (!u) throw new Error('Sessão expirada.');
                                            const token = await u.getIdToken();
                                            const urlPath = `/api/shift-reports/send/${encodeURIComponent(r.id)}`;
                                            const absolute = `${getExternalApiBaseUrl()}${urlPath}`;
                                            console.info('[email] enviando', {
                                              absolute,
                                              origin: window.location.origin,
                                            });
                                            const resp = await apiFetchExternal(
                                              urlPath,
                                              {
                                                method: 'POST',
                                                headers: { Authorization: `Bearer ${token}` },
                                              },
                                              {
                                                retries: 4,
                                                baseDelayMs: 2500,
                                                maxDelayMs: 15000,
                                              },
                                            );
                                            const payload = await resp
                                              .json()
                                              .catch(() => ({} as any));
                                            if (!resp.ok) {
                                              console.error('[email] resposta não-ok', {
                                                status: resp.status,
                                                statusText: resp.statusText,
                                                payload,
                                              });
                                              throw new Error(payload?.error || `Falha ao enviar (HTTP ${resp.status})`);
                                            }
                                            const dest =
                                              typeof payload?.emailTo === 'string' && payload.emailTo.trim()
                                                ? payload.emailTo.trim()
                                                : 'o endereço configurado em ADMIN_EMAIL no servidor';
                                            alert(`Relatório enviado com sucesso.\n\nDestino: ${dest}\n\nConfira também a pasta Spam/Lixo eletrônico.`);
                                          } catch (e) {
                                            console.error(e);
                                            if (Capacitor.isNativePlatform() && isShareCanceledError(e)) return;
                                            if (Capacitor.isNativePlatform() && isShareBusyError(e)) return;
                                            const msg = e instanceof Error ? e.message : String(e);
                                            const ext = getExternalApiBaseUrl();
                                            const base = getApiBaseUrl();
                                            const extra =
                                              msg.toLowerCase().includes('failed to fetch')
                                                ? `\n\nDiagnóstico:\n- externalApiBaseUrl: ${ext}\n- apiBaseUrl: ${base || '(null)'}\n- origin: ${window.location.origin}`
                                                : '';
                                            alert(
                                              `Não foi possível enviar o relatório por e-mail.\n\n${formatUserFacingError(msg)}${extra}`,
                                            );
                                          } finally {
                                            markSendingEmail(r.id, false);
                                          }
                                        }}
                                        className={[
                                          'flex items-center gap-2 px-3 py-2 text-white text-xs font-bold rounded-xl transition-colors',
                                          isMasterAdmin && reportHasPdfSource(r) && !sendingReportEmailIds.has(r.id)
                                            ? 'bg-slate-700 hover:bg-slate-600'
                                            : 'bg-slate-700/60 opacity-60 cursor-not-allowed',
                                        ].join(' ')}
                                        title={
                                          !isMasterAdmin
                                            ? 'Somente o ADM MASTER pode enviar por e-mail'
                                            : reportHasPdfSource(r)
                                              ? 'Enviar por e-mail (via API externa)'
                                              : 'Sem arquivo para anexar no e-mail'
                                        }
                                      >
                                        <Download className="w-4 h-4" />
                                        {sendingReportEmailIds.has(r.id) ? 'Enviando...' : 'Enviar e-mail'}
                                      </button>

                                      <button
                                        type="button"
                                        disabled={
                                          reportsView === 'trash'
                                            ? !isMasterAdmin
                                            : !canModerateShiftReports
                                        }
                                        onClick={async () => {
                                          if (reportsView === 'trash') {
                                            if (!isMasterAdmin) return;
                                          } else if (!canModerateShiftReports) return;
                                          if (reportsView === 'trash') {
                                            if (!window.confirm('Excluir DEFINITIVAMENTE este relatório? Esta ação não pode ser desfeita.')) return;
                                          } else {
                                            if (!window.confirm('Mover este relatório para a Lixeira?')) return;
                                          }
                                          try {
                                            const u = auth.currentUser;
                                            if (!u) throw new Error('Sessão expirada.');
                                            const token = await u.getIdToken();
                                            if (getApiBaseUrl()) {
                                              const endpoint =
                                                reportsView === 'trash'
                                                  ? `/api/shift-reports/purge/${encodeURIComponent(r.id)}`
                                                  : `/api/shift-reports/trash/${encodeURIComponent(r.id)}`;
                                              const resp = await apiFetch(endpoint, {
                                                method: reportsView === 'trash' ? 'DELETE' : 'POST',
                                                headers: { Authorization: `Bearer ${token}` },
                                              });
                                              if (!resp.ok) {
                                                const data = await resp.json().catch(() => ({}));
                                                throw new Error(
                                                  data?.error ||
                                                    `Falha ao ${reportsView === 'trash' ? 'excluir definitivamente' : 'mover para lixeira'} (HTTP ${resp.status})`,
                                                );
                                              }
                                            } else if (reportsView === 'trash') {
                                              await purgeShiftReportFirestore(r);
                                            } else {
                                              await trashShiftReportFirestore(r.id);
                                            }
                                          } catch (e) {
                                            console.error(e);
                                            const msg = e instanceof Error ? e.message : String(e);
                                            alert(`Não foi possível concluir a ação.\n\nDetalhes: ${msg}`);
                                          }
                                        }}
                                        className={[
                                          'inline-flex items-center justify-center h-10 w-10 rounded-xl transition-colors',
                                          reportsView === 'trash'
                                            ? isMasterAdmin
                                              ? 'bg-red-600 hover:bg-red-500 text-white'
                                              : 'bg-red-600/40 text-white/70 opacity-60 cursor-not-allowed'
                                            : canModerateShiftReports
                                              ? 'bg-red-600 hover:bg-red-500 text-white'
                                              : 'bg-red-600/40 text-white/70 opacity-60 cursor-not-allowed',
                                        ].join(' ')}
                                        title={
                                          reportsView === 'trash'
                                            ? !isMasterAdmin
                                              ? 'Somente o ADM MASTER pode excluir definitivamente'
                                              : 'Excluir definitivamente'
                                            : !canModerateShiftReports
                                              ? 'Somente administrador ATIVO pode mover para a lixeira'
                                              : 'Mover para lixeira'
                                        }
                                      >
                                        <Trash2 className="w-5 h-5" />
                                      </button>

                                      {reportsView === 'trash' && (
                                        <button
                                          type="button"
                                          disabled={!canModerateShiftReports}
                                          onClick={async () => {
                                            if (!canModerateShiftReports) return;
                                            if (!window.confirm('Restaurar este relatório da Lixeira?')) return;
                                            try {
                                              const u = auth.currentUser;
                                              if (!u) throw new Error('Sessão expirada.');
                                              const token = await u.getIdToken();
                                              if (getApiBaseUrl()) {
                                                const resp = await apiFetch(
                                                  `/api/shift-reports/restore/${encodeURIComponent(r.id)}`,
                                                  {
                                                    method: 'POST',
                                                    headers: { Authorization: `Bearer ${token}` },
                                                  },
                                                );
                                                if (!resp.ok) {
                                                  const data = await resp.json().catch(() => ({}));
                                                  throw new Error(
                                                    data?.error || `Falha ao restaurar (HTTP ${resp.status})`,
                                                  );
                                                }
                                              } else {
                                                await restoreShiftReportFirestore(r.id);
                                              }
                                            } catch (e) {
                                              console.error(e);
                                              const msg = e instanceof Error ? e.message : String(e);
                                              alert(`Não foi possível restaurar.\n\nDetalhes: ${msg}`);
                                            }
                                          }}
                                          className={[
                                            'flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl transition-colors',
                                            canModerateShiftReports ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-emerald-600/40 text-white/70 opacity-60 cursor-not-allowed',
                                          ].join(' ')}
                                          title={canModerateShiftReports ? 'Restaurar da lixeira' : 'Somente administrador ATIVO pode restaurar'}
                                        >
                                          <Unlock className="w-4 h-4" />
                                          Restaurar
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'properties' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    placeholder="Buscar postos..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                  <div className="inline-flex rounded-xl bg-slate-800 border border-slate-700 p-1">
                    <button
                      type="button"
                      onClick={() => { setPropertiesView('active'); clearPropertySelection(); }}
                      className={[
                        'px-3 py-1.5 text-xs font-black rounded-lg transition-colors',
                        propertiesView === 'active' ? 'bg-slate-900 text-white' : 'text-slate-300 hover:text-white',
                      ].join(' ')}
                    >
                      Ativos
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPropertiesView('trash'); clearPropertySelection(); }}
                      className={[
                        'px-3 py-1.5 text-xs font-black rounded-lg transition-colors',
                        propertiesView === 'trash' ? 'bg-red-600 text-white' : 'text-slate-300 hover:text-white',
                      ].join(' ')}
                    >
                      Lixeira
                    </button>
                  </div>

                  <button 
                    onClick={() => { setEditingProperty(null); setShowPropertyModal(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    disabled={!isMasterAdmin || propertiesView === 'trash'}
                    title={
                      !isMasterAdmin
                        ? 'Apenas o ADMIN MASTER pode criar/editar postos.'
                        : propertiesView === 'trash'
                          ? 'Restaure um posto antes de editar.'
                          : undefined
                    }
                  >
                    <Plus className="w-4 h-4" />
                    Novo Posto
                  </button>
                </div>
              </div>

              <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="text-xs text-slate-300">
                  <span className="font-black text-white">Postos/Próprios</span>
                  <span className="text-slate-500"> • </span>
                  <span className="text-slate-300">
                    Ativos: <span className="font-black text-white">{activeProperties.length}</span>
                    <span className="text-slate-500"> • </span>
                    Lixeira: <span className="font-black text-white">{trashedProperties.length}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isMasterAdmin && (
                    <label
                      className={[
                        'inline-flex items-center gap-2 px-3 py-2 text-xs font-black rounded-xl bg-slate-900/60 border border-slate-700 text-white select-none',
                        visibleProperties.length === 0 ? 'opacity-60' : '',
                      ].join(' ')}
                      title="Marcar/desmarcar todos (visíveis)"
                    >
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        className="w-4 h-4 accent-amber-500"
                        disabled={visibleProperties.length === 0}
                        checked={allVisiblePropertiesSelected}
                        onChange={(e) => {
                          if (e.target.checked) selectAllVisibleProperties();
                          else clearPropertySelection();
                        }}
                        aria-label="Marcar todos os postos visíveis"
                      />
                      Marcar todos ({selectedPropertyIds.size})
                    </label>
                  )}

                  {propertiesView === 'active' ? (
                    <>
                      <button
                        type="button"
                        className="px-3 py-2 text-xs font-black rounded-xl bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                        disabled={!isMasterAdmin || selectedPropertyIds.size === 0}
                        onClick={() => bulkTrashProperties(Array.from(selectedPropertyIds), `${selectedPropertyIds.size} selecionado(s)`)}
                        title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Mover selecionados para lixeira'}
                      >
                        <Trash2 className="w-4 h-4 inline-block -mt-0.5 mr-2" />
                        Excluir selecionados
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="px-3 py-2 text-xs font-black rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                        disabled={!isMasterAdmin || selectedPropertyIds.size === 0}
                        onClick={() => bulkRestoreProperties(Array.from(selectedPropertyIds), `${selectedPropertyIds.size} selecionado(s)`)}
                        title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Restaurar selecionados'}
                      >
                        <Unlock className="w-4 h-4 inline-block -mt-0.5 mr-2" />
                        Restaurar
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 text-xs font-black rounded-xl bg-red-700 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                        disabled={!isMasterAdmin || selectedPropertyIds.size === 0}
                        onClick={() => bulkPurgeProperties(Array.from(selectedPropertyIds), `${selectedPropertyIds.size} selecionado(s)`)}
                        title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Excluir definitivamente selecionados'}
                      >
                        <Trash2 className="w-4 h-4 inline-block -mt-0.5 mr-2" />
                        Excluir definitivo
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 text-xs font-black rounded-xl bg-red-700/20 border border-red-600/40 text-red-200 hover:bg-red-700/30 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                        disabled={!isMasterAdmin || visibleProperties.length === 0}
                        onClick={() => bulkPurgeProperties(visibleProperties.map((p) => p.id), 'TODOS os postos da Lixeira (visíveis)')}
                        title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Purge de todos visíveis na lixeira'}
                      >
                        <Trash2 className="w-4 h-4 inline-block -mt-0.5 mr-2" />
                        Purge de todos
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-4">
                {visibleProperties
                  .filter(p => (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((prop) => (
                  <div key={prop.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {isMasterAdmin && (
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-amber-500"
                            checked={selectedPropertyIds.has(prop.id)}
                            onChange={(e) => togglePropertySelection(prop.id, e.target.checked)}
                            aria-label={`Selecionar ${prop.name}`}
                          />
                        </label>
                      )}
                      <div className="p-3 bg-blue-500/10 rounded-xl">
                        <MapPin className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white">{prop.name}</h3>
                        <p className="text-xs text-slate-400">{prop.category} • {prop.address}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">{prop.plusCode}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {propertiesView === 'active' ? (
                        <>
                          <button 
                            onClick={() => { setEditingProperty(prop); setShowPropertyModal(true); }}
                            className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            disabled={!isMasterAdmin}
                            title={!isMasterAdmin ? 'Apenas o ADMIN MASTER pode editar postos.' : 'Editar posto'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteProperty(prop)}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            disabled={!isMasterAdmin}
                            title={!isMasterAdmin ? 'Apenas o ADMIN MASTER pode excluir postos.' : 'Mover para Lixeira'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRestoreProperty(prop)}
                            className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            disabled={!isMasterAdmin}
                            title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Restaurar'}
                          >
                            <Unlock className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handlePurgeProperty(prop)}
                            className="p-2 text-slate-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            disabled={!isMasterAdmin}
                            title={!isMasterAdmin ? 'Somente ADM MASTER' : 'Excluir definitivamente'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'vehicles' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    placeholder="Buscar viaturas..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => { setEditingVehicle(null); setShowVehicleModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Nova Viatura
                </button>
              </div>

              <div className="grid gap-4">
                {vehicles.filter(v => v.prefix.toLowerCase().includes(searchTerm.toLowerCase())).map((v) => (
                  <div key={v.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-slate-700 rounded-xl">
                        <Truck className="w-6 h-6 text-slate-300" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white">{v.prefix}</h3>
                        <p className="text-xs text-slate-400">{v.model} • {v.plate} • {v.type}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase mt-1 inline-block ${
                          v.status === 'Em serviço' ? 'bg-emerald-500/20 text-emerald-400' :
                          v.status === 'Em manutenção' ? 'bg-red-500/20 text-red-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {v.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => { setEditingVehicle(v); setShowVehicleModal(true); }}
                        className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteVehicle(v)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'teams' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    placeholder="Buscar equipes..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => { setEditingTeam(null); setShowTeamModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Nova Equipe
                </button>
              </div>

              <div className="grid gap-4">
                {teams.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())).map((t) => (
                  <div key={t.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-purple-500/10 rounded-xl">
                        <Users className="w-6 h-6 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white">{t.name}</h3>
                        <p className="text-xs text-slate-400">{t.shift} • Viatura: {t.vehiclePrefix}</p>
                        <p className="text-[10px] text-slate-500 mt-1">Enc: {t.inCharge} • Cond: {t.driver}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => { setEditingTeam(t); setShowTeamModal(true); }}
                        className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteTeam(t)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modals */}
        <AnimatePresence>
          {showPropertyModal && (
            <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-800 w-full max-w-md rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700 overflow-hidden max-h-[90vh] overflow-y-auto"
              >
                <div className="p-6 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{editingProperty ? 'Editar Posto' : 'Novo Posto'}</h3>
                  <button onClick={() => setShowPropertyModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSaveProperty} className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome do Próprio/Posto</label>
                    <input name="name" defaultValue={editingProperty?.name} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: Prefeitura Municipal" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Categoria</label>
                    <select name="category" defaultValue={editingProperty?.category || 'Administrativo'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                      <option value="Administrativo">Administrativo</option>
                      <option value="Saúde">Saúde</option>
                      <option value="Educação">Educação</option>
                      <option value="Lazer">Lazer</option>
                      <option value="Segurança">Segurança</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Endereço</label>
                    <input name="address" defaultValue={editingProperty?.address} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Rua..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Latitude</label>
                      <input name="latitude" type="number" step="any" defaultValue={editingProperty?.latitude} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Longitude</label>
                      <input name="longitude" type="number" step="any" defaultValue={editingProperty?.longitude} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Plus Code</label>
                    <input name="plusCode" defaultValue={editingProperty?.plusCode} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: 87H7XQ8P+XQ" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Raio antifraude GPS (m)
                    </label>
                    <input
                      name="validationRadiusMeters"
                      type="number"
                      min={10}
                      max={5000}
                      step={1}
                      defaultValue={
                        editingProperty?.validationRadiusMeters != null
                          ? editingProperty.validationRadiusMeters
                          : ''
                      }
                      placeholder="50 (padrão se vazio)"
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Distância máxima entre o GPS do agente e o posto para marcar a ronda como válida. Acima disso grava como FORA_DO_RAIO (auditoria).
                    </p>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowPropertyModal(false)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">Cancelar</button>
                    <button type="submit" className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-colors">Salvar</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showVehicleModal && (
            <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-800 w-full max-w-md rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700 overflow-hidden max-h-[90vh] overflow-y-auto"
              >
                <div className="p-6 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{editingVehicle ? 'Editar Viatura' : 'Nova Viatura'}</h3>
                  <button onClick={() => setShowVehicleModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSaveVehicle} className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Prefixo</label>
                    <input name="prefix" defaultValue={editingVehicle?.prefix} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: V-101" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Modelo</label>
                    <input name="model" defaultValue={editingVehicle?.model} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: Toyota Hilux" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Placa</label>
                      <input name="plate" defaultValue={editingVehicle?.plate} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="ABC-1234" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo</label>
                      <select name="type" defaultValue={editingVehicle?.type || '4x4'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                        <option value="4x4">4x4</option>
                        <option value="Sedan">Sedan</option>
                        <option value="SUV">SUV</option>
                        <option value="Moto">Moto</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status</label>
                    <select name="status" defaultValue={editingVehicle?.status || 'Em serviço'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                      <option value="Em serviço">Em serviço</option>
                      <option value="Em manutenção">Em manutenção</option>
                      <option value="Reserva">Reserva</option>
                    </select>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowVehicleModal(false)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">Cancelar</button>
                    <button type="submit" className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-colors">Salvar</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showTeamModal && (
            <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-800 w-full max-w-md rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700 overflow-hidden max-h-[90vh] overflow-y-auto"
              >
                <div className="p-6 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{editingTeam ? 'Editar Equipe' : 'Nova Equipe'}</h3>
                  <button onClick={() => setShowTeamModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSaveTeam} className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome da Equipe</label>
                    <input name="name" defaultValue={editingTeam?.name} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: ROMU 01" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Turno</label>
                      <select name="shift" defaultValue={editingTeam?.shift || 'Diurno'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                        <option value="Diurno">Diurno (06:00–18:00)</option>
                        <option value="Intermediário">Intermediário (14:00–02:00)</option>
                        <option value="Noturno">Noturno (18:00–06:00)</option>
                        <option value="12x36">12x36</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Prefixo Viatura</label>
                      <input name="vehiclePrefix" defaultValue={editingTeam?.vehiclePrefix} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: V-101" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Encarregado</label>
                    <input name="inCharge" defaultValue={editingTeam?.inCharge} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Nome do encarregado" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Condutor</label>
                    <input name="driver" defaultValue={editingTeam?.driver} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Nome do condutor" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Membros (separados por vírgula)</label>
                    <textarea name="members" defaultValue={editingTeam?.members?.join(', ') || ''} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none h-20" placeholder="Membro 1, Membro 2..." />
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowTeamModal(false)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">Cancelar</button>
                    <button type="submit" className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-colors">Salvar</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
