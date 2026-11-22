import base from './playwright.ui.config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  testMatch: ['ai-assistant.spec.ts'],
});
