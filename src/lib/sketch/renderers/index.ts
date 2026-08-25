import type { Renderer, RenderModeId } from '../types.ts';
import { createBoidsRenderer } from './boids.ts';
import { createStringsRenderer } from './strings.ts';

export const DEFAULT_RENDER_MODE: RenderModeId = 'strings';

interface RenderModeEntry {
	label: string;
	create: () => Renderer;
}

const registry: Record<RenderModeId, RenderModeEntry> = {
	strings: { label: 'Strings', create: createStringsRenderer },
	boids: { label: 'Boids', create: createBoidsRenderer }
};

export const RENDER_MODES = Object.entries(registry).map(([id, entry]) => ({
	id: id as RenderModeId,
	label: entry.label
}));

export function isRenderModeId(value: unknown): value is RenderModeId {
	return typeof value === 'string' && value in registry;
}

/** Unknown / missing ids fall back to the default mode. */
export function coerceRenderModeId(value: unknown): RenderModeId {
	return isRenderModeId(value) ? value : DEFAULT_RENDER_MODE;
}

export function createRenderer(id: unknown): Renderer {
	return registry[coerceRenderModeId(id)].create();
}
