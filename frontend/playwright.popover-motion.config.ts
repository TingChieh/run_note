import { defineConfig } from '@playwright/test';
import showcase from './playwright.design-system.config';

export default defineConfig({
  ...showcase,
  testMatch: 'popover-motion.spec.ts',
  use: { ...showcase.use, reducedMotion: 'no-preference' }
});
