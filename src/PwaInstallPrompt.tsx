import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  useEffect(() => {
    const onInstalled = () => {
      setInstallEvent(null);
      setHidden(true);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  if (hidden || isStandalone()) return null;

  const canUseNativeInstall = !!installEvent;
  const canShowIOSHelp = isIOS() && !canUseNativeInstall;

  if (!canUseNativeInstall && !canShowIOSHelp) return null;

  const install = async () => {
    if (!installEvent) {
      setShowIOSHelp(true);
      return;
    }

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setHidden(true);
    setInstallEvent(null);
  };

  return (
    <>
      <div
        className="fixed left-3 right-3 bottom-3 z-[5000] sm:left-auto sm:right-5 sm:max-w-sm"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="rounded-2xl border border-slate-700 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}icons/icon-192.svg`}
              alt=""
              className="h-12 w-12 rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Instalar SIGMA-GCM</p>
              <p className="text-xs text-slate-300">
                Acesse como aplicativo, com ícone na tela inicial e no desktop.
              </p>
            </div>
            <button
              type="button"
              onClick={install}
              className="shrink-0 rounded-xl bg-amber-400 px-3 py-2 text-sm font-extrabold text-slate-950 hover:bg-amber-300"
            >
              Instalar
            </button>
          </div>
        </div>
      </div>

      {showIOSHelp && (
        <div className="fixed inset-0 z-[5100] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
            <h2 className="text-xl font-bold">Instalar no iPhone/iPad</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              No Safari, toque em <strong>Compartilhar</strong> e depois em{' '}
              <strong>Adicionar à Tela de Início</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSHelp(false)}
              className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
