import { defineConfig } from '@playwright/test';
import ui from './playwright.ui.config';
export default defineConfig(ui, {
  testMatch: 'map-baseline.spec.ts',
  timeout: 120_000,
  workers: 1,
  use: { ...ui.use, actionTimeout: 10_000 },
});
