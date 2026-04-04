import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';

/**
 * GooglePatrolMap Component
 * 
 * A robust, responsive Google Maps component designed for restricted containers.
 * Uses @react-google-maps/api for stable React integration.
 */

interface GooglePatrolMapProps {
  apiKey?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
}

const containerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '300px',
};

const defaultCenter = {
  lat: -23.5505,
  lng: -46.6333
};

export const GooglePatrolMap: React.FC<GooglePatrolMapProps> = ({
  // INSIRA SUA API KEY AQUI OU PASSE VIA PROPS
  apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || '', 
  center = defaultCenter,
  zoom = 14,
  className = ''
}) => {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
    libraries: ['places']
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onLoad = useCallback(function callback(mapInstance: google.maps.Map) {
    setMap(mapInstance);
    
    // Garantir que o mapa se ajuste ao container após o carregamento
    google.maps.event.trigger(mapInstance, 'resize');
  }, []);

  const onUnmount = useCallback(function callback() {
    setMap(null);
  }, []);

  // Listener de redimensionamento para containers dinâmicos
  useEffect(() => {
    if (!map || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      google.maps.event.trigger(map, 'resize');
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [map]);

  // Fallback Visual / Loading State
  if (loadError || !apiKey) {
    return (
      <div className={`relative w-full h-full min-h-[300px] overflow-hidden bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center p-6 ${className}`}>
        <div className="w-16 h-16 mb-4 rounded-full bg-slate-200 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-slate-700 mb-1">Visualização do Mapa</h3>
        <p className="text-sm text-slate-500 max-w-xs">
          {loadError ? 'Falha ao carregar a API do Google Maps' : 'Interativo em Produção'}
        </p>
        {!apiKey && (
          <div className="mt-4 px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-full border border-amber-100">
            Sandbox Mode: API Key Requerida
          </div>
        )}
      </div>
    );
  }

  return isLoaded ? (
    <div 
      ref={containerRef}
      className={`relative w-full h-full min-h-[300px] overflow-hidden rounded-xl border border-slate-200 shadow-inner ${className}`}
      style={{ height: '100%', width: '100%' }}
    >
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          scaleControl: true,
          streetViewControl: true,
          rotateControl: true,
          fullscreenControl: true,
          gestureHandling: 'greedy',
        }}
      />
      
      {/* CSS de Segurança Embutido */}
      <style dangerouslySetInnerHTML={{ __html: `
        .gm-style { font-family: inherit !important; }
      `}} />
    </div>
  ) : (
    <div className={`relative w-full h-full min-h-[300px] overflow-hidden bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center ${className}`}>
      <div className="w-8 h-8 border-4 border-blue-900/20 border-t-blue-900 rounded-full animate-spin" />
    </div>
  );
};

export default GooglePatrolMap;
