import { BOID_FLOATS } from './boidLayout.ts';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import type { ConvertBoostPreset, FlockPreset } from '../../boids/flockSeparation.ts';
import { ACTIVE_MURMUR_FLOCK } from '../../boids/flockSeparation.ts';
import { wrapDelta } from '../../boids/neighborKernel.ts';

export const LIT_ACTIVE = 0.18;
const CHORD_BURST_SURGE = 2.15;
const CHORD_BURST_OUTWARD = 2.2;
const CHORD_BURST_FLOOR = 4.5;
const CHORD_BURST_CAP = 11;
const TWO_PI = Math.PI * 2;

let convertPreset: ConvertBoostPreset = { ...ACTIVE_MURMUR_FLOCK.convert };

export function setConvertBoostPreset(preset: ConvertBoostPreset): void {
	convertPreset = { ...preset };
}

export function setConvertBoostFromFlock(flock: FlockPreset): void {
	convertPreset = { ...flock.convert };
}

export type PackedRng = {
	random(): number;
	randomMin(min: number, max: number): number;
};

const defaultRng: PackedRng = {
	random: () => Math.random(),
	randomMin: (min, max) => min + Math.random() * (max - min)
};

function limit(x: number, y: number, max: number): { x: number; y: number } {
	const mag = Math.hypot(x, y);
	if (mag <= max || mag === 0) return { x, y };
	const s = max / mag;
	return { x: x * s, y: y * s };
}

/** Decaying: note cleared but ghost color still draining. */
export function isDecayingPacked(data: Float32Array, base: number): boolean {
	return data[base + 5]! < 0 && data[base + 6]! >= 0 && data[base + 4]! > 0;
}

export function isPlayingPacked(data: Float32Array, base: number): boolean {
	return data[base + 5]! >= 0 && data[base + 4]! >= LIT_ACTIVE && !isDecayingPacked(data, base);
}

export function canSpreadPacked(data: Float32Array, base: number): boolean {
	return isPlayingPacked(data, base);
}

/** Effective MIDI for flocking / steal rules (null = blank). */
export function effectiveMidi(data: Float32Array, base: number): number | null {
	if (isDecayingPacked(data, base)) return null;
	const midi = data[base + 5]!;
	if (midi < 0 || data[base + 4]! < LIT_ACTIVE) return null;
	return midi;
}

export function beginResetPacked(data: Float32Array, base: number): void {
	if (data[base + 5]! >= 0) data[base + 6] = data[base + 5]!;
	data[base + 5] = -1;
}

export function ignitePacked(data: Float32Array, base: number, midi: number, lit: number): void {
	data[base + 5] = midi;
	data[base + 6] = midi;
	data[base + 4] = lit;
}

export function convertBoostPacked(
	data: Float32Array,
	base: number,
	fromX: number,
	fromY: number,
	width: number,
	height: number,
	rng: PackedRng = defaultRng,
	carrierVx = 0,
	carrierVy = 0,
	maxSpeedAssigned = 6
): void {
	const preset = convertPreset;
	let cvx = carrierVx;
	let cvy = carrierVy;
	const carrierSpeed = Math.hypot(cvx, cvy);

	let vx = data[base + 2]!;
	let vy = data[base + 3]!;
	let speed = Math.hypot(vx, vy);

	if (carrierSpeed > 0.05 && preset.carrierBlend > 0) {
		vx = vx * (1 - preset.carrierBlend) + cvx * preset.carrierBlend;
		vy = vy * (1 - preset.carrierBlend) + cvy * preset.carrierBlend;
		speed = Math.hypot(vx, vy);
	}

	if (speed < 0.05) {
		if (carrierSpeed > 0.05) {
			vx = (cvx / carrierSpeed) * preset.surge;
			vy = (cvy / carrierSpeed) * preset.surge;
		} else {
			const angle = rng.randomMin(0, TWO_PI);
			vx = Math.cos(angle) * preset.surge;
			vy = Math.sin(angle) * preset.surge;
		}
	} else {
		const surge = Math.max(preset.surge, speed * 1.12);
		vx = (vx / speed) * surge;
		vy = (vy / speed) * surge;
	}

	let ox = wrapDelta(data[base]! - fromX, width);
	let oy = wrapDelta(data[base + 1]! - fromY, height);
	let dist = Math.hypot(ox, oy);
	if (dist < 1) {
		if (carrierSpeed > 0.05) {
			ox = cvx / carrierSpeed;
			oy = cvy / carrierSpeed;
		} else {
			const angle = rng.randomMin(0, TWO_PI);
			ox = Math.cos(angle);
			oy = Math.sin(angle);
		}
		dist = 1;
	}
	vx += (ox / dist) * preset.outward;
	vy += (oy / dist) * preset.outward;
	const cap = Math.min(preset.cap, maxSpeedAssigned * 1.05);
	const capped = limit(vx, vy, cap);
	data[base + 2] = capped.x;
	data[base + 3] = capped.y;
}

