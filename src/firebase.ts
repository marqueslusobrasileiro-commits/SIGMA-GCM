import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Capacitor } from '@capacitor/core';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

/** No WebView Android o Auth padrão pode não persistir bem; IndexedDB costuma ser mais estável que session. */
function createAuth(): Auth {
  if (!Capacitor.isNativePlatform()) {
    return getAuth(app);
  }
  try {
    return initializeAuth(app, { persistence: indexedDBLocalPersistence });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();

/**
 * WebSocket do Firestore costuma falhar em WebViews Android (APK). Long polling estabiliza leituras.
 */
function initFirestore() {
  try {
    if (Capacitor.isNativePlatform()) {
      return initializeFirestore(app, {
        experimentalForceLongPolling: true,
      });
    }
  } catch (e) {
    console.warn('[firebase] initializeFirestore(longPolling):', e);
  }
  return getFirestore(app);
}

export const db = initFirestore();
export const storage = getStorage(app);
