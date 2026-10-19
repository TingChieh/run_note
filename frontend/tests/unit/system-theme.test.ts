import { expect, it } from 'vitest';
import { resolveTheme } from '../../src/lib/components/system-theme.ts';

it('resolves local preference over site default over system', () => {
  expect(resolveTheme('light', 'dark', true)).toBe('light');
  expect(resolveTheme('dark', 'light', false)).toBe('dark');
  expect(resolveTheme('system', 'dark', false)).toBe('dark');
  expect(resolveTheme('system', 'light', true)).toBe('light');
  expect(resolveTheme('system', 'system', true)).toBe('dark');
  expect(resolveTheme('system', 'system', false)).toBe('light');
});
