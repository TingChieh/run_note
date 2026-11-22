import { getContext, setContext } from 'svelte';

const KEY = Symbol('settings-header');
export type SettingsHeaderAction = {
  id: string;
  label: string;
  variant: 'primary' | 'secondary';
  disabled?: boolean;
  onclick: () => void;
};
/** Lets a settings page hand its header action and live reminder count to the persistent header rendered by the root layout. */
export type SettingsHeader = {
  action: SettingsHeaderAction | null;
  shoeReminderCount: number | null;
};

export function provideSettingsHeader(): SettingsHeader {
  const state = $state<SettingsHeader>({ action: null, shoeReminderCount: null });
  setContext(KEY, state);
  return state;
}
export function useSettingsHeader(): SettingsHeader {
  return getContext<SettingsHeader>(KEY) ?? { action: null, shoeReminderCount: null };
}
