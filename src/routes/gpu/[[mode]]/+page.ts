import type { EntryGenerator } from './$types';

/** Prerender GPU boids route. */
export const entries: EntryGenerator = () => [{ mode: 'boids' }, {}];
