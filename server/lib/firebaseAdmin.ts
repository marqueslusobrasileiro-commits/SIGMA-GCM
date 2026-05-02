import admin from "firebase-admin";

// Initialize Firebase Admin
// In this environment, it should pick up the credentials from the environment.
if (!admin.apps.length) {
  // When running locally, explicitly wiring projectId helps avoid mismatches
  // between the frontend Firebase project and the backend ADC context.
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    undefined;

  if (!projectId && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      "[firebase-admin] FIREBASE_PROJECT_ID não definido. " +
        "Rotas /api com verifyIdToken podem falhar localmente.",
    );
  }

  admin.initializeApp({
    projectId,
  });
}

export { admin };
export const db = admin.firestore();

