import type { EntryGenerator } from './$types';
import { P5_RENDER_MODES } from '$lib/sketch/renderers';

/** Prerender the bare route plus one path per p5 render mode. */
export const entries: EntryGenerator = () => [
	{},
	...P5_RENDER_MODES.map(({ id }) => ({ mode: id }))
];
