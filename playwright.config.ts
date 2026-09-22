import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', workers: 1, use: { baseURL: 'http://127.0.0.1:8787', headless: true }, webServer: { command: 'npm run dev:offline', url: 'http://127.0.0.1:8787/api/config', reuseExistingServer: !process.env.CI, timeout: 120_000 }, reporter: 'list' });
