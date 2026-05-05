import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, Polyline, Polygon } from 'react-leaflet';
import L from 'leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { format, isToday } from 'date-fns';
import { 
  MapPin, AlertTriangle, Info, Navigation, Search, X, 
  Maximize2, Globe, Crosshair, Layers, ChevronLeft, ChevronRight, 
  ZoomIn, Plus, Minus, CheckCircle2, Clock, Users, PlayCircle,
  TrendingUp, Activity, LayoutDashboard, CarFront, ChevronUp, ChevronDown
} from 'lucide-react';
import { PatrolRecord, OccurrenceRecord, PublicProperty, VehicleLocation, Geofence, OperationalAlert } from '../types';
import { cn } from '../lib/utils';
import appLogo from '../assets/sigma-brand.png';

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface PatrolMapProps {
  patrols: PatrolRecord[];
  occurrences: OccurrenceRecord[];
  properties: PublicProperty[];
  vehicleLocations?: VehicleLocation[];
  geofences?: Geofence[];
  onStartPatrol?: (property: PublicProperty) => void;
  userRole?: string;
  onCenterVehicle?: (vehicleId: string) => void;
  dark?: boolean;
}

const defaultCenter: [number, number] = [-23.5042, -47.4831];

const Badge = ({ children, variant = 'info', className }: { children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'outline'; className?: string }) => {
  const variants = {
    success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    outline: 'border border-current bg-transparent'
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', variants[variant as keyof typeof variants], className)}>
      {children}
    </span>
  );
};

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

// GCM Institutional Icons
const createGCMIcon = (status?: string, visitCount: number = 0) => {
  const isVisited = status === 'visited';
  const isOccurrence = status === 'occurrence';
  
  const badgeColor = isVisited ? '#10b981' : '#ef4444';
  const badgeIcon = isVisited ? 
    '<path d="M20 6L9 17l-5-5" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : 
    '<path d="M12 8v4m0 4h.01" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

  const countBadge =
    visitCount > 1
      ? `<div style="position:absolute; top:-4px; left:-4px; background:#f59e0b; color:white; border-radius:9999px; min-width:20px; height:20px; padding:0 6px; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; box-shadow:0 2px 4px rgba(0,0,0,0.3); z-index:11;">
           ${visitCount}
         </div>`
      : '';

  const gradId = `gcm-shield-grad-${Math.random().toString(36).slice(2, 11)}`;

  return L.divIcon({
    html: `<div class="relative" style="width: 42px; height: 48px;">
            <!-- Marca SIGMA (escudo institucional) -->
            <svg width="40" height="48" viewBox="0 0 40 48" style="display:block;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.45));" aria-hidden="true">
              <defs>
                <linearGradient id="${gradId}" x1="20" y1="2" x2="20" y2="44" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#0f3d73"/>
                  <stop offset="100%" stop-color="#041526"/>
                </linearGradient>
              </defs>
              <path d="M20 2 L36 10 L36 26 C36 34 28 42 20 46 C12 42 4 34 4 26 L4 10 Z" fill="url(#${gradId})" stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linejoin="round"/>
              <text x="20" y="24" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="900" font-family="system-ui,Segoe UI,sans-serif">Σ</text>
              <text x="20" y="34" text-anchor="middle" fill="#ffffff" font-size="7.5" font-weight="800" font-family="system-ui,Segoe UI,sans-serif" opacity="0.9">GCM</text>
            </svg>
            ${countBadge}
            <!-- Status Badge -->
            <div style="position: absolute; top: 2px; right: -4px; background: ${badgeColor}; border-radius: 50%; width: 20px; height: 20px; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                ${badgeIcon}
              </svg>
            </div>
          </div>`,
    className: 'gcm-custom-icon',
    iconSize: [42, 48],
    iconAnchor: [21, 48],
    popupAnchor: [0, -48]
  });
};

