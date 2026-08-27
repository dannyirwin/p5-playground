/** Visualization mode ids (strings, CPU boids, GPU boids). */
export type RenderModeId = 'strings' | 'boids' | 'boids-gpu';

/** Canvas / frame loop backend. */
export type InstrumentHostId = 'p5' | 'gpu';

export const DEFAULT_RENDER_MODE: RenderModeId = 'strings';

const RENDER_MODE_IDS: ReadonlySet<string> = new Set(['strings', 'boids', 'boids-gpu']);

/** Modes that run on the p5 canvas host (not WebGL/WebGPU). */
export type P5RenderModeId = 'strings' | 'boids';

const P5_RENDER_MODE_IDS: ReadonlySet<string> = new Set(['strings', 'boids']);

export function isRenderModeId(value: unknown): value is RenderModeId {
	return typeof value === 'string' && RENDER_MODE_IDS.has(value);
}

export function isP5RenderModeId(value: unknown): value is P5RenderModeId {
	return typeof value === 'string' && P5_RENDER_MODE_IDS.has(value);
}

/** Unknown ids fall back to strings. */
export function coerceRenderModeId(value: unknown): RenderModeId {
	return isRenderModeId(value) ? value : DEFAULT_RENDER_MODE;
}

/** p5 sketch routes — GPU mode is not valid here. */
export function coerceP5RenderModeId(value: unknown): P5RenderModeId {
	const id = coerceRenderModeId(value);
	return id === 'boids-gpu' ? 'boids' : id;
}

export function isBoidsRenderMode(id: RenderModeId): boolean {
	return id === 'boids' || id === 'boids-gpu';
}

export function isGpuRenderMode(id: RenderModeId): boolean {
	return id === 'boids-gpu';
}
