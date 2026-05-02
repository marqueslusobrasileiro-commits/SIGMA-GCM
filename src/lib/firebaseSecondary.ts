import { initializeApp, getApps } from 'firebase/app';
import { getAuth, inMemoryPersistence, setPersistence, type Auth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const SECONDARY_APP_NAME = 'sigma-gcm-secondary';

let secondaryAuthPromise: Promise<Auth> | null = null;

export function getSecondaryAuth(): Promise<Auth> {
  if (secondaryAuthPromise) return secondaryAuthPromise;

  secondaryAuthPromise = (async () => {
    const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
    const app = existing ?? initializeApp(firebaseConfig, SECONDARY_APP_NAME);
    const auth = getAuth(app);
    // Evita persistir estado e evita “sujar” a sessão do aparelho.
    await setPersistence(auth, inMemoryPersistence);
    return auth;
  })();

  return secondaryAuthPromise;
}

