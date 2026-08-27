import type { FlockPreset } from '../../boids/flockSeparation.ts';
import { DEFAULT_BOID_COUNT } from '../../boids/boidCount.ts';
import {
	ACTIVE_MURMUR_FLOCK,
	DEFAULT_FLOCK_PRESET,
	LIT_MURMUR_FLOCK,
	snapshotFlockPreset
} from '../../boids/flockSeparation.ts';
import type { BoidsParams } from './boidsParams.ts';

/**
 * Hardcoded boids param snapshots we can roll back to while tuning.
 * Each profile bundles runtime params + flock preset (steering constants).
 */
export type BoidsProfileId =
	| 'field-chase-v1'
	| 'dead-murmur-v1'
	| 'active-murmur-v1'
	| 'lit-murmur-v1';

export interface BoidsProfile {
	id: BoidsProfileId;
	label: string;
	/** Short note for the panel / future us. */
	note: string;
	params: Readonly<BoidsParams>;
	flock: Readonly<FlockPreset>;
}

/** Snapshot of the aggressive field + proximity-infect era (Aug 2026). */
const FIELD_CHASE_V1: Readonly<BoidsParams> = {
	showCounts: true,
	showWindField: false,
	windFieldStep: 48,
	windFieldScale: 18,

	windEnabled: true,
	windForce: 0.42,
	windForceIdle: 0.45,
	windSpatial: 2.4,
	windTime: 0.00012,
	windAngleTurns: 2,
	windAffectsLit: true,
	windAffectsDead: true,

	centerBiasEnabled: true,
	centerBiasAffectsLit: true,
	centerBiasAffectsDead: false,
	centerBiasStrength: 0.52,
	centerBiasFalloffMode: 'quadratic',
	centerBiasFalloff: 1.2,

	blankRepel: 0.28,
	blankRepelRadius: 64,
	blankBlankRepelWeight: 3.8,
	blankRepelNearMaxBoost: 1.85,
	huntRadius: 130,
	huntBlankAttract: 0.36,
	huntColorAttract: 0.16,
	blankSeekAttract: 0.42,
	huntBelowFrac: 0.6,
	preyAboveFrac: 0.72,

	infectIntervalFrames: 1,
	infectRadius: 78,
	infectMaxPerColor: 16,
	spontaneousInfectThreshold: 0.18,
	spontaneousInfectChance: 0.06,
	stealBelowFrac: 0.5,
	nearMaxFrac: 0.05,
	minHoldFrac: 0.2,

	exchangeIntervalFrames: 40,
	exchangeChance: 0.28,

	chordRepelMs: 480,
	chordRepelForce: 1.35,
	chordRepelSep: 1.05,
	chordRepelSepRadius: 56,
	chordRepelSpeedBoost: 1.45,

	litFadeRate: 0.018,
	litRiseRate: 0.045,
	idleAlphaBase: 0.16,
	idleAlphaPulse: 0.14,
	glowPointSize: 1,
	glowSpeedSize: 1,

	maxSpeedAssigned: 6.8,
	maxSpeedIdle: 3.4,
	minSpeedIdle: 0.85,
	speedDrag: 0,
	boidCount: DEFAULT_BOID_COUNT
};

/**
 * Dead-first murmuration pass: no wind/center field, smoother blank speeds,
 * softer blank↔blank shove, proximity infect still available when lit.
 */
const DEAD_MURMUR_V1: Readonly<BoidsParams> = {
	showCounts: true,
	showWindField: false,
	windFieldStep: 48,
	windFieldScale: 18,

	windEnabled: false,
	windForce: 0.42,
	windForceIdle: 0.45,
	windSpatial: 2.4,
	windTime: 0.00012,
	windAngleTurns: 2,
	windAffectsLit: true,
	windAffectsDead: true,

	centerBiasEnabled: false,
	centerBiasAffectsLit: true,
	centerBiasAffectsDead: false,
	centerBiasStrength: 0.52,
	centerBiasFalloffMode: 'quadratic',
	centerBiasFalloff: 1.2,

	blankRepel: 0.18,
	blankRepelRadius: 88,
	blankBlankRepelWeight: 1.6,
	blankRepelNearMaxBoost: 1.25,
	huntRadius: 130,
	huntBlankAttract: 0.36,
	huntColorAttract: 0.16,
	blankSeekAttract: 0.42,
	huntBelowFrac: 0.6,
	preyAboveFrac: 0.72,

	infectIntervalFrames: 1,
	infectRadius: 78,
	infectMaxPerColor: 16,
	spontaneousInfectThreshold: 0.18,
	spontaneousInfectChance: 0.06,
	stealBelowFrac: 0.5,
	nearMaxFrac: 0.05,
	minHoldFrac: 0.2,

	exchangeIntervalFrames: 40,
	exchangeChance: 0.28,

	chordRepelMs: 480,
	chordRepelForce: 1.35,
	chordRepelSep: 1.05,
	chordRepelSepRadius: 56,
	chordRepelSpeedBoost: 1.45,

	litFadeRate: 0.018,
	litRiseRate: 0.045,
	idleAlphaBase: 0.16,
	idleAlphaPulse: 0.14,
	glowPointSize: 1,
	glowSpeedSize: 1,

	maxSpeedAssigned: 6.8,
	maxSpeedIdle: 2.2,
	minSpeedIdle: 1.35,
	speedDrag: 0,
	boidCount: DEFAULT_BOID_COUNT
};