export function burstBoidPacked(
	data: Float32Array,
	base: number,
	fromX: number,
	fromY: number,
	width: number,
	height: number,
	rng: PackedRng = defaultRng
): void {
	let vx = data[base + 2]!;
	let vy = data[base + 3]!;
	let speed = Math.hypot(vx, vy);
	if (speed < 0.05) {
		const angle = rng.randomMin(0, TWO_PI);
		vx = Math.cos(angle) * CHORD_BURST_FLOOR;
		vy = Math.sin(angle) * CHORD_BURST_FLOOR;
	} else {
		const surge = Math.max(CHORD_BURST_FLOOR, speed * CHORD_BURST_SURGE);
		vx = (vx / speed) * surge;
		vy = (vy / speed) * surge;
	}
	let ox = wrapDelta(data[base]! - fromX, width);
	let oy = wrapDelta(data[base + 1]! - fromY, height);
	let dist = Math.hypot(ox, oy);
	if (dist < 1) {
		const angle = rng.randomMin(0, TWO_PI);
		ox = Math.cos(angle);
		oy = Math.sin(angle);
		dist = 1;
	}
	vx += (ox / dist) * CHORD_BURST_OUTWARD;
	vy += (oy / dist) * CHORD_BURST_OUTWARD;
	const capped = limit(vx, vy, CHORD_BURST_CAP);
	data[base + 2] = capped.x;
	data[base + 3] = capped.y;
}

/** Fade / rise lit once per sim step (matches CPU updateLit). */
export function updateLitPacked(
	data: Float32Array,
	boidCount: number,
	params: BoidsParams
): void {
	for (let i = 0; i < boidCount; i++) {
		const base = i * BOID_FLOATS;
		if (isDecayingPacked(data, base)) {
			const fadeTrait = data[base + 10]!;
			data[base + 4] = Math.max(0, data[base + 4]! - params.litFadeRate * fadeTrait);
			if (data[base + 4]! <= 0) {
				data[base + 6] = -1;
			}
			continue;
		}
		if (data[base + 5]! >= 0 && data[base + 4]! < 1) {
			const riseTrait = data[base + 11]!;
			data[base + 4] = Math.min(1, data[base + 4]! + params.litRiseRate * riseTrait);
		}
	}
}

function pickTowardCenter(
	data: Float32Array,
	indices: number[],
	width: number,
	height: number,
	rng: PackedRng
): number {
	if (indices.length === 0) return -1;
	if (indices.length === 1) return indices[0]!;
	const cx = width / 2;
	const cy = height / 2;
	const maxD = Math.hypot(width / 2, height / 2) || 1;
	let total = 0;
	const weights = new Array<number>(indices.length);
	for (let i = 0; i < indices.length; i++) {
		const base = indices[i]! * BOID_FLOATS;
		const dx = wrapDelta(data[base]! - cx, width);
		const dy = wrapDelta(data[base + 1]! - cy, height);
		const d = Math.hypot(dx, dy) / maxD;
		const w = 1 / (0.08 + d * d);
		weights[i] = w;
		total += w;
	}
	let r = rng.randomMin(0, total);
	for (let i = 0; i < indices.length; i++) {
		r -= weights[i]!;
		if (r <= 0) return indices[i]!;
	}
	return indices[indices.length - 1]!;
}

export function assignedCountsPacked(data: Float32Array, count: number): Map<number, number> {
	const m = new Map<number, number>();
	for (let i = 0; i < count; i++) {
		const base = i * BOID_FLOATS;
		if (!isPlayingPacked(data, base)) continue;
		const midi = data[base + 5]!;
		m.set(midi, (m.get(midi) ?? 0) + 1);
	}
	return m;
}

export function canStealFromPacked(
	carrierMidi: number,
	victimMidi: number,
	counts: Map<number, number>,
	quota: number,
	params: BoidsParams
): boolean {
	if (victimMidi < 0) return true;
	if (victimMidi === carrierMidi) return false;
	const victimCount = counts.get(victimMidi) ?? 0;
	const minHold = Math.max(1, Math.floor(quota * params.minHoldFrac));
	if (victimCount - 1 < minHold) return false;
	const carrierCount = counts.get(carrierMidi) ?? 0;
	if (carrierCount < quota * params.stealBelowFrac) return true;
	const nearFloor = quota * (1 - params.nearMaxFrac);
	if (carrierCount >= nearFloor && victimCount >= nearFloor) return true;
	return false;
}

