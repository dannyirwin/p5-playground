import type p5 from 'p5';
import {
	createBoidsPlayer,
	createStringsPlayer
} from '../../instrument/player/adapters/p5/index.ts';
import type { InstrumentPlayer } from '../../instrument/player/types.ts';
import {
	coerceP5RenderModeId,
	DEFAULT_RENDER_MODE,
	type P5RenderModeId,
	type RenderModeId
} from '../../instrument/modes/ids.ts';
import type { BoidsParams } from '../renderers/boidsParams.ts';
import { createBoidsRenderer, type BoidsParamsBridge } from '../renderers/boids.ts';
import type { Renderer } from '../types.ts';
import { createStringsRenderer } from '../renderers/strings.ts';

export {
	coerceRenderModeId,
	coerceP5RenderModeId,
	DEFAULT_RENDER_MODE,
	type RenderModeId,
	type P5RenderModeId
} from '../../instrument/modes/ids.ts';

export interface ModeBundleOptions {
	boidsParams?: BoidsParams;
}

interface ModeEntry {
	label: string;
	createRenderer: (options?: ModeBundleOptions) => Renderer;
	createPlayer: (p: p5) => InstrumentPlayer;
}

const registry: Record<P5RenderModeId, ModeEntry> = {
	strings: {
		label: 'Strings',
		createRenderer: () => createStringsRenderer(),
		createPlayer: createStringsPlayer
	},
	boids: {
		label: 'Boids (CPU)',
		createRenderer: (options) => createBoidsRenderer(options?.boidsParams),
		createPlayer: createBoidsPlayer
	}
};

/** All visualization options in the UI dropdown. */
export const RENDER_MODES: { id: RenderModeId; label: string }[] = [
	...Object.entries(registry).map(([id, entry]) => ({
		id: id as P5RenderModeId,
		label: entry.label
	})),
	{ id: 'boids-gpu', label: 'Boids (GPU)' }
];

/** Prerender / p5 route entries only (excludes GPU-only mode). */
export const P5_RENDER_MODES = RENDER_MODES.filter(
	(m): m is { id: P5RenderModeId; label: string } => m.id !== 'boids-gpu'
);

export const MODES = P5_RENDER_MODES;

export function createRenderer(id: unknown, options?: ModeBundleOptions): Renderer {
	return registry[coerceP5RenderModeId(id)].createRenderer(options);
}

export function createPlayerForMode(p: p5, id: unknown): InstrumentPlayer {
	return registry[coerceP5RenderModeId(id)].createPlayer(p);
}

export function isBoidsParamsBridge(renderer: Renderer): renderer is Renderer & BoidsParamsBridge {
	return (
		typeof (renderer as unknown as BoidsParamsBridge).getParams === 'function' &&
		typeof (renderer as unknown as BoidsParamsBridge).applyParams === 'function'
	);
}

export function createModeBundle(
	p: p5,
	id: unknown,
	options?: ModeBundleOptions
): {
	id: P5RenderModeId;
	renderer: Renderer;
	player: InstrumentPlayer;
} {
	const modeId = coerceP5RenderModeId(id);
	const entry = registry[modeId];
	return {
		id: modeId,
		renderer: entry.createRenderer(options),
		player: entry.createPlayer(p)
	};
}
