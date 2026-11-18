import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4173/incidentdesk/',
    channel: process.env.PW_BROWSER_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort --base /incidentdesk/',
    url: 'http://127.0.0.1:4173/incidentdesk/',
  },
})

