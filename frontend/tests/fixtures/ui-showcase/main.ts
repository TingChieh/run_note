import { mount } from 'svelte';
import './showcase.css';
import { initializeTheme } from '../../../src/lib/components/system-theme.ts';
import Showcase from './Showcase.svelte';

const stopTheme = initializeTheme();
const target = document.getElementById('app')!;
target.replaceChildren();
const app = mount(Showcase, { target });
if (import.meta.hot) import.meta.hot.dispose(() => { stopTheme(); void import('svelte').then(({ unmount }) => unmount(app)); });
