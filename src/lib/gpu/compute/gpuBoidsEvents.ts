import { BOID_FLOATS } from './boidLayout.ts';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import { cellMayIntersectDisc, wrapDelta } from '../../boids/neighborKernel.ts';
import { pickBlankInCenterRegion } from '../../boids/spawnPick.ts';
import {
	assignedCountsPacked,
	canSpreadPacked,
	canStealFromPacked,
	convertBoostPacked,
	effectiveMidi,
	ignitePacked,
	isPlayingPacked,
	type PackedRng
} from './packedBoidLife.ts';

function wrapCellIndex(cx: number, cy: number, cols: number, rows: number): number {
	const wx = ((cx % cols) + cols) % cols;
	const wy = ((cy % rows) + rows) % rows;
	return wy * cols + wx;
}

/** Spatial grid for infection queries — toroidal like BoidSpatialHash. */
function buildGrid(
	data: Float32Array,
	count: number,
	width: number,
	height: number,
	cellSize: number,
	_neighborRadius: number
): Map<number, number[]> {
	const cs = Math.max(8, cellSize);
	const cols = Math.max(1, Math.ceil(width / cs));
	const rows = Math.max(1, Math.ceil(height / cs));
	const grid = new Map<number, number[]>();

	const push = (cell: number, i: number) => {
		const list = grid.get(cell) ?? [];
		list.push(i);
		grid.set(cell, list);
	};

	for (let i = 0; i < count; i++) {
		const base = i * BOID_FLOATS;
		const x = data[base]!;
		const y = data[base + 1]!;
		const cx = Math.floor(x / cs);
		const cy = Math.floor(y / cs);
		push(wrapCellIndex(cx, cy, cols, rows), i);
	}
	return grid;
}

function queryNeighbors(
	grid: Map<number, number[]>,
	x: number,
	y: number,
	width: number,
	height: number,
	cellSize: number,
	radius: number
): number[] {
	const cols = Math.max(1, Math.ceil(width / cellSize));
	const rows = Math.max(1, Math.ceil(height / cellSize));
	const cx = Math.floor(x / cellSize);
	const cy = Math.floor(y / cellSize);
	const out: number[] = [];
	const seen = new Set<number>();
	const rCells = Math.ceil(radius / cellSize);
	for (let dy = -rCells; dy <= rCells; dy++) {
		for (let dx = -rCells; dx <= rCells; dx++) {
			if (
				!cellMayIntersectDisc(
					x,
					y,
					cx + dx,
					cy + dy,
					cellSize,
					radius,
					width,
					height
				)
			) {
				continue;
			}
			const list = grid.get(wrapCellIndex(cx + dx, cy + dy, cols, rows));
			if (!list) continue;
			for (let k = 0; k < list.length; k++) {
				const j = list[k]!;
				if (seen.has(j)) continue;
				seen.add(j);
				out.push(j);
			}
		}
	}
	return out;
}

const defaultRng: PackedRng = {
	random: () => Math.random(),
	randomMin: (min, max) => min + Math.random() * (max - min)
};

function shuffleInPlace(indices: number[], rng: PackedRng): void {
	for (let i = indices.length - 1; i > 0; i--) {
		const j = Math.floor(rng.randomMin(0, i + 1));
		const tmp = indices[i]!;
		indices[i] = indices[j]!;
		indices[j] = tmp;
	}
}

function infectFromPool(
	data: Float32Array,
	pool: number[],
	carrierBase: number,
	midi: number,
	claimed: Set<number>,
	counts: Map<number, number>,
	infectedThisTick: Map<number, number>,
	quota: number,
	maxPerColor: number,
	params: BoidsParams,
	audioMix: { conversions: { midi: number; x: number; y: number }[] },
	rng: PackedRng,
	width: number,
	height: number
): void {
	shuffleInPlace(pool, rng);
	for (let p = 0; p < pool.length; p++) {
		if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) break;
		const current = counts.get(midi) ?? 0;
		if (current >= quota) break;

		const best = pool[p]!;
		if (claimed.has(best)) continue;
		const bBase = best * BOID_FLOATS;
		const prev = effectiveMidi(data, bBase);
		ignitePacked(data, bBase, midi, 0.28 + rng.randomMin(0, 0.4));
		convertBoostPacked(
			data,
			bBase,
			data[carrierBase]!,
			data[carrierBase + 1]!,
			width,
			height,
			rng,
			data[carrierBase + 2]!,
			data[carrierBase + 3]!,
			params.maxSpeedAssigned
		);
		audioMix.conversions.push({ midi, x: data[bBase]!, y: data[bBase + 1]! });
		claimed.add(best);
		counts.set(midi, current + 1);
		infectedThisTick.set(midi, (infectedThisTick.get(midi) ?? 0) + 1);
		if (prev !== null) counts.set(prev, Math.max(0, (counts.get(prev) ?? 0) - 1));
	}
}

