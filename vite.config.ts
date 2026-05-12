import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(({mode}) => {
  // Garante leitura do `.env` / `.env.capacitor` no `vite.config` (process.env sozinho costuma vir vazio aqui).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const isAndroidBuild = process.env.CAPACITOR === 'true' || mode === 'capacitor';
  const apiBaseUrl = (env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  const allowedHostsFromEnv = (env.VITE_ALLOWED_HOSTS || process.env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Em dev, `true` aceita qualquer Host (LAN, hostname, ::1). Edge costuma usar URLs que não batem com a lista fixa.
  const strictHosts =
    env.VITE_STRICT_HOSTS === 'true' || process.env.VITE_STRICT_HOSTS === 'true';
  return {
    plugins: [
      react(), 
      tailwindcss(),
      // Para APK (Capacitor/Android), não geramos .gz para evitar assets duplicados no Gradle.
      ...(!isAndroidBuild
        ? [
            viteCompression({
              algorithm: 'gzip',
              ext: '.gz',
              // No Windows o plugin regista caminhos enganadores (`dist/C:/Users/...`); os .gz ficam em `dist/assets/`.
              verbose: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      __BUILD_ID__: JSON.stringify(new Date().toISOString()),
      __API_BASE_URL__: apiBaseUrl ? JSON.stringify(apiBaseUrl) : "undefined",
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // `cap sync` / Gradle escrevem milhares de ficheiros em `android/` — observar isso quebra o Vite (ENOENT / 500).
      watch: {
        ignored: ['**/android/**', '**/dist/**'],
      },
      allowedHosts: strictHosts
        ? [
            'localhost',
            '127.0.0.1',
            '[::1]',
            '.ngrok-free.dev',
            'pyramid-keg-oblivious.ngrok-free.dev',
            ...allowedHostsFromEnv,
          ]
        : true,
    },
  };
});