const createVehicleIcon = (loc: VehicleLocation) => {
  const statusColors = {
    patrolling: '#10b981', // Green
    moving: '#3b82f6',    // Blue
    occurrence: '#ef4444', // Red
    offline: '#64748b'     // Slate
  };
  const color = statusColors[loc.status] || statusColors.offline;

  return L.divIcon({
    html: `<div class="relative" style="width: 60px; height: 40px;">
            <div class="absolute inset-0 rounded-full animate-ping opacity-20" style="background: ${color}; margin: 4px;"></div>
            <svg width="60" height="40" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4)); position: relative; z-index: 2;">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9C2.1 11.1 2 11.5 2 12v4c0 .6.4 1 1 1h2"/>
              <circle cx="7" cy="17" r="2"/>
              <path d="M9 17h6"/>
              <circle cx="17" cy="17" r="2"/>
            </svg>
            <div style="position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: ${color}; color: white; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 900; border: 1.5px solid white; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 3; text-transform: uppercase;">
              ${loc.vehiclePrefix}
            </div>
          </div>`,
    className: 'vehicle-icon',
    iconSize: [60, 40],
    iconAnchor: [30, 20],
    popupAnchor: [0, -20]
  });
};

const createClusterIcon = (cluster: any) => {
  const count = cluster.getChildCount();
  return L.divIcon({
    html: `<div class="flex items-center justify-center bg-blue-900 border-4 border-white text-white font-black rounded-full shadow-2xl" style="width: 44px; height: 44px; font-size: 16px;">
            ${count}
          </div>`,
    className: 'custom-marker-cluster',
    iconSize: L.point(44, 44)
  });
};

const propertyIconSVG = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>';
const occurrenceIconSVG = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>';
const userLocationIconSVG = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="white"/>';

const MapInvalidator = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
};

