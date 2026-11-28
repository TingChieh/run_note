import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config.ts';

export default defineConfig({
  ...base,
  testMatch: ['route-groups.spec.ts', 'wellbeing.spec.ts', 'together.spec.ts'],
});
