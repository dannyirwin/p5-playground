/** Shared flock tuning — CPU engine + WebGPU sim read these. */
export const FLOCK_ALIGNMENT = 2.25;
export const FLOCK_COHESION = 0.82;
export const FLOCK_ALI_RADIUS = 108;
export const FLOCK_COH_RADIUS = 76;

export const FLOCK_SEPARATION = {
	/** General separation weight (mixed idle neighbors). */
	idle: 2.05,
	/** Same-note separation — tight murmuration clumps. */
	same: 0.52,
	/** Lit boids: scale separation from blanks / unlike neighbors. */
	assignedIdleMul: 0.38,
	/** Lit boids: extra scale on same-note separation. */
	assignedSameMul: 0.68,
	/** Lit↔lit different-color repulsion weight. */
	diff: 1.65,
	/** Lateral / lane-keep blend on cross-color sep (0 = radial only). */
	diffLateral: 0.7,
	/** Separation radius for unlike / idle pairs (px). */
	radiusIdle: 34,
	/** Separation radius for same-note pairs (px). */
	radiusSame: 20,
	/** Separation radius for lit different-color pairs (px). */
	radiusDiff: 52
} as const;

/** Lit-boid steering caps / multipliers. */
export const FLOCK_ASSIGNED = {
	aliMul: 1.68,
	cohMul: 1.08,
	maxForce: 0.28,
	minSpeed: 2.5
} as const;

/**
 * Dead↔dead flocking — alignment-led flow, soft cohesion, gentle turns.
 * Tuned with profile `dead-murmur-v1` (vector field off).
 */
export const FLOCK_BLANK = {
	/** Velocity matching — primary murmuration driver for blanks. */
	blankBlankAliMul: 0.72,
	/** Soft pull into loose ribbons (not dense balls). */
	blankBlankCohMul: 0.28,
	/** Steering budget vs idle maxForce (lower = less jitter). */
	forceMul: 0.32,
	/** Scale idle separation when both boids are blank. */
	sepIdleMul: 0.55
} as const;

/** Velocity kick when a dead boid converts to lit (infection / voicing). */
export interface ConvertBoostPreset {
	surge: number;
	outward: number;
	cap: number;
	/** Blend toward carrier velocity (0 = old radial spike, 1 = full inherit). */
	carrierBlend: number;
}

/** Global steering caps applied after all forces sum. */
export interface SteeringCaps {
	/** Max total force for lit boids (multiplier on per-steer maxForce). */
	globalForceCapLit: number;
	/** Max total force for blank boids. */
	globalForceCapBlank: number;
	/** Velocity blend toward new heading (playing). */
	steeringSmoothPlaying: number;
	/** Velocity blend toward new heading (blank). */
	steeringSmoothBlank: number;
}

export interface FlockPreset {
	alignment: number;
	cohesion: number;
	aliRadius: number;
	cohRadius: number;
	separation: {
		idle: number;
		same: number;
		diff: number;
		diffLateral: number;
		assignedIdleMul: number;
		assignedSameMul: number;
		radiusIdle: number;
		radiusSame: number;
		radiusDiff: number;
	};
	assigned: {
		aliMul: number;
		cohMul: number;
		maxForce: number;
		minSpeed: number;
	};
	blank: {
		blankBlankAliMul: number;
		blankBlankCohMul: number;
		forceMul: number;
		sepIdleMul: number;
	};
	convert: ConvertBoostPreset;
	steering: SteeringCaps;
	/** Base idle max force (before blank forceMul). */
	maxForceIdle: number;
}

export function snapshotFlockPreset(source: FlockPreset): FlockPreset {
	return {
		alignment: source.alignment,
		cohesion: source.cohesion,
		aliRadius: source.aliRadius,
		cohRadius: source.cohRadius,
		separation: { ...source.separation },
		assigned: { ...source.assigned },
		blank: { ...source.blank },
		convert: { ...source.convert },
		steering: { ...source.steering },
		maxForceIdle: source.maxForceIdle
	};
}

/** Default flock preset — matches legacy `dead-murmur-v1` constants. */
export const DEFAULT_FLOCK_PRESET: FlockPreset = {
	alignment: FLOCK_ALIGNMENT,
	cohesion: FLOCK_COHESION,
	aliRadius: FLOCK_ALI_RADIUS,
	cohRadius: FLOCK_COH_RADIUS,
	separation: { ...FLOCK_SEPARATION },
	assigned: { ...FLOCK_ASSIGNED },
	blank: { ...FLOCK_BLANK },
	convert: { surge: 1.85, outward: 1.35, cap: 8.5, carrierBlend: 0 },
	steering: {
		globalForceCapLit: 1.0,
		globalForceCapBlank: 0.85,
		steeringSmoothPlaying: 1.0,
		steeringSmoothBlank: 1.0
	},
	maxForceIdle: 0.2
};

/** Active murmuration preset — alignment-led lanes, soft cross-color lane-keep. */
export const ACTIVE_MURMUR_FLOCK: FlockPreset = {
	alignment: 3.3,
	cohesion: 0.66,
	aliRadius: 88,
	cohRadius: 58,
	separation: {
		idle: 2.65,
		same: 0.88,
		diff: 1.3,
		diffLateral: 1.35,
		assignedIdleMul: FLOCK_SEPARATION.assignedIdleMul,
		assignedSameMul: 0.96,
		radiusIdle: 50,
		radiusSame: 80,
		radiusDiff: 31
	},
	assigned: {
		aliMul: 2.06,
		cohMul: 1.8,
		maxForce: 0.31,
		minSpeed: 0.05
	},
	blank: {
		blankBlankAliMul: 0.24,
		blankBlankCohMul: 0.04,
		forceMul: 0.34,
		sepIdleMul: 1.12
	},
	convert: { surge: 0.55, outward: 0.2, cap: 3.2, carrierBlend: 0.78 },
	steering: {
		globalForceCapLit: 0.78,
		globalForceCapBlank: 0.92,
		steeringSmoothPlaying: 0.26,
		steeringSmoothBlank: 0.26
	},
	maxForceIdle: 0.54
};

/** Lit-only experiment — slightly tighter ribbons than active default. */
export const LIT_MURMUR_FLOCK: FlockPreset = {
	...snapshotFlockPreset(ACTIVE_MURMUR_FLOCK),
	assigned: {
		aliMul: 1.0,
		cohMul: 0.35,
		maxForce: 0.2,
		minSpeed: 0.05
	},
	separation: {
		...ACTIVE_MURMUR_FLOCK.separation,
		same: 2.1,
		diff: 8,
		assignedSameMul: 2,
		radiusSame: 76,
		radiusDiff: 120
	}
};
