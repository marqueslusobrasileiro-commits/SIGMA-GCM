import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sigmagcm.app',
  appName: 'SIGMA-GCM',
  webDir: 'dist',
  server: {
    // Evita mixed-content no Android: o app roda em `http://localhost`
    // e pode chamar seu backend local `http://192.168.x.x:3000`.
    androidScheme: 'http',
    hostname: 'localhost',
  },
};

export default config;
