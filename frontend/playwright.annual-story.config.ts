import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config';

export default defineConfig({ ...base, testMatch: ['annual-story.spec.ts'] });
