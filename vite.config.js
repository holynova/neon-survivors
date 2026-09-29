import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5180, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    testDir: './tests/e2e',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
      baseURL: 'http://127.0.0.1:4173',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    },
    webServer: {
      command: 'npm run preview -- --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  },
});
