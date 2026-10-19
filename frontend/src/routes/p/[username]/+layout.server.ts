import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
// Unknown, disabled or unpublished subjects look identical so existence is never revealed.
export const load: LayoutServerLoad = ({ locals }) => { if (!locals.showcase) error(404, '页面不存在'); };
