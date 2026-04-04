import React, { useState, useEffect } from 'react';
import { 
  Users, 
  MapPin, 
  Truck, 
  History, 
  Shield, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Lock, 
  Unlock,
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
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, PublicProperty, Team, Vehicle, AuditLog, UserStatus, UserRole } from '../types';
import { format } from 'date-fns';

interface AdminPanelProps {
  profile: UserProfile;
  onClose: () => void;
  logAdminAction: (admin: UserProfile, action: string, details: string, targetId?: string, targetType?: 'user' | 'property' | 'vehicle' | 'team') => Promise<void>;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ profile, onClose, logAdminAction }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'properties' | 'vehicles' | 'teams' | 'logs'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<UserStatus | 'ALL'>('ALL');
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PublicProperty | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

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
        await updateDoc(doc(db, 'vehicles', editingVehicle.id), vehicleData);
        await logAdminAction(profile, 'EDIÇÃO DE VIATURA', `Viatura ${vehicleData.prefix} editada.`, editingVehicle.id, 'vehicle');
      } else {
        const docRef = await addDoc(collection(db, 'vehicles'), vehicleData);
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
        await updateDoc(doc(db, 'teams', editingTeam.id), teamData);
        await logAdminAction(profile, 'EDIÇÃO DE EQUIPE', `Equipe ${teamData.name} editada.`, editingTeam.id, 'team');
      } else {
        const docRef = await addDoc(collection(db, 'teams'), teamData);
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
    const propData = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      address: formData.get('address') as string,
      latitude: Number(formData.get('latitude')),
      longitude: Number(formData.get('longitude')),
      plusCode: formData.get('plusCode') as string,
      qrCode: formData.get('qrCode') as string || `GCM-${Date.now()}`,
      status: 'operational' as const
    };

    try {
      if (editingProperty) {
        await updateDoc(doc(db, 'properties', editingProperty.id), propData);
        await logAdminAction(profile, 'EDIÇÃO DE POSTO', `Posto ${propData.name} editado.`, editingProperty.id, 'property');
      } else {
        const docRef = await addDoc(collection(db, 'properties'), propData);
        await logAdminAction(profile, 'CRIAÇÃO DE POSTO', `Posto ${propData.name} criado.`, docRef.id, 'property');
      }
      setShowPropertyModal(false);
      setEditingProperty(null);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar posto');
    }
  };

  const handleDeleteProperty = async (prop: PublicProperty) => {
    if (!window.confirm(`Tem certeza que deseja excluir o posto ${prop.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'properties', prop.id));
      await logAdminAction(profile, 'EXCLUSÃO DE POSTO', `Posto ${prop.name} excluído.`, prop.id, 'property');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir posto');
    }
  };

  const handleSaveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const userData = {
      name: formData.get('name') as string,
      registration: formData.get('registration') as string,
      role: formData.get('role') as UserRole,
      status: formData.get('status') as UserStatus,
      email: formData.get('email') as string,
    };

    try {
      if (editingUser) {
        await updateDoc(doc(db, 'users', editingUser.uid), userData);
        await logAdminAction(profile, 'EDIÇÃO DE USUÁRIO', `Usuário ${userData.name} editado.`, editingUser.uid, 'user');
      } else {
        // For new users created by admin, we might need to handle auth creation too, 
        // but for now we'll just create the profile. 
        // In a real app, this would trigger a cloud function or similar.
        const newUid = `manual_${Date.now()}`;
        await setDoc(doc(db, 'users', newUid), { ...userData, uid: newUid, createdAt: new Date().toISOString() });
        await logAdminAction(profile, 'CRIAÇÃO DE USUÁRIO', `Usuário ${userData.name} criado manualmente.`, newUid, 'user');
      }
      setShowUserModal(false);
      setEditingUser(null);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar usuário');
    }
  };

  useEffect(() => {
    setLoading(true);
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ ...d.data() as UserProfile, uid: d.id })));
    });
    const unsubProperties = onSnapshot(collection(db, 'properties'), (snap) => {
      setProperties(snap.docs.map(d => ({ ...d.data() as PublicProperty, id: d.id })));
    });
    const unsubVehicles = onSnapshot(collection(db, 'vehicles'), (snap) => {
      setVehicles(snap.docs.map(d => ({ ...d.data() as Vehicle, id: d.id })));
    });
    const unsubTeams = onSnapshot(collection(db, 'teams'), (snap) => {
      setTeams(snap.docs.map(d => ({ ...d.data() as Team, id: d.id })));
    });
    const unsubLogs = onSnapshot(query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100)), (snap) => {
      setLogs(snap.docs.map(d => ({ ...d.data() as AuditLog, id: d.id })));
      setLoading(false);
    });

    return () => {
      unsubUsers();
      unsubProperties();
      unsubVehicles();
      unsubTeams();
      unsubLogs();
    };
  }, []);

  const handleUserStatus = async (user: UserProfile, newStatus: UserStatus) => {
    try {
      await updateDoc(doc(db, 'users', user.uid), { status: newStatus });
      await logAdminAction(profile, 'ALTERAÇÃO DE STATUS', `Usuário ${user.name} alterado para ${newStatus}`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar status');
    }
  };

  const handleUserRole = async (user: UserProfile, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', user.uid), { role: newRole });
      await logAdminAction(profile, 'ALTERAÇÃO DE PERFIL', `Usuário ${user.name} alterado para ${newRole}`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar perfil');
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário ${user.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
      await logAdminAction(profile, 'EXCLUSÃO DE USUÁRIO', `Usuário ${user.name} excluído do sistema.`, user.uid, 'user');
    } catch (err) {
      console.error(err);
      alert('Erro ao excluir usuário');
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         u.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'ALL' || u.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-xl">
              <Shield className="w-6 h-6 text-amber-500" />
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
            { id: 'logs', label: 'Auditoria', icon: History },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'text-amber-500 border-amber-500 bg-amber-500/5' 
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-900/50">
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
                    <option value="PENDENTE">Pendentes</option>
                    <option value="ATIVO">Ativos</option>
                    <option value="BLOQUEADO">Bloqueados</option>
                  </select>
                  <button 
                    onClick={() => { setEditingUser(null); setShowUserModal(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-colors ml-2"
                  >
                    <Plus className="w-4 h-4" />
                    Novo Usuário
                  </button>
                </div>
              </div>

              <div className="grid gap-4">
                {filteredUsers.map((user) => (
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

                    <div className="flex items-center gap-2 flex-wrap">
                      {user.status === 'PENDENTE' && (
                        <button 
                          onClick={() => handleUserStatus(user, 'ATIVO')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Aprovar
                        </button>
                      )}
                      
                      {user.status === 'ATIVO' ? (
                        <button 
                          onClick={() => handleUserStatus(user, 'BLOQUEADO')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Bloquear
                        </button>
                      ) : user.status === 'BLOQUEADO' ? (
                        <button 
                          onClick={() => handleUserStatus(user, 'ATIVO')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          Desbloquear
                        </button>
                      ) : null}

                      <select 
                        className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                        value={user.role}
                        onChange={(e) => handleUserRole(user, e.target.value as UserRole)}
                      >
                        <option value="agent">Agente</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Administrador</option>
                      </select>

                      <button 
                        onClick={() => { setEditingUser(user); setShowUserModal(true); }}
                        className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>

                      <button 
                        onClick={() => handleDeleteUser(user)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
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
              <div className="bg-slate-800/30 rounded-2xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-sm">
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
                        <td className="px-4 py-3 text-slate-400 text-xs">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                <button 
                  onClick={() => { setEditingProperty(null); setShowPropertyModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Novo Posto
                </button>
              </div>

              <div className="grid gap-4">
                {properties.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map((prop) => (
                  <div key={prop.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
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
                      <button 
                        onClick={() => { setEditingProperty(prop); setShowPropertyModal(true); }}
                        className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteProperty(prop)}
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
          {showUserModal && (
            <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl border border-slate-700 overflow-hidden"
              >
                <div className="p-6 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h3>
                  <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSaveUser} className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome Completo</label>
                    <input name="name" defaultValue={editingUser?.name} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: João Silva" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Matrícula (RE)</label>
                    <input name="registration" defaultValue={editingUser?.registration} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: 12345" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail</label>
                    <input name="email" type="email" defaultValue={editingUser?.email} required className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="nome@gcm.gov.br" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Perfil</label>
                      <select name="role" defaultValue={editingUser?.role || 'agent'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                        <option value="agent">Agente</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status</label>
                      <select name="status" defaultValue={editingUser?.status || 'PENDENTE'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                        <option value="PENDENTE">Pendente</option>
                        <option value="ATIVO">Ativo</option>
                        <option value="BLOQUEADO">Bloqueado</option>
                      </select>
                    </div>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowUserModal(false)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-colors">Cancelar</button>
                    <button type="submit" className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-colors">Salvar</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showPropertyModal && (
            <div className="fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl border border-slate-700 overflow-hidden"
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
                className="bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl border border-slate-700 overflow-hidden"
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
                className="bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl border border-slate-700 overflow-hidden"
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
                      <select name="shift" defaultValue={editingTeam?.shift || 'Manhã'} className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none">
                        <option value="Manhã">Manhã</option>
                        <option value="Tarde">Tarde</option>
                        <option value="Noite">Noite</option>
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
