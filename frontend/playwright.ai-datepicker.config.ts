import base from './playwright.ui.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testMatch: ['ai-datepicker.spec.ts'] });
