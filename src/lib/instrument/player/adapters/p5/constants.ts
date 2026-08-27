export const RELEASE_TIME = 0.45;
export const RELEASE_STOP_MS = 520;
export const BOID_INTENSITY_RAMP = 0.12;
export const BOID_INTENSITY_FLOOR = 0.3;
export const INTENSITY_RISE_SEC = 2;
export const INTENSITY_FALL_SEC = 1.1;
export const BOID_RELEASE_TIME = 0.22;

/** Infection chimes — thinned + dripped, not 1:1 with converts. */
export const CONVERT_PING_AMP = 0.07;
export const CONVERT_PING_ATTACK = 0.009;
export const CONVERT_PING_RELEASE = 0.065;
export const CONVERT_PING_MS = 120;
export const CONVERT_PING_HZ_RATIO = 1.5;
export const CONVERT_PING_ADMIT = 0.2;
export const CONVERT_PING_POOL_MAX = 6;
export const CONVERT_PING_ACTIVITY_MS = 520;
export const CONVERT_PING_GAP_MIN_MS = 70;
export const CONVERT_PING_GAP_MAX_MS = 240;
export const MAX_CONVERT_PINGS_PER_WINDOW = 5;
export const CONVERT_PING_WINDOW_MS = 1000;
export const CONVERT_PING_ECHO: ReadonlyArray<{ delayMs: number; ampScale: number }> = [
	{ delayMs: 42, ampScale: 0.28 },
	{ delayMs: 78, ampScale: 0.09 }
];

export const ATTACK_PITCH_RATIO = 1.004;
export const ATTACK_PITCH_TIME = 0.06;
export const SOFT_ATTACK_PITCH_RATIO = 1.002;
export const SOFT_ATTACK_PITCH_TIME = 0.35;
export const ATTACK_AMP = 0.1;
export const SUSTAIN_AMP = 0.095;
export const ATTACK_AMP_TIME = 0.04;
export const DETUNE_RATIO = 1.004;
export const DETUNE_AMP = 0.034;
export const FILTER_CUTOFF = 920;
export const FILTER_RES = 8;
export const DRONE_PULSE_HZ = 0.085;
export const DRONE_PULSE_DEPTH = 0.065;
export const FILTER_BREATHE_HZ = 0.055;
export const FILTER_BREATHE_DEPTH = 90;
export const VOICE_WOBBLE_HZ = 0.11;
export const VOICE_WOBBLE_CENTS = 3.5;
export const DRONE_DISTORTION = 0.008;
export const DRONE_DISTORTION_AMP = 0.7;
/** Fixed level when intensity isn't sim-driven (strings). */
export const STATIC_DRONE_INTENSITY = 0.68;
export const REVERB_SECONDS = 4.2;
export const REVERB_DECAY = 5.5;
export const REVERB_DRYWET = 0.52;
export const REVERB_AMP = 0.72;
