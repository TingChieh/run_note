import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({ ...base, testMatch: ['basemaps-live.spec.ts'], timeout: 90000 });
