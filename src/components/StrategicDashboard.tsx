import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
  MapPin, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  AlertTriangle, 
  Users, 
  CarFront, 
  Activity,
  Zap,
  Target,
  BarChart3,
  PieChart as PieChartIcon,
  LayoutDashboard,
  Monitor
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { cn } from '../lib/utils';
import { 
  UserProfile, 
  PublicProperty, 
  PatrolRecord, 
  OccurrenceRecord, 
  Team, 
  Vehicle, 
  VehicleLocation, 
  OperationalAlert,
  Geofence
} from '../types';
import { MapComponent } from './PatrolMap';

interface StrategicDashboardProps {
  profile: UserProfile;
  properties: PublicProperty[];
  patrols: PatrolRecord[];
  occurrences: OccurrenceRecord[];
  teams: Team[];
  vehicles: Vehicle[];
  vehicleLocations: VehicleLocation[];
  alerts: OperationalAlert[];
  geofences: Geofence[];
  onGenerateReport?: () => void;
  onResolveAlert?: (alertId: string) => void;
  onTriggerAlert?: (alert: Omit<OperationalAlert, 'id' | 'resolved' | 'timestamp'>) => void;
}

export const StrategicDashboard: React.FC<StrategicDashboardProps> = ({
  properties,
  patrols,
  occurrences,
  teams,
  vehicles,
  vehicleLocations,
  alerts,
  geofences,
  onGenerateReport,
  onResolveAlert,
  onTriggerAlert
}) => {
  const [showNewAlertModal, setShowNewAlertModal] = React.useState(false);
  const [newAlert, setNewAlert] = React.useState<Omit<OperationalAlert, 'id' | 'resolved' | 'timestamp'>>({
    title: '',
    message: '',
    severity: 'medium',
    type: 'security'
  });
  // Stats calculations
  const stats = useMemo(() => {
    const total = properties.length;
    const visitedToday = properties.filter(p => 
      patrols.some(pat => pat.propertyId === p.id && new Date(pat.timestamp).toDateString() === new Date().toDateString())
    ).length;
    const pending = total - visitedToday;
    const coverage = total > 0 ? Math.round((visitedToday / total) * 100) : 0;
    
    const activeVehicles = vehicleLocations.filter(v => v.status !== 'offline').length;
    const activeTeams = teams.filter(t => t.active).length;
    
    const unresolvedAlerts = alerts.filter(a => !a.resolved).length;
    const criticalAlerts = alerts.filter(a => !a.resolved && a.severity === 'critical').length;

    return {
      total,
      visitedToday,
      pending,
      coverage,
      activeVehicles,
      activeTeams,
      unresolvedAlerts,
      criticalAlerts
    };
  }, [properties, patrols, vehicleLocations, teams, alerts]);

  // Chart data: Rounds per day (last 7 days)
  const roundsPerDayData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toDateString();
    }).reverse();

    return last7Days.map(day => {
      const count = patrols.filter(p => new Date(p.timestamp).toDateString() === day).length;
      return {
        name: new Date(day).toLocaleDateString('pt-BR', { weekday: 'short' }),
        rondas: count
      };
    });
  }, [patrols]);

  // Chart data: Occurrences by type
  const occurrenceTypeData = useMemo(() => {
    const types: Record<string, number> = {};
    occurrences.forEach(occ => {
      types[occ.type] = (types[occ.type] || 0) + 1;
    });
    return Object.entries(types).map(([name, value]) => ({ name, value }));
  }, [occurrences]);

  const COLORS = ['#0f2c63', '#1e8e3e', '#f9ab00', '#d93025', '#081a3a', '#266abf'];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-3 sm:p-6 space-y-4 sm:space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4 sm:pb-6 gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
            <Monitor className="w-8 h-8 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-white">Centro de Comando e Controle</h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Monitoramento Estratégico em Tempo Real
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6">
          <div className="text-left sm:text-right">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status Global</p>
            <p className="text-sm font-black text-green-400 uppercase">Operacional</p>
          </div>
          <div className="h-10 w-px bg-slate-800" />
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Alertas Críticos</p>
            <p className={cn("text-sm font-black uppercase", stats.criticalAlerts > 0 ? "text-red-500 animate-pulse" : "text-slate-400")}>
              {stats.criticalAlerts} Ativos
            </p>
          </div>
          {onTriggerAlert && (
            <button 
              onClick={() => setShowNewAlertModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-red-600/20"
            >
              <Zap className="w-4 h-4" />
              Novo Alerta
            </button>
          )}
          {onGenerateReport && (
            <button 
              onClick={onGenerateReport}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-600/20"
            >
              <BarChart3 className="w-4 h-4" />
              Relatório PDF
            </button>
          )}
        </div>
      </div>

      {/* Top Indicators Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <IndicatorCard 
          icon={Target} 
          label="Cobertura Operacional" 
          value={`${stats.coverage}%`} 
          subValue={`${stats.visitedToday} de ${stats.total} postos`}
          color="blue"
          progress={stats.coverage}
        />
        <IndicatorCard 
          icon={CarFront} 
          label="Viaturas em Campo" 
          value={stats.activeVehicles.toString()} 
          subValue={`${stats.activeTeams} equipes ativas`}
          color="emerald"
        />
        <IndicatorCard 
          icon={AlertTriangle} 
          label="Alertas Pendentes" 
          value={stats.unresolvedAlerts.toString()} 
          subValue={`${stats.criticalAlerts} de alta prioridade`}
          color="amber"
          alert={stats.criticalAlerts > 0}
        />
        <IndicatorCard 
          icon={Activity} 
          label="Tempo de Resposta" 
          value="12m" 
          subValue="Média dos últimos 60min"
          color="indigo"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Map & Charts */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Tactical Map */}
          <Card title="Mapa Tático Operacional" icon={MapPin}>
            <div className="h-[500px] w-full rounded-2xl overflow-hidden border border-slate-800 relative">
              <MapComponent 
                properties={properties}
                patrols={patrols}
                occurrences={occurrences}
                vehicleLocations={vehicleLocations}
                geofences={geofences}
                dark={true}
              />
            </div>
          </Card>

          {/* Rounds Chart */}
          <Card title="Volume de Rondas (7 Dias)" icon={TrendingUp}>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={roundsPerDayData}>
                  <defs>
                    <linearGradient id="colorRondas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="rondas" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorRondas)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Occurrence Pie Chart */}
            <Card title="Distribuição de Ocorrências" icon={PieChartIcon}>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={occurrenceTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {occurrenceTypeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4 justify-center mt-2">
                {occurrenceTypeData.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">{entry.name}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent Alerts List */}
            <Card title="Alertas Operacionais" icon={Zap}>
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2 scrollbar-hide">
                {alerts.filter(a => !a.resolved).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <CheckCircle2 className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-xs font-bold uppercase tracking-widest">Nenhum alerta ativo</p>
                  </div>
                ) : (
                  alerts.filter(a => !a.resolved).map((alert, i) => (
                    <div key={i} className={cn(
                      "p-3 rounded-xl border flex items-start gap-3 transition-all hover:translate-x-1",
                      alert.severity === 'critical' ? "bg-red-500/10 border-red-500/20" : "bg-slate-900 border-slate-800"
                    )}>
                      <div className={cn(
                        "p-2 rounded-lg",
                        alert.severity === 'critical' ? "bg-red-500 text-white" : "bg-slate-800 text-slate-400"
                      )}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="text-xs font-black text-white uppercase">{alert.title}</h5>
                          <span className="text-[8px] font-bold text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight mb-2">{alert.message}</p>
                        {onResolveAlert && (
                          <button 
                            onClick={() => onResolveAlert(alert.id)}
                            className="text-[8px] font-black uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Marcar como Resolvido
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Right Column: Status & Map Summary */}
        <div className="space-y-6">
          
          {/* Active Teams Status */}
          <Card title="Status das Equipes" icon={Users}>
            <div className="space-y-4 max-h-[660px] overflow-y-auto pr-2 scrollbar-hide">
              {vehicleLocations.filter(v => v.status !== 'offline').map((loc, i) => (
                <div key={i} className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400 border border-blue-500/20">
                        <CarFront className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-sm font-black text-white leading-none mb-1">{loc.vehiclePrefix}</h5>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{loc.teamName}</p>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest",
                      loc.status === 'patrolling' ? "bg-green-500/20 text-green-400" :
                      loc.status === 'moving' ? "bg-blue-500/20 text-blue-400" :
                      "bg-red-500/20 text-red-400"
                    )}>
                      {loc.status === 'patrolling' ? 'Patrulhando' : 
                       loc.status === 'moving' ? 'Deslocando' : 'Ocorrência'}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-slate-950 rounded-lg">
                      <p className="text-[8px] font-bold text-slate-600 uppercase mb-0.5">Velocidade</p>
                      <p className="text-xs font-black text-white">{loc.speed} km/h</p>
                    </div>
                    <div className="p-2 bg-slate-950 rounded-lg">
                      <p className="text-[8px] font-bold text-slate-600 uppercase mb-0.5">Tempo Parado</p>
                      <p className="text-xs font-black text-white">{loc.idleTimeMinutes} min</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex -space-x-2">
                      {[loc.driver, loc.inCharge].map((name, idx) => (
                        <div key={idx} className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold text-slate-400 uppercase" title={name}>
                          {name[0]}
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-slate-500 font-medium truncate">
                      {loc.driver} • {loc.inCharge}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* New Alert Modal */}
          {showNewAlertModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="bg-red-600 p-6 text-white">
                  <h3 className="text-xl font-black uppercase tracking-tighter">Emitir Alerta Operacional</h3>
                  <p className="text-red-200 text-[10px] font-bold uppercase tracking-widest">CCC - Centro de Comando e Controle</p>
                </div>
                <div className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Título do Alerta</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white outline-none focus:ring-2 focus:ring-red-500/20"
                      placeholder="Ex: Ocorrência em Andamento"
                      value={newAlert.title}
                      onChange={(e) => setNewAlert({ ...newAlert, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mensagem</label>
                    <textarea 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white outline-none focus:ring-2 focus:ring-red-500/20 h-24 resize-none"
                      placeholder="Descreva a situação..."
                      value={newAlert.message}
                      onChange={(e) => setNewAlert({ ...newAlert, message: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gravidade</label>
                      <select 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white outline-none"
                        value={newAlert.severity}
                        onChange={(e) => setNewAlert({ ...newAlert, severity: e.target.value as any })}
                      >
                        <option value="low">Baixa</option>
                        <option value="medium">Média</option>
                        <option value="high">Alta</option>
                        <option value="critical">Crítica</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tipo</label>
                      <select 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white outline-none"
                        value={newAlert.type}
                        onChange={(e) => setNewAlert({ ...newAlert, type: e.target.value as any })}
                      >
                        <option value="security">Segurança</option>
                        <option value="geofence">Geofence</option>
                        <option value="idle">Inatividade</option>
                        <option value="radius">Raio de Ação</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setShowNewAlertModal(false)}
                      className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={() => {
                        onTriggerAlert?.(newAlert);
                        setShowNewAlertModal(false);
                        setNewAlert({ title: '', message: '', severity: 'medium', type: 'security' });
                      }}
                      className="flex-1 py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-red-600/20"
                    >
                      Emitir Alerta
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface IndicatorCardProps {
  icon: any;
  label: string;
  value: string;
  subValue: string;
  color: 'blue' | 'emerald' | 'amber' | 'indigo';
  progress?: number;
  alert?: boolean;
}

const IndicatorCard: React.FC<IndicatorCardProps> = ({ icon: Icon, label, value, subValue, color, progress, alert }) => {
  const colors = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
  };

  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className={cn(
        "p-5 rounded-[2rem] border bg-slate-900/50 backdrop-blur-xl relative overflow-hidden group transition-all",
        alert ? "border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)]" : "border-slate-800"
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("p-3 rounded-2xl border", colors[color])}>
          <Icon className="w-6 h-6" />
        </div>
        {progress !== undefined && (
          <div className="w-12 h-12 relative flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-800" />
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={125.6} strokeDashoffset={125.6 * (1 - progress / 100)} className={colors[color].split(' ')[0]} />
            </svg>
            <span className="absolute text-[10px] font-black">{progress}%</span>
          </div>
        )}
      </div>
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
        <h3 className="text-3xl font-black text-white tracking-tighter leading-none mb-2">{value}</h3>
        <p className="text-xs text-slate-400 font-medium">{subValue}</p>
      </div>
      
      {/* Decorative background glow */}
      <div className={cn(
        "absolute -bottom-12 -right-12 w-32 h-32 blur-[60px] opacity-20 transition-opacity group-hover:opacity-40",
        color === 'blue' ? "bg-blue-500" : color === 'emerald' ? "bg-emerald-500" : color === 'amber' ? "bg-amber-500" : "bg-indigo-500"
      )} />
    </motion.div>
  );
};

const Card: React.FC<{ title: string; icon: any; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-[2rem] p-6 shadow-2xl">
    <div className="flex items-center gap-3 mb-6">
      <div className="p-2 bg-slate-800 rounded-xl text-slate-400">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-black text-white uppercase tracking-widest">{title}</h4>
    </div>
    {children}
  </div>
);
