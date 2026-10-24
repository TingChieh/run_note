import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';
export default defineConfig({ ...base, testMatch: ['route-groups.spec.ts'] });
