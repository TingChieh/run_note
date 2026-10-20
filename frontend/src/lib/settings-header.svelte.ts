import { getContext, setContext } from 'svelte';

const KEY = Symbol('settings-header');
/** Lets a settings page hand its header action to the persistent header rendered by the root layout. */
export type SettingsHeader = { create: (() => void) | null; createDisabled: boolean };

export function provideSettingsHeader(): SettingsHeader {
  const state = $state<SettingsHeader>({ create: null, createDisabled: false });
  setContext(KEY, state);
  return state;
}
export function useSettingsHeader(): SettingsHeader {
  return getContext<SettingsHeader>(KEY) ?? { create: null, createDisabled: false };
}
