import { defineConfig } from '@playwright/test';
import base from './playwright.showcase-build.config.ts';

export default defineConfig({ ...base, testMatch: ['admin-users.spec.ts'] });
