import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import 'leaflet/dist/leaflet.css';
import {PwaInstallPrompt} from './PwaInstallPrompt';

const root = document.getElementById('root');

function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl, {
      scope: import.meta.env.BASE_URL,
    }).catch((error) => {
      console.warn('[SIGMA-GCM] Service Worker não pôde ser registrado:', error);
    });
  });
}

function showBootError(error: unknown) {
  if (!root) return;
  const message = error instanceof Error
    ? `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
    : String(error);
  root.innerHTML = `
    <main style="min-height:100dvh;box-sizing:border-box;padding:32px;font-family:Inter,system-ui,sans-serif;background:#fff7ed;color:#431407">
      <div style="max-width:900px;margin:8vh auto;padding:28px;border:1px solid #fed7aa;border-radius:18px;background:white;box-shadow:0 10px 30px rgba(0,0,0,.08)">
        <h1 style="margin:0 0 12px;font-size:24px">SIGMA-GCM não conseguiu iniciar</h1>
        <p style="margin:0 0 18px;color:#7c2d12">O aplicativo carregou, mas ocorreu um erro ao executar o sistema.</p>
        <pre style="white-space:pre-wrap;overflow:auto;padding:16px;border-radius:12px;background:#111827;color:#f9fafb;font-size:12px;line-height:1.5">${message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        <button onclick="location.reload()" style="margin-top:18px;padding:10px 16px;border:0;border-radius:10px;background:#1d4ed8;color:white;font-weight:700;cursor:pointer">Recarregar</button>
      </div>
    </main>`;
}

window.addEventListener('error', (event) => {
  if (event.error) showBootError(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  showBootError(event.reason);
});

async function bootstrap() {
  try {
    registerPwa();
    const {default: App} = await import('./App.tsx');
    if (!root) throw new Error('Elemento #root não encontrado no index.html');
    createRoot(root).render(
      <StrictMode>
        <>
          <PwaInstallPrompt />
          <App />
        </>
      </StrictMode>,
    );
  } catch (error) {
    console.error('[SIGMA-GCM] Falha no bootstrap:', error);
    showBootError(error);
  }
}

void bootstrap();