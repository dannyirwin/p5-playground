/** Float offsets in the packed boid instance buffer (12 floats per boid). */
export const BOID_FLOATS = 12;

export const BoidGpuState = {
	pos: 0,
	vel: 2,
	lit: 4,
	targetMidi: 5,
	ghostMidi: 6,
	glowSize: 7,
	glowBright: 8,
	glowPhase: 9,
	glowRate: 10,
	speedTrait: 11
} as const;

export const BOID_BYTES = BOID_FLOATS * 4;
