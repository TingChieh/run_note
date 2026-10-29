import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config.ts';
export default defineConfig({ ...base, testMatch: ['wellbeing.spec.ts'] });
