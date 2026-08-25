import type { EntryGenerator } from './$types';
import { RENDER_MODES } from '$lib/sketch/renderers';

/** Prerender the bare route plus one path per render mode. */
export const entries: EntryGenerator = () => [
	{},
	...RENDER_MODES.map(({ id }) => ({ mode: id }))
];