/** Full voicing assignment — port of engine.ts assignTargets. */
export function assignTargetsPacked(
	data: Float32Array,
	boidCount: number,
	notes: number[],
	previousNotes: number[] | null,
	width: number,
	height: number,
	audioMix: { conversions: { midi: number; x: number; y: number }[] },
	rng: PackedRng = defaultRng
): void {
	if (notes.length === 0) {
		for (let i = 0; i < boidCount; i++) {
			const base = i * BOID_FLOATS;
			if (data[base + 5]! >= 0 || data[base + 4]! > 0) beginResetPacked(data, base);
		}
		return;
	}

	const nextSet = new Set(notes);
	const blanks: number[] = [];
	const departing: number[] = [];
	const byMidi = new Map<number, number[]>();

	for (let i = 0; i < boidCount; i++) {
		const base = i * BOID_FLOATS;
		const midi = data[base + 5]!;
		if (midi < 0 || isDecayingPacked(data, base)) {
			blanks.push(i);
			continue;
		}
		if (nextSet.has(midi)) {
			const list = byMidi.get(midi) ?? [];
			list.push(i);
			byMidi.set(midi, list);
			continue;
		}
		departing.push(i);
	}

	function isOwned(idx: number): boolean {
		for (const list of byMidi.values()) {
			if (list.includes(idx)) return true;
		}
		return false;
	}

	function takeFrom(pool: number[]): number {
		const idx = pickTowardCenter(data, pool, width, height, rng);
		if (idx < 0) return -1;
		const at = pool.indexOf(idx);
		if (at >= 0) pool.splice(at, 1);
		return idx;
	}

	function takeRandom(pool: number[]): number {
		if (pool.length === 0) return -1;
		const at = Math.floor(rng.randomMin(0, pool.length));
		const idx = pool[at]!;
		pool.splice(at, 1);
		return idx;
	}

	function claimAsSeed(idx: number, midi: number, withBurst: boolean): void {
		const base = idx * BOID_FLOATS;
		const litStart = withBurst
			? 0.55 + rng.randomMin(0, 0.35)
			: 0.28 + rng.randomMin(0, 0.4);
		ignitePacked(data, base, midi, litStart);
		const list = byMidi.get(midi) ?? [];
		list.push(idx);
		byMidi.set(midi, list);
		if (withBurst) {
			burstBoidPacked(data, base, data[base]!, data[base + 1]!, width, height, rng);
		} else {
			convertBoostPacked(data, base, data[base]!, data[base + 1]!, width, height, rng);
			audioMix.conversions.push({ midi, x: data[base]!, y: data[base + 1]! });
		}
	}

	const freshChord = previousNotes === null || previousNotes.length === 0;
	const prevSet =
		previousNotes && previousNotes.length > 0 ? new Set(previousNotes) : null;

	for (const midi of notes) {
		if ((byMidi.get(midi)?.length ?? 0) > 0) continue;

		const isNewColor = prevSet === null || !prevSet.has(midi);
		let idx = -1;

		// Brand-new chord colors ignite a random dead boid (not center-biased).
		if (isNewColor && blanks.length > 0) {
			idx = takeRandom(blanks);
		} else if (departing.length > 0) {
			idx = takeFrom(departing);
		} else if (blanks.length > 0) {
			idx = takeFrom(blanks);
		} else {
			const donors = notes.filter(
				(n) => n !== midi && (byMidi.get(n)?.length ?? 0) > 1
			);
			const donorPool =
				donors.length > 0
					? donors
					: notes.filter((n) => n !== midi && (byMidi.get(n)?.length ?? 0) > 0);
			if (donorPool.length > 0) {
				const donorMidi = donorPool[Math.floor(rng.randomMin(0, donorPool.length))]!;
				const donorList = byMidi.get(donorMidi)!;
				idx = pickTowardCenter(data, donorList, width, height, rng);
				if (idx >= 0) {
					const at = donorList.indexOf(idx);
					if (at >= 0) donorList.splice(at, 1);
				}
			}
		}

		if (idx < 0) {
			const free: number[] = [];
			for (let i = 0; i < boidCount; i++) {
				if (!isOwned(i)) free.push(i);
			}
			idx = isNewColor
				? takeRandom(free)
				: pickTowardCenter(data, free, width, height, rng);
		}

		if (idx >= 0) claimAsSeed(idx, midi, freshChord);
	}

	for (const idx of departing) {
		beginResetPacked(data, idx * BOID_FLOATS);
	}
}

/** Brief outward + tangential kick on every lit boid when a chord commits. */
export function scatterLitBoidsOnChordChange(
	data: Float32Array,
	count: number,
	width: number,
	height: number,
	params: BoidsParams,
	rng: PackedRng = defaultRng
): void {
	const cx = width / 2;
	const cy = height / 2;
	const kick = params.chordRepelForce * 0.22;
	const speedCap = params.maxSpeedAssigned * params.chordRepelSpeedBoost;
	for (let i = 0; i < count; i++) {
		const base = i * BOID_FLOATS;
		if (!isPlayingPacked(data, base)) continue;
		let ox = wrapDelta(data[base]! - cx, width);
		let oy = wrapDelta(data[base + 1]! - cy, height);
		let dist = Math.hypot(ox, oy);
		if (dist < 1) {
			const angle = rng.randomMin(0, TWO_PI);
			ox = Math.cos(angle);
			oy = Math.sin(angle);
			dist = 1;
		}
		let vx = data[base + 2]! + (ox / dist) * kick;
		let vy = data[base + 3]! + (oy / dist) * kick;
		const tang = rng.randomMin(-1, 1) * kick * 0.35;
		vx += (-oy / dist) * tang;
		vy += (ox / dist) * tang;
		const capped = limit(vx, vy, speedCap);
		data[base + 2] = capped.x;
		data[base + 3] = capped.y;
	}
}
