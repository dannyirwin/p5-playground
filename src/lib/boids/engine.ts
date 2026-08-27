import type { VoicingChange } from '../instrument/events.ts';
import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';
import { DEFAULT_BOIDS_PARAMS, DEFAULT_FLOCK_PRESET } from '../sketch/renderers/boidsParams.ts';
import type { BoidsProfileId } from '../sketch/renderers/boidsProfiles.ts';
import { snapshotProfile } from '../sketch/renderers/boidsProfiles.ts';
import {
	buildSimContext,
	computeDynamicBoidsParams,
	createDynamicThresholdState,
	resetDynamicThresholds,
	shouldRefreshDynamic,
	type DynamicThresholdState
} from '../sketch/renderers/boidsDynamic.ts';
import { pickBlankBoidInCenterRegion } from './spawnPick.ts';
import { clampBoidCount } from './boidCount.ts';
import { BoidSpatialHash } from './spatialHash.ts';
import {
	computeSpatialCellSize,
	radialFalloff,
	wrapDelta,
	wrapPosition
} from './neighborKernel.ts';
import { sampleWindField, sampleCenterBiasField } from './fieldSample.ts';
import {
	FLOCK_COHESION,
	FLOCK_ALIGNMENT,
	FLOCK_ALI_RADIUS,
	FLOCK_COH_RADIUS,
	FLOCK_ASSIGNED,
	type FlockPreset,
	snapshotFlockPreset
} from './flockSeparation.ts';

export interface Boid {
	x: number;
	y: number;
	vx: number;
	vy: number;
	targetMidi: number | null;
	ghostMidi: number | null;
	lit: number;
	decaying: boolean;
	glowSize: number;
	glowBright: number;
	speedTrait: number;
	fadeTrait: number;
	riseTrait: number;
	glowPhase: number;
	glowRate: number;
}

export interface BoidsSimRng {
	random(max?: number): number;
	randomMin(min: number, max: number): number;
	noise(x: number, y: number, z: number): number;
}

export interface BoidsEngine {
	readonly count: number;
	getParams(): BoidsParams;
	applyParams(next: BoidsParams): void;
	getFlockPreset(): FlockPreset;
	applyFlockPreset(next: FlockPreset): void;
	setProfileBaseline(id: BoidsProfileId): void;
	refreshDynamicTuning(width: number, height: number, force?: boolean): void;
	snapshotParams(): BoidsParams;
	snapshotBaseline(): { params: BoidsParams; flock: FlockPreset };
	applyUserPreset(params: BoidsParams, flock?: FlockPreset): void;
	getBoids(): readonly Boid[];
	getSoundingNotes(): readonly number[] | null;
	getSoundingBassActive(): boolean;
	getAssignedCountByMidi(): Map<number, number>;
	getNoteQuota(noteCount: number): number;
	sampleField(
		x: number,
		y: number,
		width: number,
		height: number,
		millis: number
	): { x: number; y: number };
	seed(width: number, height: number): void;
	resize(width: number, height: number): void;
	applyVoicing(event: VoicingChange, width: number, height: number, millis: number, audioMix: { conversions: { midi: number; x: number; y: number }[] }): void;
	releaseVoicing(): void;
	step(width: number, height: number, millis: number, deltaTime: number, audioMix: { intensity: number; conversions: { midi: number; x: number; y: number }[] }): void;
	destroy(): void;
}

const TWO_PI = Math.PI * 2;

/**
 * Flocking weights and radii in canvas pixels. Speeds / forces are per
 * reference frame (see `FRAME_MS`), so the sim looks the same at any FPS.
 */
interface FlockParams {
	count: number;
	sep: number;
	ali: number;
	coh: number;
	sepRadius: number;
	aliRadius: number;
	cohRadius: number;
	maxSpeed: number;
	minSpeed: number;
	maxForce: number;
}

interface GroupParams {
	sep: number;
	ali: number;
	coh: number;
	maxSpeed: number;
	maxForce: number;
	orbitRadius: number;
	tangential: number;
}

const FLOCK: FlockParams = {
	/** Default flock size for CPU route; GPU uses a multiple via constants. */
	count: 900,
	sep: 1.0,
	ali: FLOCK_ALIGNMENT,
	coh: FLOCK_COHESION,
	sepRadius: 16,
	aliRadius: FLOCK_ALI_RADIUS,
	cohRadius: FLOCK_COH_RADIUS,
	maxSpeed: 6.5,
	minSpeed: FLOCK_ASSIGNED.minSpeed,
	maxForce: 0.2
};

/** Per pitch-class personality — subtle variation so colors differ slightly. */
const GROUP_PARAMS: readonly GroupParams[] = Array.from({ length: 12 }, (_, pc) => {
	const t = pc / 12;
	return {
		sep: 0.94 + Math.sin(t * Math.PI * 2) * 0.1,
		ali: 0.94 + Math.cos(t * Math.PI * 2 + 0.9) * 0.1,
		coh: 0.92 + Math.sin(t * Math.PI * 4 + 1.4) * 0.08,
		maxSpeed: 0.94 + Math.cos(t * Math.PI * 3 + 0.3) * 0.1,
		maxForce: 0.92 + Math.sin(t * Math.PI * 5 + 2.1) * 0.12,
		orbitRadius: 0.82 + Math.cos(t * Math.PI * 2 + 1.7) * 0.26,
		tangential: 0.55 + Math.sin(t * Math.PI * 2 + 3.2) * 0.42
	};
});

const IDLE_GROUP: GroupParams = {
	sep: 1,
	ali: 1,
	coh: 1,
	maxSpeed: 1,
	maxForce: 1,
	orbitRadius: 1,
	tangential: 1
};

/** Speeds / forces above are expressed per frame of this length. */
export const FRAME_MS = 1000 / 60;
/** Tab-out and first-frame spikes would teleport boids across the canvas. */
export const MAX_DELTA_MS = 50;
/** Base glow radius (px) — small dots, many bodies reads as murmuration. */
export const GLOW_BASE_RADIUS = 3.6;
/** Firefly pulse speed (rad/s) before per-boid rate variation. */
export const FIREFLY_OMEGA = 1.25;

/** Lively jewel tones — read bright on the dark canvas. */
const NOTE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
	[72, 255, 195], // C mint
	[255, 205, 72], // C# gold
	[88, 210, 255], // D sky
	[255, 108, 175], // D# rose
	[210, 130, 255], // E violet
	[255, 245, 95], // F lemon
	[64, 255, 238], // F# aqua
	[255, 92, 210], // G magenta
	[130, 255, 108], // G# lime
	[255, 155, 88], // A tangerine
	[175, 175, 255], // A# periwinkle
	[255, 215, 145] // B honey
];

const FIELD_FORCE_PLAYING_CAP_MUL = 1.35;
const BLANK_SPEED_LIT = 0.22;
const BLANK_SPEED_LIT_RANGE = 0.35;
const CHORD_BURST_SURGE = 2.15;
const CHORD_BURST_OUTWARD = 2.2;
const CHORD_BURST_FLOOR = 4.5;
const CHORD_BURST_CAP = 11;
const LIT_ACTIVE = 0.18;
const AUDIO_INTENSITY_FLOOR = 0.3;
const AUDIO_INTENSITY_CEIL = 1;

