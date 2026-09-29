import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './tests/.artifacts',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=default',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
      ],
    },
  },
  webServer: {
    // bind explicitly: `vite preview` defaults to localhost/::1 only, which
    // 127.0.0.1 cannot reach.
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
