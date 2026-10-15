export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'runnote-theme';
const changedEvent = 'runnote-theme-change';

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function themePreference(): ThemePreference {
  const value = document.documentElement.dataset.themePreference;
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme(value: ThemePreference) {
  const root = document.documentElement;
  root.dataset.themePreference = value;
  root.dataset.theme = value === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : value;
  window.dispatchEvent(new Event(changedEvent));
}

export function setThemePreference(value: ThemePreference) {
  try {
    if (value === 'system') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Switching still works for this page when storage is unavailable. */ }
  applyTheme(value);
}

// Call once from the root layout; preferences contain no account or activity data.
export function initializeTheme(): () => void {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const systemChanged = () => { if (themePreference() === 'system') applyTheme('system'); };
  const storageChanged = (event: StorageEvent) => { if (event.key === key || event.key === null) applyTheme(savedPreference()); };
  system.addEventListener('change', systemChanged);
  window.addEventListener('storage', storageChanged);
  applyTheme(savedPreference());
  return () => { system.removeEventListener('change', systemChanged); window.removeEventListener('storage', storageChanged); };
}

// Call from onMount; refreshes canvas/WebGL for both system and manual changes.
export function watchSystemTheme(update: (dark: boolean) => void): () => void {
  const changed = () => update(document.documentElement.dataset.theme === 'dark');
  window.addEventListener(changedEvent, changed);
  changed();
  return () => window.removeEventListener(changedEvent, changed);
}