/** Matches instrumentCore — bass is voiced below this MIDI. */
const VOICING_LOW_MIDI = 48;
/** Deep copper — distinct from the chromatic root on the outer ring. */
const BASS_COLOR: readonly [number, number, number] = [255, 92, 42];

function limit(x: number, y: number, max: number): { x: number; y: number } {
	const mag = Math.hypot(x, y);
	if (mag <= max || mag === 0) return { x, y };
	const scale = max / mag;
	return { x: x * scale, y: y * scale };
}

/**
 * Steer toward a desired velocity. Desired direction is normalized to maxSpeed;
 * weight scales the turn before the force cap so each behavior stays bounded
 * and can actually change heading at higher speeds.
 */
function steer(
	desiredX: number,
	desiredY: number,
	boid: Boid,
	weight: number,
	maxForce: number,
	maxSpeed: number = FLOCK.maxSpeed
): { x: number; y: number } {
	const mag = Math.hypot(desiredX, desiredY);
	if (mag === 0) return { x: 0, y: 0 };
	const scale = maxSpeed / mag;
	return limit(
		(desiredX * scale - boid.vx) * weight,
		(desiredY * scale - boid.vy) * weight,
		maxForce
	);
}

function groupForMidi(midi: number | null, isBass: boolean): GroupParams {
	if (midi === null) return IDLE_GROUP;
	const pc = ((midi % 12) + 12) % 12;
	const base = GROUP_PARAMS[pc] ?? IDLE_GROUP;
	if (!isBass) return base;
	return {
		...base,
		sep: base.sep * 1.08,
		coh: base.coh * 1.12,
		maxSpeed: base.maxSpeed * 0.9,
		orbitRadius: base.orbitRadius * 0.88
	};
}

function isBassMidi(midi: number, notes: readonly number[], bassActive: boolean): boolean {
	return bassActive && midi < VOICING_LOW_MIDI && midi === Math.min(...notes);
}

function noteSetKey(notes: number[] | null): string {
	if (!notes || notes.length === 0) return '';
	return [...notes].sort((a, b) => a - b).join(',');
}

function isPlaying(boid: Boid): boolean {
	return isPlayingBoid(boid);
}

function canSpread(boid: Boid): boolean {
	return boid.targetMidi !== null && boid.lit >= LIT_ACTIVE && !boid.decaying;
}

export { DEFAULT_BOID_COUNT, clampBoidCount } from './boidCount.ts';

export function colorForMidi(
	midi: number,
	notes: readonly number[],
	bassActive: boolean
): readonly [number, number, number] {
	if (isBassMidi(midi, notes, bassActive)) return BASS_COLOR;
	return NOTE_COLORS[((midi % 12) + 12) % 12];
}

export function isPlayingBoid(boid: Boid): boolean {
	return boid.targetMidi !== null && boid.lit >= LIT_ACTIVE && !boid.decaying;
}

/** 0–1 with soft ease-in/out (gentle breathe, not blink). */
export function fireflyPulse(boid: Boid, millis: number): number {
	const t = millis * 0.001;
	const wave = Math.sin(t * FIREFLY_OMEGA * boid.glowRate + boid.glowPhase);
	const u = 0.5 + 0.5 * wave;
	return u * u * (3 - 2 * u);
}

