/** Byte size of the GPU sim uniform block (must match WGSL `SimUniforms`). */
export const SIM_UNIFORM_BYTES = 512;

/**
 * f32 slot indices in the uniform block.
 * Must match `SimUniforms` field order in flocking.wgsl.ts byte-for-byte
 * (mixed f32/u32, no implicit padding between 4-byte fields).
 */
export const SIM_F = {
	width: 0,
	height: 1,
	deltaTime: 2,
	millis: 3,
	cellSize: 6,
	quota: 11,
	repelPhase: 12,
	sepRadiusIdle: 13,
	sepRadiusSame: 14,
	aliRadius: 15,
	cohRadius: 16,
	blankRepelRadius: 17,
	huntRadius: 18,
	chordSepRadius: 19,
	sepIdle: 20,
	sepSame: 21,
	aliWeight: 22,
	cohWeight: 23,
	blankRepel: 24,
	huntBlankAttract: 25,
	huntColorAttract: 26,
	blankSeekAttract: 27,
	chordRepelSep: 28,
	chordRepelForce: 29,
	huntBelowFrac: 30,
	preyAboveFrac: 31,
	nearMaxFrac: 32,
	stealBelowFrac: 33,
	minHoldFrac: 34,
	minSpeedIdle: 35,
	maxForceAssigned: 36,
	maxForceIdle: 37,
	chordRepelSpeedBoost: 38,
	windForce: 39,
	windForceIdle: 40,
	windEnabled: 41,
	centerStrength: 42,
	centerFalloff: 43,
	centerQuadratic: 44,
	centerEnabled: 45,
	litFadeRate: 46,
	litRiseRate: 47,
	maxSpeedAssigned: 48,
	maxSpeedIdle: 49,
	blankBlankRepelWeight: 50,
	blankRepelNearMaxBoost: 51,
	blankBlankAliMul: 52,
	blankBlankCohMul: 53,
	blankForceMul: 54,
	blankSepIdleMul: 55,
	aliAssignedMul: 56,
	cohAssignedMul: 57,
	sepAssignedIdleMul: 58,
	sepAssignedSameMul: 59,
	minSpeedPlaying: 60,
	globalForceCapLit: 61,
	globalForceCapBlank: 62,
	steeringSmoothPlaying: 63,
	steeringSmoothBlank: 64,
	windSpatial: 65,
	windTime: 66,
	windAngleTurns: 67,
	notes0: 68,
	notes1: 69,
	notes2: 70,
	notes3: 71,
	notes4: 72,
	notes5: 73,
	notes6: 74,
	windAffectsLit: 76,
	windAffectsDead: 77,
	centerAffectsLit: 78,
	centerAffectsDead: 79,
	sepDiff: 80,
	sepRadiusDiff: 81,
	sepDiffLateral: 82,
	speedDrag: 83
} as const;

/** u32 slot indices (same ArrayBuffer, Uint32Array view). */
export const SIM_U = {
	gridCols: 4,
	gridRows: 5,
	boidCount: 7,
	maxPerCell: 8,
	noteCount: 9,
	bassActive: 10
} as const;

/** Stats buffer: 128 MIDI buckets + blank counter. */
export const MIDI_COUNT_SLOTS = 128;
export const STATS_BLANK_INDEX = 128;
export const STATS_BUFFER_U32S = 129;
