/** Shared boid population constants — leaf module (no imports from engine/params). */

export const DEFAULT_BOID_COUNT = 900;
export const DEFAULT_GPU_BOID_COUNT = 20_000;
export const MIN_BOID_COUNT = 100;
export const MAX_BOID_COUNT = 50_000;

export function clampBoidCount(value: number): number {
	const n = Math.floor(value);
	if (!Number.isFinite(n)) return DEFAULT_BOID_COUNT;
	return Math.min(MAX_BOID_COUNT, Math.max(MIN_BOID_COUNT, n));
}
