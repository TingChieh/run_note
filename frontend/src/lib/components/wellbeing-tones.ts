/** Colour and icon of each journal measure. Colours are the `--well-*` tokens in app.css (light and dark); icons are 24×24 stroke paths. */
export type ToneKey = 'mood' | 'anxiety' | 'energy' | 'focus' | 'functioning' | 'sleep' | 'sleep_quality' | 'effects' | 'note' | 'dose';
export const TONES: Record<ToneKey, { color: string; icon: string }> = {
  mood: { color: '--well-mood', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01' },
  anxiety: { color: '--well-anxiety', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  energy: { color: '--well-energy', icon: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z' },
  focus: { color: '--well-focus', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z' },
  functioning: { color: '--well-function', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  sleep: { color: '--well-sleep', icon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' },
  sleep_quality: { color: '--well-sleep-quality', icon: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.4l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' },
  effects: { color: '--well-effect', icon: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' },
  dose: { color: '--well-dose', icon: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7zM8.5 8.5l7 7' },
  note: { color: '--well-note', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
};