export const PatrolMap: React.FC<PatrolMapProps> = ({ 
  patrols, 
  occurrences, 
  properties, 
  vehicleLocations = [], 
  geofences = [], 
  onStartPatrol, 
  userRole,
  onCenterVehicle,
  dark = false
}) => {
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(max-width: 640px)')?.matches ?? false;
  }, []);

  const [filter, setFilter] = useState<'all' | 'visited' | 'not_visited' | 'in_service' | 'occurrence'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(14);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [vehiclePath, setVehiclePath] = useState<[number, number][]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState<boolean>(() => (typeof window === 'undefined' ? false : true));
  const [isMapActionsOpen, setIsMapActionsOpen] = useState(false);

  // Component to sync zoom level
  const ZoomTracker = () => {
    const map = useMap();
    useEffect(() => {
      const handleZoom = () => setZoom(map.getZoom());
      map.on('zoomend', handleZoom);
      return () => map.off('zoomend', handleZoom);
    }, [map]);
    return null;
  };

  // Calculate indicators
  const indicators = useMemo(() => {
    const total = properties.length;
    const visited = properties.filter(p => patrols.some(pat => pat.propertyId === p.id && isToday(new Date(pat.timestamp)))).length;
    const pending = total - visited;
    const coverage = total > 0 ? Math.round((visited / total) * 100) : 0;
    
    return { total, visited, pending, coverage };
  }, [properties, patrols]);

  // Determine property status for filtering and display
  const getPropertyStatus = (prop: PublicProperty): 'all' | 'visited' | 'not_visited' | 'in_service' | 'occurrence' => {
    const hasOccurrence = occurrences.some(o => o.propertyId === prop.id && isToday(new Date(o.timestamp)));
    if (hasOccurrence) return 'occurrence';
    
    const todayPatrols = patrols.filter(p => p.propertyId === prop.id && isToday(new Date(p.timestamp)));
    if (todayPatrols.length > 0) return 'visited';
    
    // For demo/simulation: some could be "in_service" if we had that state
    // For now, let's say if it's not visited but has a very recent patrol (simulated)
    return 'not_visited';
  };

  const filteredProperties = useMemo(() => {
    return properties.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.address.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;
      
      const status = getPropertyStatus(p);
      if (filter === 'all') return true;
      if (filter === 'visited') return status === 'visited';
      if (filter === 'not_visited') return status === 'not_visited';
      if (filter === 'occurrence') return status === 'occurrence';
      // 'in_service' logic could be added if we track active patrols
      return true;
    });
  }, [properties, filter, searchQuery, patrols, occurrences]);

  const center = useMemo((): [number, number] => {
    if (patrols.length > 0) {
      return [patrols[0].latitude, patrols[0].longitude];
    }
    return defaultCenter;
  }, [patrols]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft } = scrollRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - 150 : scrollLeft + 150;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const checkScroll = () => {
      if (scrollRef.current) {
        setShowScrollButtons(scrollRef.current.scrollWidth > scrollRef.current.clientWidth);
      }
    };
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const handleLocateMe = () => {
    if (navigator.geolocation && mapInstance) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation([latitude, longitude]);
        setVehiclePath(prev => [...prev, [latitude, longitude]]);
        mapInstance.flyTo([latitude, longitude], 16);
      }, (err) => {
        console.error("Error getting location", err);
      });
    }
  };

  const handleCenterMap = () => {
    if (mapInstance) {
      mapInstance.flyTo(center, 14);
    }
  };

  const handleFitBounds = () => {
    if (mapInstance) {
      const bounds = L.latLngBounds([]);
      filteredProperties.forEach(pr => bounds.extend([pr.latitude, pr.longitude]));
      
      if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  };

  const toggleFullScreen = () => {
    const element = document.getElementById('map-container');
    if (!element) return;

    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullScreen(true);
    } else {
      document.exitFullscreen();
      setIsFullScreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  useEffect(() => {
    if (mapInstance) {
      mapRef.current = mapInstance;
      
      // Force initial invalidateSize after a short delay to ensure container is ready
      const initialTimer = setTimeout(() => {
        mapInstance.invalidateSize();
      }, 100);

      const handleResize = () => {
        mapInstance.invalidateSize();
      };

      window.addEventListener('resize', handleResize);
      
      const timer = setTimeout(() => {
        mapInstance.invalidateSize();
        if (properties.length > 0 && patrols.length === 0) {
          handleFitBounds();
        }
      }, 500);

      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(initialTimer);
        clearTimeout(timer);
      };
    }
  }, [mapInstance, properties, patrols.length]);

  const handleFilterChange = (newFilter: typeof filter) => {
    setFilter(newFilter);
    
    if (mapInstance) {
      const propsToFit = properties.filter(p => {
        const status = getPropertyStatus(p);
        if (newFilter === 'all') return true;
        if (newFilter === 'visited') return status === 'visited';
        if (newFilter === 'not_visited') return status === 'not_visited';
        if (newFilter === 'occurrence') return status === 'occurrence';
        return true;
      });

      if (propsToFit.length > 0) {
        const bounds = L.latLngBounds([]);
        propsToFit.forEach(pr => bounds.extend([pr.latitude, pr.longitude]));
        if (bounds.isValid()) {
          mapInstance.fitBounds(bounds, { padding: [100, 100], maxZoom: 16 });
        }
      } else {
        handleCenterMap();
      }
    }
  };

  return (
    <div id="map-container" className={cn("w-full h-full relative overflow-hidden bg-slate-50", isFullScreen && "fixed inset-0 z-[9999]")}>
      
      {/* Strategic Indicators Panel - Moved to bottom for better visibility on mobile */}
      <div className={cn("absolute z-[800] max-w-4xl mx-auto", isMobile ? "bottom-20 left-2 right-2" : "bottom-24 left-4 right-4")}>
        {isMobile && (
          <button
            type="button"
            onClick={() => setIsHudCollapsed((v) => !v)}
            className="mb-2 w-full bg-white/90 backdrop-blur-xl border border-white/20 shadow-xl rounded-2xl px-3 py-2 flex items-center justify-between"
            title={isHudCollapsed ? 'Mostrar indicadores' : 'Ocultar indicadores'}
          >
            <div className="flex items-center gap-2">
              <div className="px-2 py-1 rounded-xl bg-slate-900 text-white text-[11px] font-black">
                {indicators.visited}/{indicators.total}
              </div>
              <div className="text-[11px] font-bold text-slate-600">
                Cobertura: <span className="font-black text-slate-900">{indicators.coverage}%</span>
              </div>
            </div>
            {isHudCollapsed ? <ChevronUp className="w-5 h-5 text-slate-700" /> : <ChevronDown className="w-5 h-5 text-slate-700" />}
          </button>
        )}

        {(!isMobile || !isHudCollapsed) && (
          <div className="bg-white/95 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl p-2 flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => handleFilterChange('all')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all active:scale-95 min-w-fit",
                filter === 'all' ? "bg-blue-900 border-blue-900 shadow-lg shadow-blue-900/20" : "bg-blue-50/50 border-blue-100/50 hover:bg-blue-100/50"
              )}
            >
              <div className={cn("p-1.5 rounded-lg", filter === 'all' ? "bg-white text-blue-900" : "bg-blue-900 text-white")}>
                <LayoutDashboard className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <p className={cn("text-[8px] font-bold uppercase tracking-wider", filter === 'all' ? "text-white/60" : "text-blue-900/40")}>Total</p>
                <p className={cn("text-sm font-black leading-none", filter === 'all' ? "text-white" : "text-blue-900")}>{indicators.total}</p>
              </div>
            </button>

            <button 
              onClick={() => handleFilterChange('visited')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all active:scale-95 min-w-fit",
                filter === 'visited' ? "bg-green-600 border-green-600 shadow-lg shadow-green-600/20" : "bg-green-50/50 border-green-100/50 hover:bg-green-100/50"
              )}
            >
              <div className={cn("p-1.5 rounded-lg", filter === 'visited' ? "bg-white text-green-600" : "bg-green-600 text-white")}>
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <p className={cn("text-[8px] font-bold uppercase tracking-wider", filter === 'visited' ? "text-white/60" : "text-green-700/40")}>Visitados</p>
                <p className={cn("text-sm font-black leading-none", filter === 'visited' ? "text-white" : "text-green-700")}>{indicators.visited}</p>
              </div>
            </button>

            <button 
              onClick={() => handleFilterChange('not_visited')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all active:scale-95 min-w-fit",
                filter === 'not_visited' ? "bg-red-600 border-red-600 shadow-lg shadow-red-600/20" : "bg-red-50/50 border-red-100/50 hover:bg-red-100/50"
              )}
            >
              <div className={cn("p-1.5 rounded-lg", filter === 'not_visited' ? "bg-white text-red-600" : "bg-red-600 text-white")}>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <p className={cn("text-[8px] font-bold uppercase tracking-wider", filter === 'not_visited' ? "text-white/60" : "text-red-700/40")}>Pendentes</p>
                <p className={cn("text-sm font-black leading-none", filter === 'not_visited' ? "text-white" : "text-red-700")}>{indicators.pending}</p>
              </div>
            </button>

            <button 
              onClick={() => handleFilterChange('visited')}
              className="flex items-center gap-3 px-4 py-1.5 bg-slate-900 text-white rounded-xl shadow-lg min-w-fit hover:bg-slate-800 transition-all active:scale-95"
            >
              <div className="flex flex-col items-end">
                <p className="text-[8px] font-bold text-white/40 uppercase tracking-wider">Cobertura</p>
                <p className="text-sm font-black leading-none">{indicators.coverage}%</p>
              </div>
              <div className="w-8 h-8 relative flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-white/10" />
                  <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" strokeDasharray={87.92} strokeDashoffset={87.92 * (1 - indicators.coverage / 100)} className="text-blue-400" />
                </svg>
                <TrendingUp className="absolute w-3 h-3 text-blue-400" />
              </div>
            </button>
          </div>
        )}
      </div>

      <MapContainer 
        id="map"
        center={center} 
        zoom={zoom} 
        style={{ height: '100%', width: '100%', zIndex: 1 }}
        zoomControl={false}
        ref={setMapInstance}
      >
        <MapInvalidator />
        <ZoomTracker />

        {mapType === 'street' ? (
          <TileLayer
            attribution={dark ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
            url={dark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
          />
        ) : (
          <TileLayer
            attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}

        {/* Vehicle Path */}
        {vehiclePath.length > 1 && (
          <Polyline positions={vehiclePath} color="#3b82f6" weight={4} opacity={0.6} dashArray="10, 10" />
        )}

        {/* Real-time Vehicle Tracking */}
        {vehicleLocations?.map((loc) => (
          <Marker 
            key={`vehicle-${loc.id}`} 
            position={[loc.latitude, loc.longitude]} 
            icon={createVehicleIcon(loc)}
          >
            <Popup className="gcm-popup">
              <div className="w-64 p-0 overflow-hidden rounded-xl">
                <div className={cn(
                  "p-3 text-white flex items-center justify-between",
                  loc.status === 'patrolling' ? "bg-green-600" :
                  loc.status === 'moving' ? "bg-blue-600" :
                  loc.status === 'occurrence' ? "bg-red-600" : "bg-slate-600"
                )}>
                  <div className="flex items-center gap-2">
                    <CarFront className="w-4 h-4" />
                    <span className="font-bold text-xs uppercase tracking-wider">{loc.vehiclePrefix}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-white/30 text-white">
                    {loc.status === 'patrolling' ? 'Patrulhando' : 
                     loc.status === 'moving' ? 'Deslocando' : 
                     loc.status === 'occurrence' ? 'Ocorrência' : 'Offline'}
                  </Badge>
                </div>
                <div className="p-4 space-y-3 bg-white">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-[9px] font-bold text-gray-400 uppercase">Equipe</p>
                      <p className="text-[11px] font-bold text-gray-700">{loc.teamName}</p>
                    </div>
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-[9px] font-bold text-gray-400 uppercase">Velocidade</p>
                      <p className="text-[11px] font-bold text-gray-700">{loc.speed} km/h</p>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 space-y-1">
                    <p><strong>Encarregado:</strong> {loc.inCharge}</p>
                    <p><strong>Motorista:</strong> {loc.driver}</p>
                    <p><strong>Tempo Parado:</strong> {loc.idleTimeMinutes} min</p>
                  </div>
                  <button 
                    onClick={() => onCenterVehicle?.(loc.vehicleId)}
                    className="w-full py-2 bg-blue-900 text-white rounded-lg text-xs font-bold uppercase"
                  >
                    Centralizar Viatura
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Geofences */}
        {geofences?.map((fence) => (
          <Polygon
            key={`fence-${fence.id}`}
            positions={fence.coordinates}
            pathOptions={{
              color: fence.type === 'critical' ? '#ef4444' : fence.type === 'sensitive' ? '#f59e0b' : '#3b82f6',
              fillColor: fence.type === 'critical' ? '#ef4444' : fence.type === 'sensitive' ? '#f59e0b' : '#3b82f6',
              fillOpacity: 0.1,
              weight: 2,
              dashArray: '5, 5'
            }}
          >
            <Tooltip sticky>{fence.name} ({fence.type})</Tooltip>
          </Polygon>
        ))}

        {/* User Location Marker */}
        {userLocation && (
          <Marker position={userLocation}>
            <Popup>Sua Localização Atual</Popup>
          </Marker>
        )}

        {/* Properties Markers with Clustering */}
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom={true}
          iconCreateFunction={createClusterIcon}
        >
          {filteredProperties.map((prop) => {
            const status = getPropertyStatus(prop);
            const lastPatrol = patrols.find(p => p.propertyId === prop.id);
            // Quantas vezes esse posto foi visitado (dentro do conjunto de patrulhas carregado no mapa).
            // Regra do usuário: se passou mais de uma vez, mostrar o número (2, 3, 4...).
            const visitCount = patrols.filter((p) => p.propertyId === prop.id).length;

            return (
              <Marker
                key={`prop-${prop.id}`}
                position={[prop.latitude, prop.longitude]}
                icon={createGCMIcon(status, visitCount)}
              >
                <Popup className="gcm-popup">
                  <div className="w-64 p-0 overflow-hidden rounded-xl">
                    <div className={cn("p-3 text-white flex items-center justify-between", 
                      status === 'visited' ? "bg-green-600" : 
                      status === 'occurrence' ? "bg-red-600" : "bg-blue-900")}>
                      <div className="flex items-center gap-2">
                        <span className="sigma-brand-frame sigma-brand-frame--sm inline-flex h-7 w-7 flex-shrink-0 ring-1 ring-white/35">
                          <img src={appLogo} alt="" decoding="async" />
                        </span>
                        <span className="font-bold text-xs uppercase tracking-wider">Posto GCM</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-white/30 text-white">
                        {status === 'visited' ? 'VISITADO' : 'PENDENTE'}
                      </Badge>
                    </div>
                    
                    <div className="p-4 space-y-3 bg-white">
                      <div>
                        <h4 className="font-black text-gray-900 text-base leading-tight">{prop.name}</h4>
                        <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" /> {prop.address}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                          <p className="text-[9px] font-bold text-gray-400 uppercase">Última Ronda</p>
                          <p className="text-[11px] font-bold text-gray-700">
                            {lastPatrol ? format(new Date(lastPatrol.timestamp), 'HH:mm') : '--:--'}
                          </p>
                        </div>
                        <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                          <p className="text-[9px] font-bold text-gray-400 uppercase">Equipe</p>
                          <p className="text-[11px] font-bold text-gray-700 truncate">
                            {lastPatrol?.teamName || 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                        <p className="text-[9px] font-bold text-gray-400 uppercase">Visitas (total)</p>
                        <p className="text-[11px] font-bold text-gray-700">
                          {visitCount}
                        </p>
                      </div>

                      {onStartPatrol && (
                        <button 
                          onClick={() => onStartPatrol(prop)}
                          className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
                        >
                          <PlayCircle className="w-4 h-4" />
                          INICIAR RONDA
                        </button>
                      )}
                    </div>
                  </div>
                </Popup>
                {zoom >= 16 && (
                  <Tooltip permanent direction="top" offset={[0, -20]} className="gcm-tooltip">
                    {prop.name}
                  </Tooltip>
                )}
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Search & Filter Overlay */}
      <div className="absolute top-4 left-4 right-4 sm:right-auto sm:w-96 space-y-3 z-[800]">
        <div className="bg-white/95 backdrop-blur-xl p-1.5 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-900/40" />
            <input 
              type="text"
              placeholder="Buscar posto ou endereço..."
              className="w-full bg-transparent py-3 pl-11 pr-4 text-sm font-medium outline-none placeholder:text-gray-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
        
        {/* Horizontal Filters */}
        <div className="relative flex items-center gap-2">
          <div 
            ref={scrollRef}
            className="flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide scroll-smooth w-full"
          >
            {[
              { id: 'all', label: 'Todas', icon: LayoutDashboard, color: 'bg-slate-900' },
              { id: 'visited', label: 'Visitados', icon: CheckCircle2, color: 'bg-green-600' },
              { id: 'not_visited', label: 'Não Visitados', icon: Clock, color: 'bg-red-600' },
              { id: 'in_service', label: 'Em Atendimento', icon: Activity, color: 'bg-amber-500' },
              { id: 'occurrence', label: 'Ocorrência', icon: AlertTriangle, color: 'bg-blue-600' }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id as any)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black transition-all whitespace-nowrap border shadow-lg",
                  filter === item.id 
                    ? `${item.color} text-white border-transparent scale-105` 
                    : "bg-white/90 backdrop-blur-md text-slate-600 border-white/20 hover:bg-white"
                )}
              >
                <item.icon className="w-3.5 h-3.5" />
                {item.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Controls - Bottom Right Vertical */}
      <div className={cn("absolute z-[850]", isMobile ? "bottom-24 right-3" : "bottom-8 right-8")}>
        <div className="relative">
          {isMapActionsOpen && (
            <div className={cn(
              "absolute right-0 mb-3 w-48 bg-white/95 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl overflow-hidden",
              isMobile ? "bottom-14" : "bottom-16"
            )}>
              <button
                onClick={() => { setIsMapActionsOpen(false); handleLocateMe(); }}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                Minha localização
                <Crosshair className="w-4 h-4 text-blue-900" />
              </button>
              <div className="h-px bg-slate-100" />
              <button
                onClick={() => mapInstance?.zoomIn()}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                Zoom +
                <Plus className="w-4 h-4 text-blue-900" />
              </button>
              <button
                onClick={() => mapInstance?.zoomOut()}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                Zoom -
                <Minus className="w-4 h-4 text-blue-900" />
              </button>
              <div className="h-px bg-slate-100" />
              <button
                onClick={() => setMapType(mapType === 'street' ? 'satellite' : 'street')}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                {mapType === 'street' ? 'Satélite' : 'Mapa'}
                <Globe className="w-4 h-4 text-blue-900" />
              </button>
              <button
                onClick={() => { setIsMapActionsOpen(false); toggleFullScreen(); }}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                Tela cheia
                <Maximize2 className="w-4 h-4 text-blue-900" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsMapActionsOpen((v) => !v)}
            className={cn(
              "bg-blue-900 text-white shadow-2xl rounded-2xl w-12 h-12 flex items-center justify-center active:scale-95 transition-transform",
              isMapActionsOpen && "bg-slate-900"
            )}
            title="Ações do mapa"
          >
            <Layers className="w-6 h-6" />
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .gcm-popup .leaflet-popup-content-wrapper {
          padding: 0;
          overflow: hidden;
          border-radius: 1.25rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        .gcm-popup .leaflet-popup-content {
          margin: 0;
          width: 256px !important;
        }
        .gcm-tooltip {
          background: rgba(30, 58, 138, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
          color: white !important;
          font-weight: 800 !important;
          font-size: 10px !important;
          padding: 4px 10px !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
        }
        .leaflet-container {
          font-family: inherit;
        }
      `}} />
    </div>
  );
};

export const MapComponent = PatrolMap;