export function runGpuBoidEvents(
	data: Float32Array,
	boidCount: number,
	width: number,
	height: number,
	notes: readonly number[] | null,
	params: BoidsParams,
	simFrame: number,
	audioMix: { conversions: { midi: number; x: number; y: number }[] },
	rng: PackedRng = defaultRng
): void {
	if (!notes || notes.length === 0) return;
	const quota = Math.floor(boidCount / notes.length);
	if (quota <= 0) return;

	const infectEvery = Math.max(1, Math.round(params.infectIntervalFrames));
	const exchangeEvery = Math.max(1, Math.round(params.exchangeIntervalFrames));

	if (simFrame % infectEvery === 0) {
		const counts = assignedCountsPacked(data, boidCount);
		const carriers: number[] = [];
		for (let i = 0; i < boidCount; i++) {
			const base = i * BOID_FLOATS;
			if (!canSpreadPacked(data, base)) continue;
			const midi = data[base + 5]!;
			if ((counts.get(midi) ?? 0) < quota) carriers.push(i);
		}
		carriers.sort((a, b) => {
			const ca = counts.get(data[a * BOID_FLOATS + 5]!) ?? 0;
			const cb = counts.get(data[b * BOID_FLOATS + 5]!) ?? 0;
			return ca - cb;
		});

		const radiusSq = params.infectRadius * params.infectRadius;
		// Finer grid than flocking — must match between build and query.
		const infectCellSize = Math.max(8, Math.floor(params.infectRadius / 2));
		const grid = buildGrid(data, boidCount, width, height, infectCellSize, params.infectRadius);
		const claimed = new Set<number>();
		const infectedThisTick = new Map<number, number>();
		const maxPerColor = Math.max(1, Math.round(params.infectMaxPerColor));

		for (const i of carriers) {
			const cBase = i * BOID_FLOATS;
			const midi = data[cBase + 5]!;
			if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) continue;

			const current = counts.get(midi) ?? 0;
			if (current >= quota) continue;

			const neighbors = queryNeighbors(
				grid,
				data[cBase]!,
				data[cBase + 1]!,
				width,
				height,
				infectCellSize,
				params.infectRadius
			);
			const blanks: number[] = [];
			const steals: number[] = [];

			for (const j of neighbors) {
				if (j === i || claimed.has(j)) continue;
				const jBase = j * BOID_FLOATS;
				const dx = wrapDelta(data[jBase]! - data[cBase]!, width);
				const dy = wrapDelta(data[jBase + 1]! - data[cBase + 1]!, height);
				if (dx * dx + dy * dy > radiusSq) continue;
				const otherMidi = effectiveMidi(data, jBase);
				if (otherMidi === null) {
					blanks.push(j);
				} else if (canStealFromPacked(midi, otherMidi, counts, quota, params)) {
					steals.push(j);
				}
			}

			const pool = blanks.length > 0 ? blanks : steals.length > 0 ? steals : null;
			if (!pool) continue;
			infectFromPool(
				data,
				pool,
				cBase,
				midi,
				claimed,
				counts,
				infectedThisTick,
				quota,
				maxPerColor,
				params,
				audioMix,
				rng,
				width,
				height
			);
		}

		const spawnFloor = quota * params.spontaneousInfectThreshold;
		const needyNotes = [...notes]
			.filter((m) => (counts.get(m) ?? 0) < spawnFloor)
			.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

		for (const midi of needyNotes) {
			if ((counts.get(midi) ?? 0) >= quota) continue;
			if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) continue;
			if (rng.random() >= params.spontaneousInfectChance) continue;

			const blanks: number[] = [];
			for (let i = 0; i < boidCount; i++) {
				if (claimed.has(i)) continue;
				if (isPlayingPacked(data, i * BOID_FLOATS)) continue;
				blanks.push(i);
			}
			if (blanks.length === 0) break;

			const idx = pickBlankInCenterRegion(
				blanks,
				(i) => ({ x: data[i * BOID_FLOATS]!, y: data[i * BOID_FLOATS + 1]! }),
				width,
				height,
				rng
			);
			if (idx < 0) break;
			const bBase = idx * BOID_FLOATS;
			const prev = effectiveMidi(data, bBase);
			ignitePacked(data, bBase, midi, 0.22 + rng.randomMin(0, 0.35));
			convertBoostPacked(
				data,
				bBase,
				width / 2,
				height / 2,
				width,
				height,
				rng,
				0,
				0,
				params.maxSpeedAssigned
			);
			audioMix.conversions.push({ midi, x: data[bBase]!, y: data[bBase + 1]! });
			claimed.add(idx);
			const current = counts.get(midi) ?? 0;
			counts.set(midi, current + 1);
			infectedThisTick.set(midi, (infectedThisTick.get(midi) ?? 0) + 1);
			if (prev !== null) counts.set(prev, Math.max(0, (counts.get(prev) ?? 0) - 1));
		}
	}

	if (simFrame % exchangeEvery === 0 && notes.length >= 2) {
		if (rng.random() >= params.exchangeChance) return;
		const counts = assignedCountsPacked(data, boidCount);
		const minHold = Math.max(1, Math.floor(quota * params.minHoldFrac));
		const donors: number[] = [];
		const takers: number[] = [];
		for (const midi of notes) {
			const n = counts.get(midi) ?? 0;
			if (n > minHold && n >= quota * 0.45) donors.push(midi);
			if (n < quota) takers.push(midi);
		}
		if (donors.length === 0 || takers.length === 0) return;
		donors.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
		takers.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

		let fromMidi = -1;
		let toMidi = -1;
		for (const d of donors) {
			for (const t of takers) {
				if (d === t) continue;
				if ((counts.get(d) ?? 0) - (counts.get(t) ?? 0) < quota * 0.04) continue;
				fromMidi = d;
				toMidi = t;
				break;
			}
			if (fromMidi >= 0) break;
		}
		if (fromMidi < 0 || toMidi < 0) return;

		const pool: number[] = [];
		for (let i = 0; i < boidCount; i++) {
			const base = i * BOID_FLOATS;
			if (isPlayingPacked(data, base) && data[base + 5] === fromMidi) pool.push(i);
		}
		if (pool.length === 0) return;
		const idx = pool[Math.floor(rng.randomMin(0, pool.length))]!;
		const base = idx * BOID_FLOATS;
		ignitePacked(data, base, toMidi, 0.35 + rng.randomMin(0, 0.35));
		convertBoostPacked(data, base, data[base]!, data[base + 1]!, width, height, rng);
		audioMix.conversions.push({ midi: toMidi, x: data[base]!, y: data[base + 1]! });
	}
}

export function computeAssignedCountByMidi(
	data: Float32Array,
	count: number
): Map<number, number> {
	return assignedCountsPacked(data, count);
}

export function computeBlankCount(data: Float32Array, boidCount: number): number {
	let blanks = 0;
	for (let i = 0; i < boidCount; i++) {
		if (!isPlayingPacked(data, i * BOID_FLOATS)) blanks++;
	}
	return blanks;
}

export function computeAudioIntensity(
	data: Float32Array,
	boidCount: number,
	noteCount: number,
	quota: number
): number {
	let litSum = 0;
	for (let i = 0; i < boidCount; i++) {
		const base = i * BOID_FLOATS;
		if (data[base + 5]! >= 0) litSum += data[base + 4]!;
	}
	if (litSum <= 0) return 0;
	const litTarget = noteCount > 0 ? quota * noteCount : boidCount * 0.12;
	const t = Math.min(1, litSum / litTarget);
	return 0.3 + t * 0.7;
}