/** Reynolds flocking on a torus; chord notes assign attractors + colors. */
export function createBoidsEngine(
	boidCount: number,
	initialParams: BoidsParams | undefined,
	rng: BoidsSimRng,
	initialFlock?: FlockPreset
): BoidsEngine {
	const count = boidCount;

	function noteQuota(noteCount: number): number {
		if (noteCount <= 0) return 0;
		return Math.floor(count / noteCount);
	}

	const params: BoidsParams = initialParams
		? { ...initialParams, boidCount: clampBoidCount(initialParams.boidCount ?? count) }
		: { ...DEFAULT_BOIDS_PARAMS, boidCount: clampBoidCount(count) };
	let profileParams: BoidsParams = { ...params };
	let profileFlock: FlockPreset = initialFlock
		? snapshotFlockPreset(initialFlock)
		: snapshotFlockPreset(DEFAULT_FLOCK_PRESET);
	let runtimeFlock: FlockPreset = snapshotFlockPreset(profileFlock);
	let dynamicTuningLocked = false;
	const dynamicThresholds: DynamicThresholdState = createDynamicThresholdState();
	let lastBlankCount = 0;
	let boids: Boid[] = [];
	let accX: number[] = [];
	let accY: number[] = [];
	let tightFlags: boolean[] = [];
	let speedCaps: number[] = [];
	let minSpeedCaps: number[] = [];
	let lastNoteKey = '';
	let soundingNotes: number[] | null = null;
	let soundingBassActive = false;
	let simFrame = 0;
	/** Chord-change repel pulse ends at this millis (0 = idle). */
	let repelUntilMs = 0;
	const spatialHash = new BoidSpatialHash();
	const neighborScratch: number[] = [];
	let visitStamp: Uint32Array = new Uint32Array(count);
	let visitGen = 1;

	function ensureVisitStamp(): void {
		if (visitStamp.length < boids.length) {
			visitStamp = new Uint32Array(boids.length);
		}
	}

	function maxNeighborRadius(): number {
		const flock = runtimeFlock;
		return Math.max(
			flock.cohRadius,
			flock.aliRadius,
			flock.separation.radiusIdle,
			flock.separation.radiusSame,
			flock.separation.radiusDiff,
			params.blankRepelRadius,
			params.huntRadius,
			params.infectRadius,
			params.chordRepelSepRadius
		);
	}

	function applyDynamicTuning(w: number, h: number, force = false): void {
		if (dynamicTuningLocked) return;
		const notes = soundingNotes ?? [];
		const counts = assignedCountByMidi();
		const ctx = buildSimContext(
			w,
			h,
			boids.length,
			notes.length,
			lastBlankCount,
			counts
		);
		if (!force && !shouldRefreshDynamic(ctx, dynamicThresholds)) return;
		const tuned = computeDynamicBoidsParams(profileParams, profileFlock, ctx);
		Object.assign(params, tuned.params);
		runtimeFlock = snapshotFlockPreset(tuned.flock);
	}

	function seed(width: number, height: number): void {
		boids = [];
		accX = [];
		accY = [];
		tightFlags = [];
		speedCaps = [];
		minSpeedCaps = [];
		lastNoteKey = '';
		soundingNotes = null;
		soundingBassActive = false;
		simFrame = 0;
		repelUntilMs = 0;
		for (let i = 0; i < count; i++) {
			boids.push({
				x: rng.randomMin(0, width),
				y: rng.randomMin(0, height),
				vx: 0,
				vy: 0,
				targetMidi: null,
				ghostMidi: null,
				lit: 0,
				decaying: false,
				glowSize: rng.randomMin(0.58, 1.02),
				glowBright: rng.randomMin(0.72, 1.18),
				speedTrait: rng.randomMin(0.78, 1.28),
				fadeTrait: rng.randomMin(0.62, 1.45),
				riseTrait: rng.randomMin(0.65, 1.4),
				glowPhase: rng.randomMin(0, TWO_PI),
				glowRate: rng.randomMin(0.65, 1.45)
			});
			accX.push(0);
			accY.push(0);
			tightFlags.push(false);
			speedCaps.push(params.maxSpeedIdle);
			minSpeedCaps.push(params.minSpeedIdle);
		}
	}

	/** 1 → just changed, 0 → pulse over. */
	function chordRepelPhase(millis: number): number {
		if (millis >= repelUntilMs || repelUntilMs <= 0) return 0;
		const window = Math.max(1, params.chordRepelMs);
		return (repelUntilMs - millis) / window;
	}

	/** Surge speed + small outward kick from a repulsion origin (toroidal). */
	function burstBoid(
		boid: Boid,
		fromX: number,
		fromY: number,
		width: number,
		height: number
	): void {
		let speed = Math.hypot(boid.vx, boid.vy);
		if (speed < 0.05) {
			const angle = rng.randomMin(0, TWO_PI);
			boid.vx = Math.cos(angle) * CHORD_BURST_FLOOR;
			boid.vy = Math.sin(angle) * CHORD_BURST_FLOOR;
		} else {
			const surge = Math.max(CHORD_BURST_FLOOR, speed * CHORD_BURST_SURGE);
			boid.vx = (boid.vx / speed) * surge;
			boid.vy = (boid.vy / speed) * surge;
		}

		let ox = wrapDelta(boid.x - fromX, width);
		let oy = wrapDelta(boid.y - fromY, height);
		let dist = Math.hypot(ox, oy);
		if (dist < 1) {
			const angle = rng.randomMin(0, TWO_PI);
			ox = Math.cos(angle);
			oy = Math.sin(angle);
			dist = 1;
		}
		boid.vx += (ox / dist) * CHORD_BURST_OUTWARD;
		boid.vy += (oy / dist) * CHORD_BURST_OUTWARD;

		const capped = limit(boid.vx, boid.vy, CHORD_BURST_CAP);
		boid.vx = capped.x;
		boid.vy = capped.y;
	}

	/** Clear note assignment; keep ghost color while lit drains. */
	function beginReset(boid: Boid): void {
		if (boid.targetMidi !== null) boid.ghostMidi = boid.targetMidi;
		boid.targetMidi = null;
		boid.decaying = true;
	}

	function ignite(boid: Boid, midi: number, litStart: number): void {
		boid.targetMidi = midi;
		boid.ghostMidi = midi;
		boid.lit = litStart;
		boid.decaying = false;
	}

	/** Prefer candidates nearer the canvas center on the torus (soft weighted pick). */
	function pickTowardCenter(indices: number[],
		width: number,
		height: number
	): number {
		if (indices.length === 0) return -1;
		if (indices.length === 1) return indices[0];
		const cx = width / 2;
		const cy = height / 2;
		const maxD = Math.hypot(width / 2, height / 2) || 1;
		let total = 0;
		const weights = new Array<number>(indices.length);
		for (let i = 0; i < indices.length; i++) {
			const b = boids[indices[i]];
			const dx = wrapDelta(b.x - cx, width);
			const dy = wrapDelta(b.y - cy, height);
			const d = Math.hypot(dx, dy) / maxD;
			// Strong bias toward center without making edges impossible.
			const w = 1 / (0.08 + d * d);
			weights[i] = w;
			total += w;
		}
		let r = rng.randomMin(0, total);
		for (let i = 0; i < indices.length; i++) {
			r -= weights[i];
			if (r <= 0) return indices[i];
		}
		return indices[indices.length - 1];
	}

	/** Perlin wind field only (overlay visualization). */
	function fieldAt(
		x: number,
		y: number,
		width: number,
		height: number,
		millis: number,
		windWeight = params.windForce
	): { x: number; y: number } {
		return sampleWindField(
			x,
			y,
			width,
			height,
			millis,
			params,
			windWeight
		);
	}

	/** Keep shared notes; seed each new note from departing / blanks / steal. */
	function assignTargets(notes: number[],
		previousNotes: number[] | null,
		width: number,
		height: number,
		audioMix: { conversions: { midi: number; x: number; y: number }[] }
	): void {
		if (notes.length === 0) {
			for (const boid of boids) {
				if (boid.targetMidi !== null || boid.lit > 0) beginReset(boid);
			}
			return;
		}

		const nextSet = new Set(notes);

		const blanks: number[] = [];
		const departing: number[] = [];
		const byMidi = new Map<number, number[]>();

		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			const midi = boid.targetMidi;
			if (midi === null || boid.decaying) {
				blanks.push(i);
				continue;
			}
			if (nextSet.has(midi)) {
				const list = byMidi.get(midi) ?? [];
				list.push(i);
				byMidi.set(midi, list);
				continue;
			}
			// Old note not in the new chord — available for reseeding or reset.
			departing.push(i);
		}

		function isOwned(idx: number): boolean {
			for (const list of byMidi.values()) {
				if (list.includes(idx)) return true;
			}
			return false;
		}

		function takeFrom(pool: number[]): number {
			const idx = pickTowardCenter(pool, width, height);
			if (idx < 0) return -1;
			const at = pool.indexOf(idx);
			if (at >= 0) pool.splice(at, 1);
			return idx;
		}

		/** Uniform random pick — used to seed brand-new chord colors onto dead boids. */
		function takeRandom(pool: number[]): number {
			if (pool.length === 0) return -1;
			const at = Math.floor(rng.randomMin(0, pool.length));
			const idx = pool[at]!;
			pool.splice(at, 1);
			return idx;
		}

		function claimAsSeed(idx: number, midi: number, withBurst: boolean): void {
			const boid = boids[idx];
			const litStart = withBurst
				? 0.55 + Math.random() * 0.35
				: 0.28 + Math.random() * 0.4;
			ignite(boid, midi, litStart);
			const list = byMidi.get(midi) ?? [];
			list.push(idx);
			byMidi.set(midi, list);
			if (withBurst) {
				burstBoid(boid, boid.x, boid.y, width, height);
			} else {
				convertBoost(boid, boid.x, boid.y, width, height);
				audioMix.conversions.push({ midi, x: boid.x, y: boid.y });
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
				// No departing / blanks — steal from a kept note that still has spare.
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
					idx = pickTowardCenter(donorList, width, height);
					if (idx >= 0) {
						const at = donorList.indexOf(idx);
						if (at >= 0) donorList.splice(at, 1);
					}
				}
			}

			if (idx < 0) {
				const free: number[] = [];
				for (let i = 0; i < boids.length; i++) {
					if (!isOwned(i)) free.push(i);
				}
				idx = isNewColor ? takeRandom(free) : pickTowardCenter(free, width, height);
			}

			if (idx >= 0) claimAsSeed(idx, midi, freshChord);
		}

		// Remaining departing notes fade out (shared notes already kept).
		for (const idx of departing) {
			beginReset(boids[idx]);
		}
	}

	function updateLit(): void {
		for (const boid of boids) {
			if (boid.decaying) {
				boid.lit = Math.max(0, boid.lit - params.litFadeRate * boid.fadeTrait);
				if (boid.lit <= 0) {
					boid.decaying = false;
					boid.ghostMidi = null;
				}
				continue;
			}
			if (boid.targetMidi !== null && boid.lit < 1) {
				boid.lit = Math.min(1, boid.lit + params.litRiseRate * boid.riseTrait);
			}
		}
	}

	/** Carrier-aligned velocity kick when a boid converts (toroidal outward). */
	function convertBoost(
		boid: Boid,
		fromX: number,
		fromY: number,
		width: number,
		height: number,
		carrierVx = 0,
		carrierVy = 0
	): void {
		const preset = runtimeFlock.convert;
		const carrierSpeed = Math.hypot(carrierVx, carrierVy);
		let speed = Math.hypot(boid.vx, boid.vy);

		if (carrierSpeed > 0.05 && preset.carrierBlend > 0) {
			boid.vx = boid.vx * (1 - preset.carrierBlend) + carrierVx * preset.carrierBlend;
			boid.vy = boid.vy * (1 - preset.carrierBlend) + carrierVy * preset.carrierBlend;
			speed = Math.hypot(boid.vx, boid.vy);
		}

		if (speed < 0.05) {
			if (carrierSpeed > 0.05) {
				boid.vx = (carrierVx / carrierSpeed) * preset.surge;
				boid.vy = (carrierVy / carrierSpeed) * preset.surge;
			} else {
				const angle = rng.randomMin(0, TWO_PI);
				boid.vx = Math.cos(angle) * preset.surge;
				boid.vy = Math.sin(angle) * preset.surge;
			}
		} else {
			const surge = Math.max(preset.surge, speed * 1.12);
			boid.vx = (boid.vx / speed) * surge;
			boid.vy = (boid.vy / speed) * surge;
		}

		let ox = wrapDelta(boid.x - fromX, width);
		let oy = wrapDelta(boid.y - fromY, height);
		let dist = Math.hypot(ox, oy);
		if (dist < 1) {
			if (carrierSpeed > 0.05) {
				ox = carrierVx / carrierSpeed;
				oy = carrierVy / carrierSpeed;
			} else {
				const angle = rng.randomMin(0, TWO_PI);
				ox = Math.cos(angle);
				oy = Math.sin(angle);
			}
			dist = 1;
		}
		boid.vx += (ox / dist) * preset.outward;
		boid.vy += (oy / dist) * preset.outward;
		const cap = Math.min(preset.cap, params.maxSpeedAssigned * 1.05);
		const capped = limit(boid.vx, boid.vy, cap);
		boid.vx = capped.x;
		boid.vy = capped.y;
	}

	function assignedCountByMidi(): Map<number, number> {
		const counts = new Map<number, number>();
		for (const boid of boids) {
			if (boid.targetMidi === null || boid.decaying) continue;
			const midi = boid.targetMidi;
			counts.set(midi, (counts.get(midi) ?? 0) + 1);
		}
		return counts;
	}

	/**
	 * Whether carrierMidi may steal a boid currently on victimMidi.
	 * Blanks (null) are always fair game.
	 */
	function canStealFrom(
		carrierMidi: number,
		victimMidi: number | null,
		counts: Map<number, number>,
		quota: number
	): boolean {
		if (victimMidi === null) return true;
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

	/** Prefer a random blank nearby; steal other colors only under quota rules. */
	function spreadInfection(width: number,
		height: number,
		audioMix: { conversions: { midi: number; x: number; y: number }[] }
	): void {
		const notes = soundingNotes;
		if (!notes || notes.length === 0) return;

		const quota = noteQuota(notes.length);
		if (quota <= 0) return;

		const counts = assignedCountByMidi();
		const carriers: number[] = [];

		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			if (!canSpread(boid) || boid.targetMidi === null) continue;
			if ((counts.get(boid.targetMidi) ?? 0) < quota) carriers.push(i);
		}
		if (carriers.length === 0) return;

		carriers.sort((a, b) => {
			const ca = counts.get(boids[a].targetMidi!) ?? 0;
			const cb = counts.get(boids[b].targetMidi!) ?? 0;
			return ca - cb;
		});

		const radiusSq = params.infectRadius * params.infectRadius;
		const claimed = new Set<number>();
		const infectedThisTick = new Map<number, number>();
		const maxPerColor = Math.max(1, Math.round(params.infectMaxPerColor));
		const infectCellSize = Math.max(8, Math.floor(params.infectRadius / 2));
		spatialHash.rebuild(boids, width, height, infectCellSize, params.infectRadius);

		for (const i of carriers) {
			const carrier = boids[i];
			const midi = carrier.targetMidi;
			if (midi === null) continue;

			if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) continue;

			const current = counts.get(midi) ?? 0;
			if (current >= quota) continue;

			const blanksInRange: number[] = [];
			const stealInRange: number[] = [];

			neighborScratch.length = 0;
			spatialHash.queryIndices(carrier.x, carrier.y, params.infectRadius, neighborScratch);
			for (let n = 0; n < neighborScratch.length; n++) {
				const j = neighborScratch[n]!;
				if (j === i || claimed.has(j)) continue;
				const other = boids[j];
				const dx = wrapDelta(other.x - carrier.x, width);
				const dy = wrapDelta(other.y - carrier.y, height);
				const distSq = dx * dx + dy * dy;
				if (distSq > radiusSq || distSq === 0) continue;

				const otherMidi =
					other.decaying || other.targetMidi === null ? null : other.targetMidi;

				if (otherMidi === null) {
					blanksInRange.push(j);
				} else if (canStealFrom(midi, otherMidi, counts, quota)) {
					stealInRange.push(j);
				}
			}

			const pool =
				blanksInRange.length > 0
					? blanksInRange
					: stealInRange.length > 0
						? stealInRange
						: null;
			if (!pool) continue;

			for (let p = pool.length - 1; p > 0; p--) {
				const swap = Math.floor(rng.randomMin(0, p + 1));
				const tmp = pool[p]!;
				pool[p] = pool[swap]!;
				pool[swap] = tmp;
			}

			for (let p = 0; p < pool.length; p++) {
				if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) break;
				const liveCount = counts.get(midi) ?? 0;
				if (liveCount >= quota) break;

				const best = pool[p]!;
				if (claimed.has(best)) continue;
				const infected = boids[best]!;
				const prevMidi =
					infected.decaying || infected.targetMidi === null
						? null
						: infected.targetMidi;

				ignite(infected, midi, 0.28 + Math.random() * 0.4);
				convertBoost(infected, carrier.x, carrier.y, width, height, carrier.vx, carrier.vy);
				audioMix.conversions.push({
					midi,
					x: infected.x,
					y: infected.y
				});
				claimed.add(best);
				counts.set(midi, liveCount + 1);
				infectedThisTick.set(midi, (infectedThisTick.get(midi) ?? 0) + 1);
				if (prevMidi !== null) {
					counts.set(prevMidi, Math.max(0, (counts.get(prevMidi) ?? 0) - 1));
				}
			}
		}

		const spawnFloor = quota * params.spontaneousInfectThreshold;
		const needyNotes = notes
			.filter((m) => (counts.get(m) ?? 0) < spawnFloor)
			.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

		for (const midi of needyNotes) {
			if ((counts.get(midi) ?? 0) >= quota) continue;
			if ((infectedThisTick.get(midi) ?? 0) >= maxPerColor) continue;
			if (rng.random() >= params.spontaneousInfectChance) continue;

			const blanks: number[] = [];
			for (let i = 0; i < boids.length; i++) {
				if (claimed.has(i)) continue;
				if (isPlaying(boids[i]!)) continue;
				blanks.push(i);
			}
			if (blanks.length === 0) break;

			const idx = pickBlankBoidInCenterRegion(blanks, boids, width, height, rng);
			if (idx < 0) break;
			const infected = boids[idx]!;
			const prevMidi =
				infected.decaying || infected.targetMidi === null
					? null
					: infected.targetMidi;

			ignite(infected, midi, 0.22 + rng.randomMin(0, 0.35));
			convertBoost(infected, width / 2, height / 2, width, height);
			audioMix.conversions.push({ midi, x: infected.x, y: infected.y });
			claimed.add(idx);
			const current = counts.get(midi) ?? 0;
			counts.set(midi, current + 1);
			infectedThisTick.set(midi, (infectedThisTick.get(midi) ?? 0) + 1);
			if (prevMidi !== null) {
				counts.set(prevMidi, Math.max(0, (counts.get(prevMidi) ?? 0) - 1));
			}
		}
	}

	/** Rare high→low conversion so counts keep leveling without large swings. */
	function tryColorExchange(
		width: number,
		height: number,
		audioMix: { conversions: { midi: number; x: number; y: number }[] }
	): void {
		const notes = soundingNotes;
		if (!notes || notes.length < 2) return;
		if (rng.random() >= params.exchangeChance) return;

		const quota = noteQuota(notes.length);
		if (quota <= 0) return;
		const counts = assignedCountByMidi();
		const minHold = Math.max(1, Math.floor(quota * params.minHoldFrac));

		const donors: number[] = [];
		const takers: number[] = [];
		for (const midi of notes) {
			const n = counts.get(midi) ?? 0;
			if (n > minHold && n >= quota * 0.45) donors.push(midi);
			if (n < quota) takers.push(midi);
		}
		if (donors.length === 0 || takers.length === 0) return;

		// Prefer moving from the fullest toward the emptiest.
		donors.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
		takers.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

		let fromMidi = -1;
		let toMidi = -1;
		for (const d of donors) {
			for (const t of takers) {
				if (d === t) continue;
				const dn = counts.get(d) ?? 0;
				const tn = counts.get(t) ?? 0;
				if (dn - tn < quota * 0.04) continue; // already close — skip
				fromMidi = d;
				toMidi = t;
				break;
			}
			if (fromMidi >= 0) break;
		}
		if (fromMidi < 0 || toMidi < 0) return;

		const pool: number[] = [];
		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			if (isPlaying(boid) && boid.targetMidi === fromMidi) pool.push(i);
		}
		if (pool.length === 0) return;

		const idx = pool[Math.floor(rng.randomMin(0, pool.length))];
		const boid = boids[idx];
		ignite(boid, toMidi, 0.35 + Math.random() * 0.35);
		convertBoost(boid, boid.x, boid.y, width, height);
		audioMix.conversions.push({ midi: toMidi, x: boid.x, y: boid.y });
	}

	function updateAudioMix(audioMix: {
		intensity: number;
		conversions: { midi: number; x: number; y: number }[];
	}): void {
		const litSum = boids.reduce(
			(sum, b) => sum + (b.targetMidi !== null ? b.lit : 0),
			0
		);
		if (litSum <= 0) {
			audioMix.intensity = 0;
			return;
		}
		const noteCount = soundingNotes?.length ?? 0;
		const quota = noteQuota(noteCount);
		const litTarget =
			noteCount > 0 ? quota * noteCount : count * 0.12;
		const t = Math.min(1, litSum / litTarget);
		audioMix.intensity =
			AUDIO_INTENSITY_FLOOR + t * (AUDIO_INTENSITY_CEIL - AUDIO_INTENSITY_FLOOR);
	}

	function applyVoicingChange(
		event: VoicingChange,
		width: number,
		height: number,
		millis: number,
		audioMix: { conversions: { midi: number; x: number; y: number }[] }
	): void {
		const previousNotes = soundingNotes;
		const notes = event.notes;
		lastNoteKey = noteSetKey(notes);
		soundingNotes = notes;
		soundingBassActive = event.bassActive;
		repelUntilMs = millis + params.chordRepelMs;
		resetDynamicThresholds(dynamicThresholds);
		assignTargets(notes, previousNotes, width, height, audioMix);
		// Brief scatter on every chord commit — even when the note set is unchanged.
		const cx = width / 2;
		const cy = height / 2;
		for (const boid of boids) {
			if (!isPlaying(boid)) continue;
			let ox = wrapDelta(boid.x - cx, width);
			let oy = wrapDelta(boid.y - cy, height);
			let dist = Math.hypot(ox, oy);
			if (dist < 1) {
				const angle = rng.randomMin(0, TWO_PI);
				ox = Math.cos(angle);
				oy = Math.sin(angle);
				dist = 1;
			}
			const kick = params.chordRepelForce * 0.22;
			boid.vx += (ox / dist) * kick;
			boid.vy += (oy / dist) * kick;
			const tang = rng.randomMin(-1, 1) * kick * 0.35;
			boid.vx += (-oy / dist) * tang;
			boid.vy += (ox / dist) * tang;
			const capped = limit(boid.vx, boid.vy, params.maxSpeedAssigned * params.chordRepelSpeedBoost);
			boid.vx = capped.x;
			boid.vy = capped.y;
		}
		applyDynamicTuning(width, height, true);
	}

	function releaseVoicing(): void {
		lastNoteKey = '';
		soundingNotes = null;
		soundingBassActive = false;
		for (const boid of boids) {
			if (boid.targetMidi !== null || boid.lit > 0) beginReset(boid);
		}
	}

	function accumulateForces(width: number,
		height: number,
		millis: number
	): void {
		const flock = runtimeFlock;
		const aliRadiusSq = flock.aliRadius * flock.aliRadius;
		const cohRadiusSq = flock.cohRadius * flock.cohRadius;
		const sepIdleSq = flock.separation.radiusIdle * flock.separation.radiusIdle;
		const sepSameSq = flock.separation.radiusSame * flock.separation.radiusSame;
		const sepDiffSq = flock.separation.radiusDiff * flock.separation.radiusDiff;
		const blankRepelSq = params.blankRepelRadius * params.blankRepelRadius;
		const huntRadiusSq = params.huntRadius * params.huntRadius;
		const chordSepSq = params.chordRepelSepRadius * params.chordRepelSepRadius;
		const phase = chordRepelPhase(millis);

		const notes = soundingNotes ?? [];
		const bassActive = soundingBassActive;
		const quota = notes.length > 0 ? noteQuota(notes.length) : 0;
		const counts = assignedCountByMidi();
		const cx = width / 2;
		const cy = height / 2;
		const nearFloor =
			quota > 0 ? quota * (1 - params.nearMaxFrac) : Number.POSITIVE_INFINITY;
		const colorNearMax =
			quota > 0 &&
			notes.some((midi) => (counts.get(midi) ?? 0) >= nearFloor);

		const neighborRadius = maxNeighborRadius();
		const cellSize = computeSpatialCellSize(width, height, boids.length, neighborRadius);
		spatialHash.rebuild(boids, width, height, cellSize, neighborRadius);
		ensureVisitStamp();

		let blankCount = 0;
		if (quota > 0) {
			for (let b = 0; b < boids.length; b++) {
				if (!isPlaying(boids[b]!)) blankCount++;
			}
		}
		/** 0 = mostly blank, 1 = almost none blank — scarce blanks seek harder. */
		const blankScarcity =
			quota > 0 && boids.length > 0 ? 1 - blankCount / boids.length : 0;

		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			const playing = isPlaying(boid);
			const flock = runtimeFlock;
			const isBass =
				playing &&
				boid.targetMidi !== null &&
				isBassMidi(boid.targetMidi, notes, bassActive);
			const group = groupForMidi(boid.targetMidi, isBass);
			const litBlend = boid.lit;
			const maxForce = playing
				? flock.assigned.maxForce * group.maxForce
				: flock.maxForceIdle * flock.blank.forceMul;
			const playSpeed =
				params.maxSpeedAssigned * group.maxSpeed * boid.speedTrait;
			const idleSpeed = params.maxSpeedIdle * boid.speedTrait;
			const maxSpeed = playing
				? playSpeed
				: idleSpeed * (BLANK_SPEED_LIT + BLANK_SPEED_LIT_RANGE * litBlend);
			const pulseSpeed =
				phase > 0 ? maxSpeed * (1 + (params.chordRepelSpeedBoost - 1) * phase) : maxSpeed;
			speedCaps[i] = pulseSpeed;
			minSpeedCaps[i] = playing ? flock.assigned.minSpeed : params.minSpeedIdle;

			const myMidi = playing ? boid.targetMidi : null;
			const myCount = myMidi !== null ? (counts.get(myMidi) ?? 0) : 0;
			const myFrac = quota > 0 ? myCount / quota : 1;
			const hunting = playing && myFrac < params.huntBelowFrac;
			const urgency = hunting
				? (params.huntBelowFrac - myFrac) / params.huntBelowFrac
				: 0;

			let sepSameX = 0;
			let sepSameY = 0;
			let sepIdleX = 0;
			let sepIdleY = 0;
			let sepDiffRadX = 0;
			let sepDiffRadY = 0;
			let sepDiffLatX = 0;
			let sepDiffLatY = 0;
			let sameCount = 0;
			let idleCount = 0;
			let diffCount = 0;
			let aliX = 0;
			let aliY = 0;
			let cohX = 0;
			let cohY = 0;
			let aliCount = 0;
			let cohCount = 0;
			let blankRepelX = 0;
			let blankRepelY = 0;
			let blankRepelCount = 0;
			let huntBlankX = 0;
			let huntBlankY = 0;
			let huntBlankCount = 0;
			let huntPreyX = 0;
			let huntPreyY = 0;
			let huntPreyCount = 0;
			let blankSeekX = 0;
			let blankSeekY = 0;
			let blankSeekWeight = 0;
			let chordSepX = 0;
			let chordSepY = 0;
			let chordSepCount = 0;

			visitGen++;
			if (visitGen === 0xffffffff) {
				visitStamp.fill(0);
				visitGen = 1;
			}

			neighborScratch.length = 0;
			spatialHash.queryIndices(boid.x, boid.y, neighborRadius, neighborScratch);
			for (let n = 0; n < neighborScratch.length; n++) {
				const j = neighborScratch[n]!;
				if (j === i || visitStamp[j] === visitGen) continue;
				visitStamp[j] = visitGen;
				const other = boids[j];
				const dx = wrapDelta(other.x - boid.x, width);
				const dy = wrapDelta(other.y - boid.y, height);
				const distSq = dx * dx + dy * dy;
				if (distSq === 0) continue;

				const otherPlaying = isPlaying(other);
				const otherBlank = !otherPlaying;
				const bothOn = playing && otherPlaying;
				const sameNote =
					bothOn &&
					myMidi !== null &&
					other.targetMidi === myMidi;
				const diffColor =
					bothOn &&
					myMidi !== null &&
					other.targetMidi !== null &&
					other.targetMidi !== myMidi;

				// Soft field from blanks — everyone feels a faint push away.
				// Dead/blank pairs shove a bit harder so offs don't clump;
				// extra shove when colors are near quota (saturated flock).
				if (otherBlank && distSq < blankRepelSq) {
					const blankFalloff = radialFalloff(distSq, blankRepelSq);
					let weight = 1.15;
					if (!playing && otherBlank) {
						weight = params.blankBlankRepelWeight;
					}
					if (!playing && colorNearMax) {
						weight *= params.blankRepelNearMaxBoost;
					}
					blankRepelX -= (dx / distSq) * weight * blankFalloff;
					blankRepelY -= (dy / distSq) * weight * blankFalloff;
					blankRepelCount++;
				}

				// Chord-change pulse: temporary mutual shove on everyone.
				if (phase > 0 && distSq < chordSepSq) {
					const chordFalloff = radialFalloff(distSq, chordSepSq);
					chordSepX -= (dx / distSq) * chordFalloff;
					chordSepY -= (dy / distSq) * chordFalloff;
					chordSepCount++;
				}

				// Low-count colors hunt blanks hard, and overfull colors lightly.
				if (hunting && urgency > 0 && distSq < huntRadiusSq) {
					const huntFalloff = radialFalloff(distSq, huntRadiusSq);
					if (otherBlank) {
						huntBlankX += dx * huntFalloff;
						huntBlankY += dy * huntFalloff;
						huntBlankCount++;
					} else if (
						diffColor &&
						other.targetMidi !== null &&
						myMidi !== null
					) {
						const preyFrac =
							quota > 0
								? (counts.get(other.targetMidi) ?? 0) / quota
								: 0;
						if (
							preyFrac >= params.preyAboveFrac &&
							canStealFrom(myMidi, other.targetMidi, counts, quota)
						) {
							huntPreyX += dx * huntFalloff;
							huntPreyY += dy * huntFalloff;
							huntPreyCount++;
						}
					}
				}

				// Blanks drift toward color groups that still have quota headroom.
				// Pull strengthens as fewer blanks remain (fill gaps before chord is full).
				if (
					!playing &&
					otherPlaying &&
					other.targetMidi !== null &&
					quota > 0 &&
					distSq < huntRadiusSq
				) {
					const seekFalloff = radialFalloff(distSq, huntRadiusSq);
					const groupCount = counts.get(other.targetMidi) ?? 0;
					if (groupCount < nearFloor) {
						const headroom = (quota - groupCount) / quota;
						const scarcity = 0.15 + 0.85 * blankScarcity;
						const w = headroom * scarcity * seekFalloff;
						blankSeekX += dx * w;
						blankSeekY += dy * w;
						blankSeekWeight += w;
					}
				}

				// Different lit colors: soft radial + lateral lane-keep (no ali/coh).
				if (diffColor) {
					const falloff = radialFalloff(distSq, sepDiffSq);
					if (falloff > 0) {
						const dist = Math.sqrt(distSq);
						const minDist = flock.separation.radiusDiff * 0.22;
						const softDist = Math.max(dist, minDist);
						const invDist = 1 / softDist;
						const nx = dx * invDist;
						const ny = dy * invDist;
						// Softer when packed tight — slide past instead of locking distance.
						const closeEase = dist / flock.separation.radiusDiff;
						const radialW = falloff * (0.42 + 0.58 * closeEase);
						sepDiffRadX -= nx * radialW * invDist;
						sepDiffRadY -= ny * radialW * invDist;
						const latAmt = flock.separation.diffLateral;
						if (latAmt > 0) {
							let lx: number;
							let ly: number;
							const spd = Math.hypot(boid.vx, boid.vy);
							if (spd > 0.05) {
								const side = boid.vx * dy - boid.vy * dx;
								const s = side >= 0 ? 1 : -1;
								lx = (-boid.vy / spd) * s;
								ly = (boid.vx / spd) * s;
							} else {
								lx = -ny;
								ly = nx;
							}
							sepDiffLatX += (lx * falloff * latAmt) / softDist;
							sepDiffLatY += (ly * falloff * latAmt) / softDist;
						}
						diffCount++;
					}
					continue;
				}

				if (sameNote) {
					const falloff = radialFalloff(distSq, sepSameSq);
					if (falloff > 0) {
						sepSameX -= (dx / distSq) * falloff;
						sepSameY -= (dy / distSq) * falloff;
						sameCount++;
					}
				} else if (!(!playing && otherPlaying)) {
					// Dead boids do not repel lit — avoids ring pile-up at canvas edges.
					const falloff = radialFalloff(distSq, sepIdleSq);
					if (falloff > 0) {
						sepIdleX -= (dx / distSq) * falloff;
						sepIdleY -= (dy / distSq) * falloff;
						idleCount++;
					}
				}

				// Lit same-note ribbons + loose dead-dead murmuration.
				const flockWith =
					(playing && sameNote) || (!playing && otherBlank);
				if (flockWith) {
					const deadMediumRange = playing || distSq >= sepIdleSq;
					if (deadMediumRange) {
						{
							const falloff = radialFalloff(distSq, aliRadiusSq);
							if (falloff > 0) {
								aliX += other.vx * falloff;
								aliY += other.vy * falloff;
								aliCount++;
							}
						}
						{
							const falloff = radialFalloff(distSq, cohRadiusSq);
							if (falloff > 0) {
								cohX += dx * falloff;
								cohY += dy * falloff;
								cohCount++;
							}
						}
					}
				}
			}

			let fx = 0;
			let fy = 0;
			// Same-note sep for blanks only here; lit same-note applied after wind.
			if (sameCount > 0 && !playing) {
				const sepWeight = flock.separation.same * group.sep;
				const force = steer(
					sepSameX,
					sepSameY,
					boid,
					sepWeight,
					maxForce,
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (idleCount > 0) {
				const sepWeight = playing
					? flock.separation.idle * group.sep * flock.separation.assignedIdleMul
					: flock.separation.idle * group.sep * flock.blank.sepIdleMul;
				const force = steer(
					sepIdleX,
					sepIdleY,
					boid,
					sepWeight,
					maxForce * (playing ? 0.45 : 1.05),
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (aliCount > 0) {
				let aliWeight = playing
					? flock.alignment * group.ali * flock.assigned.aliMul
					: flock.alignment * group.ali * flock.blank.blankBlankAliMul;
				// Cross-color crowding disrupts alignment briefly — flocks shear apart.
				if (playing && diffCount > 1) {
					aliWeight *= 1 - Math.min(0.42, (diffCount - 1) * 0.11);
				}
				const force = steer(aliX, aliY, boid, aliWeight, maxForce, pulseSpeed);
				fx += force.x;
				fy += force.y;
			}
			if (cohCount > 0) {
				let cohWeight = playing
					? flock.cohesion * group.coh * flock.assigned.cohMul
					: flock.cohesion * group.coh * flock.blank.blankBlankCohMul;
				if (playing && diffCount > 1) {
					cohWeight *= 1 - Math.min(0.28, (diffCount - 1) * 0.07);
				}
				const force = steer(cohX, cohY, boid, cohWeight, maxForce, pulseSpeed);
				fx += force.x;
				fy += force.y;
			}
			if (blankRepelCount > 0) {
				const force = steer(
					blankRepelX,
					blankRepelY,
					boid,
					params.blankRepel * (playing ? 0.42 : 1.05),
					maxForce * (playing ? 0.45 : 1.25),
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (huntBlankCount > 0) {
				const force = steer(
					huntBlankX,
					huntBlankY,
					boid,
					params.huntBlankAttract * (0.35 + 0.65 * urgency),
					maxForce,
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (huntPreyCount > 0) {
				const force = steer(
					huntPreyX,
					huntPreyY,
					boid,
					params.huntColorAttract * urgency,
					maxForce * 0.7,
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (blankSeekWeight > 0) {
				const force = steer(
					blankSeekX,
					blankSeekY,
					boid,
					params.blankSeekAttract * (0.35 + 0.65 * blankScarcity) * 0.55,
					maxForce * 0.75,
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}

			const needsSpacing =
				!playing && (blankRepelCount > 0 || idleCount > 0);
			const globalCap = playing
				? flock.steering.globalForceCapLit
				: flock.steering.globalForceCapBlank * (needsSpacing ? 1.45 : 1);
			const capped = limit(fx, fy, maxForce * globalCap);
			fx = capped.x;
			fy = capped.y;

			// Soft environment — guides motion but must not overpower color spacing.
			let windMaxF = 0;
			const windLane = playing ? params.windAffectsLit : params.windAffectsDead;
			if (params.windEnabled && windLane) {
				const windWeight = playing
					? params.windForce
					: params.windForceIdle;
				const wind = sampleWindField(
					boid.x,
					boid.y,
					width,
					height,
					millis,
					params,
					windWeight
				);
				const fieldIdleCap = flock.maxForceIdle * 3.5;
				windMaxF = playing
					? Math.min(
							params.windForce * 1.05,
							Math.max(maxForce * 0.65, params.windForce * 0.55)
						)
					: Math.max(fieldIdleCap, params.windForceIdle * 1.05);
				const push = limit(wind.x, wind.y, windMaxF);
				fx += push.x;
				fy += push.y;
			}

			let centerMaxF = 0;
			const centerLane = playing ? params.centerBiasAffectsLit : params.centerBiasAffectsDead;
			if (params.centerBiasEnabled && centerLane) {
				const center = sampleCenterBiasField(boid.x, boid.y, width, height, params);
				centerMaxF = playing
					? Math.min(params.centerBiasStrength * 1.05, maxForce * 0.7)
					: params.centerBiasStrength * 1.05;
				const push = limit(center.x, center.y, centerMaxF);
				fx += push.x;
				fy += push.y;
			}

			// Color / spacing barriers AFTER wind+center so collisions beat environment.
			if (playing && diffCount > 0) {
				const crowd = Math.min(1, (diffCount - 1) / 3);
				const radialScale = 1 - crowd * 0.58;
				const lateralScale = 1 + crowd * 1.05;
				const sepDiffX = sepDiffRadX * radialScale + sepDiffLatX * lateralScale;
				const sepDiffY = sepDiffRadY * radialScale + sepDiffLatY * lateralScale;
				const barrierBudget = Math.max(
					maxForce * (1.75 + crowd * 0.35),
					windMaxF * 1.45,
					centerMaxF * 1.3,
					0.24
				);
				const force = steer(
					sepDiffX,
					sepDiffY,
					boid,
					flock.separation.diff * group.sep * (1 + crowd * 0.12),
					barrierBudget,
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}
			if (playing && sameCount > 0) {
				const force = steer(
					sepSameX,
					sepSameY,
					boid,
					flock.separation.same * group.sep * flock.separation.assignedSameMul,
					Math.max(maxForce * 1.05, windMaxF * 0.85),
					pulseSpeed
				);
				fx += force.x;
				fy += force.y;
			}

			// Chord pulse — applied last so global cap / wind cannot mute it.
			if (phase > 0) {
				const pulseBudget = maxForce * (2.4 + phase * 0.6);
				if (chordSepCount > 0) {
					const force = steer(
						chordSepX,
						chordSepY,
						boid,
						params.chordRepelSep * phase,
						pulseBudget,
						pulseSpeed
					);
					fx += force.x;
					fy += force.y;
				}
				const ox = wrapDelta(boid.x - cx, width);
				const oy = wrapDelta(boid.y - cy, height);
				const dist = Math.hypot(ox, oy);
				if (dist > 0.5) {
					const force = steer(
						ox,
						oy,
						boid,
						params.chordRepelForce * phase,
						pulseBudget * 0.92,
						pulseSpeed
					);
					fx += force.x;
					fy += force.y;
				}
			}

			accX[i] = fx;
			accY[i] = fy;
			tightFlags[i] = playing;
		}
		lastBlankCount = blankCount;
	}

	function integrate(width: number, height: number, steps: number): void {
		const drag = params.speedDrag;
		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			const playing = isPlaying(boid);
			const flock = runtimeFlock;
			const maxSpeed = speedCaps[i] ?? FLOCK.maxSpeed;
			const minSpeed = minSpeedCaps[i] ?? FLOCK.minSpeed;
			let vx = boid.vx + accX[i] * steps;
			let vy = boid.vy + accY[i] * steps;
			const smooth = playing
				? flock.steering.steeringSmoothPlaying
				: flock.steering.steeringSmoothBlank;
			vx = boid.vx + (vx - boid.vx) * smooth;
			vy = boid.vy + (vy - boid.vy) * smooth;

			let speed = Math.hypot(vx, vy);
			// Quadratic drag — resistance grows with (speed/maxSpeed)^2 so maxSpeed
			// is a soft asymptote (more force needed to go faster).
			if (drag > 0 && speed > 1e-6 && maxSpeed > 1e-6) {
				const ratio = speed / maxSpeed;
				const decay = 1 / (1 + drag * ratio * ratio * steps);
				vx *= decay;
				vy *= decay;
				speed = Math.hypot(vx, vy);
				// Soft safety ceiling well above the drag asymptote.
				const softCap = maxSpeed * 1.6;
				if (speed > softCap) {
					const s = softCap / speed;
					vx *= s;
					vy *= s;
					speed = softCap;
				}
			} else if (speed > maxSpeed) {
				const velocity = limit(vx, vy, maxSpeed);
				vx = velocity.x;
				vy = velocity.y;
				speed = Math.hypot(vx, vy);
			}

			boid.vx = vx;
			boid.vy = vy;

			if (speed > 0 && speed < minSpeed) {
				const scale = minSpeed / speed;
				boid.vx *= scale;
				boid.vy *= scale;
			}

			boid.x = wrapPosition(boid.x + boid.vx * steps, width);
			boid.y = wrapPosition(boid.y + boid.vy * steps, height);
		}
	}


	return {
		count,
		getParams() { return params; },
		applyParams(next: BoidsParams) {
			Object.assign(params, next);
			Object.assign(profileParams, next);
		},
		getFlockPreset() { return snapshotFlockPreset(runtimeFlock); },
		applyFlockPreset(next: FlockPreset) {
			profileFlock = snapshotFlockPreset(next);
			runtimeFlock = snapshotFlockPreset(next);
			resetDynamicThresholds(dynamicThresholds);
		},
		setProfileBaseline(id: BoidsProfileId) {
			const snap = snapshotProfile(id);
			profileParams = { ...snap.params };
			profileFlock = snapshotFlockPreset(snap.flock);
			Object.assign(params, snap.params);
			runtimeFlock = snapshotFlockPreset(snap.flock);
			dynamicTuningLocked = false;
			resetDynamicThresholds(dynamicThresholds);
		},
		refreshDynamicTuning(w: number, h: number, force = false) {
			applyDynamicTuning(w, h, force);
		},
		snapshotParams() { return { ...params }; },
		snapshotBaseline() {
			return {
				params: { ...profileParams },
				flock: snapshotFlockPreset(profileFlock)
			};
		},
		applyUserPreset(next: BoidsParams, flock?: FlockPreset) {
			Object.assign(profileParams, next);
			Object.assign(params, next);
			if (flock) {
				profileFlock = snapshotFlockPreset(flock);
				runtimeFlock = snapshotFlockPreset(flock);
			}
			dynamicTuningLocked = true;
			resetDynamicThresholds(dynamicThresholds);
		},
		getBoids() { return boids; },
		getSoundingNotes() { return soundingNotes; },
		getSoundingBassActive() { return soundingBassActive; },
		getAssignedCountByMidi() { return assignedCountByMidi(); },
		getNoteQuota(noteCount: number) { return noteQuota(noteCount); },
		sampleField(x, y, width, height, millis) {
			return fieldAt(x, y, width, height, millis);
		},
		seed,
		resize(width: number, height: number) {
			for (const boid of boids) {
				boid.x = wrapPosition(boid.x, width);
				boid.y = wrapPosition(boid.y, height);
			}
			applyDynamicTuning(width, height, true);
		},
		applyVoicing(event, width, height, millis, audioMix) {
			applyVoicingChange(event, width, height, millis, audioMix);
		},
		releaseVoicing,
		step(width, height, millis, deltaTime, audioMix) {
			if (boids.length === 0) seed(width, height);
			applyDynamicTuning(width, height);
			const dt = Math.min(Math.max(deltaTime, 0), MAX_DELTA_MS);
			const steps = dt / FRAME_MS;
			accumulateForces(width, height, millis);
			integrate(width, height, steps);
			updateLit();
			simFrame++;
			const infectEvery = Math.max(1, Math.round(params.infectIntervalFrames));
			const exchangeEvery = Math.max(1, Math.round(params.exchangeIntervalFrames));
			if (simFrame % infectEvery === 0) {
				spreadInfection(width, height, audioMix);
			}
			if (simFrame % exchangeEvery === 0) {
				tryColorExchange(width, height, audioMix);
			}
			updateAudioMix(audioMix);
		},
		destroy() {
			boids = [];
			accX = [];
			accY = [];
			tightFlags = [];
			speedCaps = [];
			minSpeedCaps = [];
			lastNoteKey = '';
			soundingNotes = null;
			soundingBassActive = false;
			simFrame = 0;
			repelUntilMs = 0;
		}
	};
}
