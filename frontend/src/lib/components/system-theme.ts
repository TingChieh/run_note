// Call from onMount; CSS handles page colors, this also refreshes canvas/WebGL.
export function watchSystemTheme(update: (dark: boolean) => void): () => void {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const changed = () => update(preference.matches);
  preference.addEventListener('change', changed);
  changed();
  return () => preference.removeEventListener('change', changed);
}
