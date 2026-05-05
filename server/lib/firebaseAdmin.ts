import admin from "firebase-admin";
import { existsSync, readFileSync } from "fs";

/**
 * Em produção (Render), createCustomToken / Admin Auth exige credenciais de conta de serviço.
 * Defina UMA das opções:
 * - FIREBASE_SERVICE_ACCOUNT: JSON completo da chave (uma linha no Render Environment), ou
 * - GOOGLE_APPLICATION_CREDENTIALS: caminho para o ficheiro JSON (ex.: Secret File em /etc/secrets/...)
 */
function loadServiceAccountCredential(): ReturnType<typeof admin.credential.cert> | null {
  const rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawEnv && String(rawEnv).trim()) {
    try {
      const obj = JSON.parse(String(rawEnv).trim()) as Record<string, unknown>;
      if (!obj.private_key || !obj.client_email) {
        console.error("[firebase-admin] FIREBASE_SERVICE_ACCOUNT sem private_key/client_email.");
        return null;
      }
      return admin.credential.cert(obj as admin.ServiceAccount);
    } catch (e) {
      console.error("[firebase-admin] FIREBASE_SERVICE_ACCOUNT não é JSON válido:", e);
      return null;
    }
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && String(keyPath).trim() && existsSync(String(keyPath).trim())) {
    try {
      const obj = JSON.parse(readFileSync(String(keyPath).trim(), "utf8")) as Record<string, unknown>;
      if (!obj.private_key || !obj.client_email) return null;
      return admin.credential.cert(obj as admin.ServiceAccount);
    } catch (e) {
      console.error("[firebase-admin] Falha ao ler GOOGLE_APPLICATION_CREDENTIALS:", keyPath, e);
      return null;
    }
  }

  return null;
}

if (!admin.apps.length) {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    undefined;

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.STORAGE_BUCKET ||
    (projectId ? `${projectId}.appspot.com` : undefined);

  const credential = loadServiceAccountCredential();

  if (credential) {
    admin.initializeApp({ credential, projectId, storageBucket });
  } else {
    admin.initializeApp({ projectId, storageBucket });
    const prodLike =
      process.env.NODE_ENV === "production" ||
      process.env.RENDER === "true" ||
      process.env.RENDER_EXTERNAL_URL !== undefined;
    if (prodLike) {
      // eslint-disable-next-line no-console
      console.warn(
        "[firebase-admin] Sem FIREBASE_SERVICE_ACCOUNT nem ficheiro GOOGLE_APPLICATION_CREDENTIALS. " +
          "Login Google (createCustomToken) e outras operações Admin Auth falharão no servidor.",
      );
    } else if (!projectId) {
      // eslint-disable-next-line no-console
      console.warn(
        "[firebase-admin] FIREBASE_PROJECT_ID não definido. Rotas /api podem falhar localmente.",
      );
    }
  }
}

export { admin };
export const db = admin.firestore();
export const storageBucket = admin.storage().bucket();
