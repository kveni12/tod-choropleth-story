import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

/**
 * Legacy `/poc` URL: the proof-of-concept dashboard now lives at `/`.
 */
export function load() {
	throw redirect(308, `${base}/`);
}
