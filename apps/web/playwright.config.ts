import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.TRUSTGUARD_WEB_URL ?? 'http://127.0.0.1:3100',
    headless: true,
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
