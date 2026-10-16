import { redirect } from '@sveltejs/kit';
export const load = ({ url }: { url: URL }) => { redirect(303, `${url.pathname.replace(/\/$/, '')}/dashboard`); };
