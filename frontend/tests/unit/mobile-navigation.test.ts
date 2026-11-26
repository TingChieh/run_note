import { describe, expect, it } from 'vitest';
import { contextPath, viewContext } from '#lib/api/view-context.ts';
import {
  EXPLORE_SECTIONS,
  canSeeAssistant,
  canSeeWellbeing,
  exploreSectionFor,
  isRecordingRoute,
  mobileNavigation,
  mobileTabFor,
} from '#lib/navigation.ts';

const hrefFor =
  (pathname: string, admin = false) =>
  (path: string) =>
    contextPath(viewContext(pathname, admin), path);
const links = (nav: ReturnType<typeof mobileNavigation>) => nav.tabs.map((tab) => [tab.label, tab.href]);

describe('mobile tab bar (item 49 方案 B)', () => {
  it('maps the site owner to 今天/记录/开跑/探索/我的 on the root showcase', () => {
    const nav = mobileNavigation({ is_admin: true }, hrefFor('/', true));
    expect(links(nav)).toEqual([
      ['今天', '/'],
      ['记录', '/activities'],
      ['探索', '/footprints'],
      ['我的', '/settings'],
    ]);
    expect(nav.record).toBe('/activities/record');
  });

  it('keeps an ordinary account inside its own workspace for 我的 and 开跑', () => {
    expect(links(mobileNavigation({ is_admin: false }, hrefFor('/workspace/dashboard')))).toEqual([
      ['今天', '/workspace/dashboard'],
      ['记录', '/workspace/activities'],
      ['探索', '/workspace/footprints'],
      ['我的', '/workspace/settings'],
    ]);
    // Browsing the site owner's showcase: the browsing tabs follow the showcase, 我的 and 开跑 stay the viewer's own.
    const onShowcase = mobileNavigation({ is_admin: false }, hrefFor('/activities'));
    expect(onShowcase.tabs.map((tab) => tab.href)).toEqual(['/', '/activities', '/footprints', '/workspace/settings']);
    expect(onShowcase.record).toBe('/workspace/activities/record');
  });

  it('gives anonymous visitors only the three browsing tabs, prefixed for a named showcase', () => {
    const root = mobileNavigation(null, hrefFor('/'));
    expect(links(root)).toEqual([
      ['今天', '/'],
      ['记录', '/activities'],
      ['探索', '/footprints'],
    ]);
    expect(root.record).toBeNull();
    expect(mobileNavigation(undefined, hrefFor('/p/ui_runner/activities')).tabs.map((tab) => tab.href)).toEqual([
      '/p/ui_runner/dashboard',
      '/p/ui_runner/activities',
      '/p/ui_runner/footprints',
    ]);
  });

  it('marks the tab that owns the current route in every view', () => {
    const cases: [string, ReturnType<typeof mobileTabFor>][] = [
      ['/', 'today'],
      ['/dashboard', 'today'],
      ['/workspace/dashboard', 'today'],
      ['/p/ui_runner/dashboard', 'today'],
      ['/activities', 'records'],
      ['/activities/11111111-1111-4111-8111-111111111111', 'records'],
      ['/workspace/activities/shoes', 'records'],
      ['/p/ui_runner/activities/', 'records'],
      ['/footprints', 'explore'],
      ['/footprints/exploration', 'explore'],
      ['/routes/abc', 'explore'],
      ['/workspace/records/story', 'explore'],
      ['/together', 'explore'],
      ['/settings', 'me'],
      ['/settings/preferences', 'me'],
      ['/workspace/settings/shoes', 'me'],
      ['/admin/users', 'me'],
      ['/admin/users/42/activities', 'me'],
      ['/wellbeing', 'me'],
      ['/ai', 'me'],
      ['/admin', null],
      ['/no-such-page', null],
    ];
    for (const [path, tab] of cases) expect(mobileTabFor(path), path).toBe(tab);
  });

  it('treats the immersive recorder as an action, not a tab, and hides the bar there', () => {
    for (const path of ['/activities/record', '/activities/record/', '/workspace/activities/record']) {
      expect(isRecordingRoute(path), path).toBe(true);
      expect(mobileTabFor(path), path).toBeNull();
    }
    for (const path of ['/activities', '/activities/recorder', '/p/ui_runner/activities/record'])
      expect(isRecordingRoute(path), path).toBe(false);
  });

  it('offers the explore switcher only on the four section pages', () => {
    expect(EXPLORE_SECTIONS.map((section) => section.path)).toEqual([
      '/footprints',
      '/routes',
      '/records',
      '/together',
    ]);
    expect(exploreSectionFor('/footprints')).toBe('/footprints');
    expect(exploreSectionFor('/workspace/routes/')).toBe('/routes');
    expect(exploreSectionFor('/p/ui_runner/records')).toBe('/records');
    expect(exploreSectionFor('/together')).toBe('/together');
    for (const path of ['/footprints/exploration', '/routes/abc', '/workspace/records/story', '/activities'])
      expect(exploreSectionFor(path), path).toBeNull();
  });

  it('shares the AI and wellbeing visibility rules with the desktop list', () => {
    const member = { is_admin: false, wellbeing_allowed: true, wellbeing_enabled: true };
    expect(canSeeAssistant(member, true)).toBe(true);
    expect(canSeeAssistant(member, false)).toBe(false);
    expect(canSeeAssistant(null, true)).toBe(false);
    expect(canSeeWellbeing(member, true)).toBe(true);
    expect(canSeeWellbeing({ ...member, wellbeing_enabled: false }, true)).toBe(false);
    expect(canSeeWellbeing({ ...member, wellbeing_allowed: false }, true)).toBe(false);
    expect(canSeeWellbeing(member, false)).toBe(false);
  });
});
