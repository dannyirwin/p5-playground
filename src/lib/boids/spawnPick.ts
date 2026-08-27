import type { Boid } from './engine.ts';

/** Minimal RNG for spawn picking (CPU + GPU). */
export interface SpawnPickRng {
	randomMin(min: number, max: number): number;
}

/** Center square side length as a fraction of the shorter canvas edge. */
export const SPAWN_CENTER_FRACTION = 0.25;

export function centerSpawnBounds(
	width: number,
	height: number,
	fraction = SPAWN_CENTER_FRACTION
): { cx: number; cy: number; halfW: number; halfH: number } {
	const span = Math.min(width, height) * fraction;
	return {
		cx: width / 2,
		cy: height / 2,
		halfW: span / 2,
		halfH: span / 2
	};
}

export function isInCenterSpawnRegion(
	x: number,
	y: number,
	width: number,
	height: number,
	fraction = SPAWN_CENTER_FRACTION
): boolean {
	const { cx, cy, halfW, halfH } = centerSpawnBounds(width, height, fraction);
	return Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH;
}

/** Prefer a blank index whose position lies in the center region; fall back to any blank. */
export function pickBlankInCenterRegion(
	blankIndices: readonly number[],
	getPos: (index: number) => { x: number; y: number },
	width: number,
	height: number,
	rng: SpawnPickRng,
	fraction = SPAWN_CENTER_FRACTION
): number {
	if (blankIndices.length === 0) return -1;
	const centered: number[] = [];
	for (const idx of blankIndices) {
		const { x, y } = getPos(idx);
		if (isInCenterSpawnRegion(x, y, width, height, fraction)) centered.push(idx);
	}
	const pool = centered.length > 0 ? centered : [...blankIndices];
	return pool[Math.floor(rng.randomMin(0, pool.length))]!;
}

export function pickBlankBoidInCenterRegion(
	blankIndices: readonly number[],
	boids: readonly Boid[],
	width: number,
	height: number,
	rng: SpawnPickRng,
	fraction = SPAWN_CENTER_FRACTION
): number {
	return pickBlankInCenterRegion(
		blankIndices,
		(idx) => boids[idx]!,
		width,
		height,
		rng,
		fraction
	);
}
