import { defineConfig, devices } from '@playwright/test';

// Dedicated ports so the e2e run never collides with `npm run dev`.
const SERVER_PORT = 3101;
const CLIENT_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx tsx server/src/index.ts',
      env: { PORT: String(SERVER_PORT) },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -w client -- --port ${CLIENT_PORT} --strictPort`,
      env: { SERVER_PORT: String(SERVER_PORT) },
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