/** Combined dead + lit murmuration — active default. */
const ACTIVE_MURMUR_V1: Readonly<BoidsParams> = {
	showCounts: true,
	showWindField: false,
	windFieldStep: 24,
	windFieldScale: 18,

	windEnabled: true,
	windForce: 1.8,
	windForceIdle: 3.05,
	windSpatial: 1.8,
	windTime: 0.00014,
	windAngleTurns: 1.5,
	windAffectsLit: true,
	windAffectsDead: false,

	centerBiasEnabled: true,
	centerBiasAffectsLit: true,
	centerBiasAffectsDead: false,
	centerBiasStrength: 0.65,
	centerBiasFalloffMode: 'quadratic',
	centerBiasFalloff: 0.7,

	blankRepel: 0.38,
	blankRepelRadius: 124,
	blankBlankRepelWeight: 3.75,
	blankRepelNearMaxBoost: 1.25,
	huntRadius: 130,
	huntBlankAttract: 0.0003,
	huntColorAttract: 0.12,
	blankSeekAttract: 0.0005,
	huntBelowFrac: 0.048,
	preyAboveFrac: 0.72,

	infectIntervalFrames: 4,
	infectRadius: 14,
	infectMaxPerColor: 24,
	spontaneousInfectThreshold: 0.32,
	spontaneousInfectChance: 0.19,
	stealBelowFrac: 0.5,
	nearMaxFrac: 0.05,
	minHoldFrac: 0.2,

	exchangeIntervalFrames: 40,
	exchangeChance: 0.28,

	chordRepelMs: 480,
	chordRepelForce: 1.35,
	chordRepelSep: 1.05,
	chordRepelSepRadius: 56,
	chordRepelSpeedBoost: 1.08,

	litFadeRate: 0.018,
	litRiseRate: 0.04,
	idleAlphaBase: 0.16,
	idleAlphaPulse: 0.14,
	glowPointSize: 1.35,
	glowSpeedSize: 0.35,

	maxSpeedAssigned: 6.95,
	maxSpeedIdle: 3.7,
	minSpeedIdle: 0,
	speedDrag: 0.25,
	boidCount: DEFAULT_BOID_COUNT
};

/** Lit-only experiment — same params as active, lit flock preset differs. */
const LIT_MURMUR_V1_PARAMS: Readonly<BoidsParams> = { ...ACTIVE_MURMUR_V1 };

export const BOIDS_PROFILES: readonly BoidsProfile[] = [
	{
		id: 'active-murmur-v1',
		label: 'Active murmur v1',
		note: 'Default. Toroidal wind, soft center pull, cross-color lane-keep.',
		params: ACTIVE_MURMUR_V1,
		flock: ACTIVE_MURMUR_FLOCK
	},
	{
		id: 'lit-murmur-v1',
		label: 'Lit murmur v1',
		note: 'Experiment: tighter same-note flocks, higher alignment.',
		params: LIT_MURMUR_V1_PARAMS,
		flock: LIT_MURMUR_FLOCK
	},
	{
		id: 'dead-murmur-v1',
		label: 'Dead murmur v1',
		note: 'Archive: dead-first pass before lit ribbon tuning.',
		params: DEAD_MURMUR_V1,
		flock: DEFAULT_FLOCK_PRESET
	},
	{
		id: 'field-chase-v1',
		label: 'Field chase v1',
		note: 'Archive: wind + center on, fast infect, prior default.',
		params: FIELD_CHASE_V1,
		flock: DEFAULT_FLOCK_PRESET
	}
];

export const ACTIVE_BOIDS_PROFILE_ID: BoidsProfileId = 'active-murmur-v1';

export function getBoidsProfile(id: BoidsProfileId): BoidsProfile {
	const found = BOIDS_PROFILES.find((p) => p.id === id);
	if (!found) throw new Error(`Unknown boids profile: ${id}`);
	return found;
}

export function snapshotProfileParams(id: BoidsProfileId): BoidsParams {
	return { ...getBoidsProfile(id).params };
}

export function snapshotProfileFlock(id: BoidsProfileId): FlockPreset {
	return snapshotFlockPreset(getBoidsProfile(id).flock);
}

export function snapshotProfile(id: BoidsProfileId): {
	params: BoidsParams;
	flock: FlockPreset;
} {
	const profile = getBoidsProfile(id);
	return {
		params: { ...profile.params },
		flock: snapshotFlockPreset(profile.flock)
	};
}
