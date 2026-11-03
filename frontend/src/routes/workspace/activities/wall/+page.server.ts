import { redirect } from '@sveltejs/kit';
// The footprint wall was folded into the records page; keep old links and bookmarks working in every view context.
export const load = ({ url }: { url: URL }) => { redirect(308, url.pathname.replace(/\/wall\/?$/, '')); };
