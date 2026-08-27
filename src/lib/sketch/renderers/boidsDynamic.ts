import type { FlockPreset } from '../../boids/flockSeparation.ts';
import { snapshotFlockPreset } from '../../boids/flockSeparation.ts';
import type { BoidsParams } from './boidsParams.ts';
import type { BoidsProfileId } from './boidsProfiles.ts';
import {
	ACTIVE_BOIDS_PROFILE_ID,
	getBoidsProfile,
	snapshotProfile
} from './boidsProfiles.ts';

/** Runtime sim dimensions for population-aware tuning. */
export interface SimContext {
	width: number;
	height: number;
	boidCount: number;
	noteCount: number;
	quota: number;
	blankCount: number;
	litCount: number;
	/** max(count[midi]) / quota for current chord */
	maxColorFill: number;
	/** mean(count[midi]) / quota */
	meanColorFill: number;
}

export interface DynamicBoidsState {
	params: BoidsParams;
	flock: FlockPreset;
}

/** Tracks threshold crossings so dynamic tuning does not run every frame. */
export interface DynamicThresholdState {
	lastLitBand: number;
	lastFillBand: number;
}

export function createDynamicThresholdState(): DynamicThresholdState {
	return { lastLitBand: -1, lastFillBand: -1 };
}

const LIT_BAND_SIZE = 0.05;
const FILL_BANDS = [0, 0.25, 0.5, 0.75, 0.9] as const;

function litBand(litRatio: number): number {
	return Math.floor(litRatio / LIT_BAND_SIZE);
}

function fillBand(maxColorFill: number): number {
	let band = 0;
	for (let i = 0; i < FILL_BANDS.length; i++) {
		if (maxColorFill >= FILL_BANDS[i]!) band = i;
	}
	return band;
}

/** True when population crossed a band since last check. */
export function shouldRefreshDynamic(
	ctx: SimContext,
	state: DynamicThresholdState
): boolean {
	const lb = litBand(ctx.boidCount > 0 ? ctx.litCount / ctx.boidCount : 0);
	const fb = fillBand(ctx.maxColorFill);
	if (lb !== state.lastLitBand || fb !== state.lastFillBand) {
		state.lastLitBand = lb;
		state.lastFillBand = fb;
		return true;
	}
	return false;
}

export function resetDynamicThresholds(state: DynamicThresholdState): void {
	state.lastLitBand = -1;
	state.lastFillBand = -1;
}

function canvasScale(width: number, height: number): number {
	const ref = 960;
	return Math.sqrt(Math.max(1, width * height) / (ref * ref));
}

function densityScale(width: number, height: number, boidCount: number): number {
	const area = Math.max(1, width * height);
	return Math.sqrt(area / Math.max(1, boidCount));
}

/**
 * Scale base profile params + flock preset for canvas, density, and population.
 * Conservative — built-in profile remains the baseline at low lit ratio.
 */
export function computeDynamicBoidsParams(
	baseParams: BoidsParams,
	baseFlock: FlockPreset,
	ctx: SimContext
): DynamicBoidsState {
	const params: BoidsParams = { ...baseParams };
	const flock = snapshotFlockPreset(baseFlock);

	const litRatio = ctx.boidCount > 0 ? ctx.litCount / ctx.boidCount : 0;
	const cScale = canvasScale(ctx.width, ctx.height);
	const dScale = densityScale(ctx.width, ctx.height, ctx.boidCount);

	// Scale separation radii only — widening ali/coh pulls dead boids into clumps at 20k.
	const radiusMul = Math.min(1.25, Math.max(0.9, dScale / 28));
	flock.separation.radiusIdle *= radiusMul;
	flock.separation.radiusSame *= radiusMul;
	flock.separation.radiusDiff *= radiusMul;

	// Infection radius: keep low-base profiles tight (no quota-driven bloom).
	if (ctx.quota > 0) {
		const infectMul =
			baseParams.infectRadius <= 40
				? Math.min(1.06, Math.max(0.94, cScale * 0.95))
				: Math.min(1.4, Math.max(0.9, Math.sqrt(ctx.quota / 2500) * cScale));
		params.infectRadius = baseParams.infectRadius * infectMul;
	}

	// As murmuration grows, rely on proximity not random spawn / hunting.
	const litEase = Math.min(1, litRatio / 0.6);
	params.spontaneousInfectChance = baseParams.spontaneousInfectChance * (1 - litEase * 0.85);
	params.huntBlankAttract = baseParams.huntBlankAttract * (1 - litEase * 0.55);
	params.blankSeekAttract = baseParams.blankSeekAttract * (1 - litEase * 0.35);

	// Near-quota colors flow instead of hunting.
	const fillEase = Math.min(1, ctx.maxColorFill);
	params.huntBelowFrac = baseParams.huntBelowFrac * (1 - fillEase * 0.35);
	flock.convert.outward = baseFlock.convert.outward * (1 - fillEase * 0.6);
	flock.convert.cap = baseFlock.convert.cap * (1 - fillEase * 0.08);

	// High lit density: stronger ribbon cohesion, gentle extra spacing.
	if (litRatio > 0.08) {
		const dense = Math.min(1, (litRatio - 0.08) / 0.5);
		flock.assigned.aliMul = baseFlock.assigned.aliMul * (1 + dense * 0.04);
		flock.assigned.cohMul = baseFlock.assigned.cohMul * (1 + dense * 0.05);
		flock.assigned.maxForce = baseFlock.assigned.maxForce * (1 - dense * 0.1);
		flock.separation.same = baseFlock.separation.same * (1 + dense * 0.06);
	}

	return { params, flock };
}

export function buildSimContext(
	width: number,
	height: number,
	boidCount: number,
	noteCount: number,
	blankCount: number,
	assignedByMidi: Map<number, number>
): SimContext {
	const quota = noteCount > 0 ? Math.floor(boidCount / noteCount) : 0;
	let litCount = 0;
	let maxCount = 0;
	let sumFill = 0;
	if (noteCount > 0 && quota > 0) {
		for (const count of assignedByMidi.values()) {
			litCount += count;
			if (count > maxCount) maxCount = count;
			sumFill += count / quota;
		}
	} else {
		litCount = Math.max(0, boidCount - blankCount);
	}
	return {
		width,
		height,
		boidCount,
		noteCount,
		quota,
		blankCount,
		litCount,
		maxColorFill: quota > 0 ? maxCount / quota : 0,
		meanColorFill: noteCount > 0 ? sumFill / noteCount : 0
	};
}

/** Bridge hook: apply a built-in profile id to a sim that supports flock presets. */
export interface BoidsProfileBridge {
	applyParams(next: BoidsParams): void;
	applyFlockPreset?(flock: FlockPreset): void;
	setProfileBaseline?(id: BoidsProfileId): void;
}

export function applyBoidsProfile(bridge: BoidsProfileBridge, id: BoidsProfileId): void {
	const { params, flock } = snapshotProfile(id);
	bridge.applyParams(params);
	bridge.applyFlockPreset?.(flock);
	bridge.setProfileBaseline?.(id);
}

export function applyActiveDefaultProfile(bridge: BoidsProfileBridge): void {
	applyBoidsProfile(bridge, ACTIVE_BOIDS_PROFILE_ID);
}

export function getActiveProfileSnapshot(): { params: BoidsParams; flock: FlockPreset } {
	return snapshotProfile(ACTIVE_BOIDS_PROFILE_ID);
}

export function getProfileNote(id: BoidsProfileId): string {
	return getBoidsProfile(id).note;
}
