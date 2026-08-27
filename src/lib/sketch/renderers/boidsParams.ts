/**
 * Live-tunable boids settings. Shared between the renderer and the UI panel.
 * Mutate properties in place — the sim reads them each frame.
 *
 * Hardcoded snapshots live in `boidsProfiles.ts` — DEFAULT tracks the active profile.
 */
import { ACTIVE_MURMUR_FLOCK, snapshotFlockPreset, type FlockPreset } from '../../boids/flockSeparation.ts';
import {
	ACTIVE_BOIDS_PROFILE_ID,
	snapshotProfile,
	snapshotProfileParams
} from './boidsProfiles.ts';
export type { BoidsProfileId } from './boidsProfiles.ts';
export {
	applyActiveDefaultProfile,
	applyBoidsProfile,
	type BoidsProfileBridge
} from './boidsDynamic.ts';

export { DEFAULT_BOID_COUNT, clampBoidCount } from '../../boids/boidCount.ts';
export { DEFAULT_GPU_BOID_COUNT, MAX_BOID_COUNT, MIN_BOID_COUNT } from '../../gpu/constants.ts';

export type CenterBiasFalloff = 'linear' | 'quadratic';

export interface BoidsParams {
	/** Debug: draw per-note counts. */
	showCounts: boolean;
	/** Debug: draw Perlin wind field arrows. */
	showWindField: boolean;
	/** Spacing of wind-field sample points (px). */
	windFieldStep: number;
	/** Wind arrow length scale. */
	windFieldScale: number;

	/** Apply Perlin wind forces. */
	windEnabled: boolean;
	/** Wind force on lit boids. */
	windForce: number;
	/** Wind force on idle / blank boids. */
	windForceIdle: number;
	/** Noise cycles across the shorter canvas edge. */
	windSpatial: number;
	/** Noise units per millisecond (time dimension). */
	windTime: number;
	/** How many full rotations noise maps into. */
	windAngleTurns: number;
	/** Perlin wind on lit (assigned) boids. */
	windAffectsLit: boolean;
	/** Perlin wind on dead / idle boids. */
	windAffectsDead: boolean;

	/** Soft pull toward canvas center (stronger near edges). */
	centerBiasEnabled: boolean;
	/** Center bias on lit boids. */
	centerBiasAffectsLit: boolean;
	/** Center bias on dead / idle boids. */
	centerBiasAffectsDead: boolean;
	/** Overall center-bias force weight. */
	centerBiasStrength: number;
	/** Shape of distance → force: linear or quadratic before the exponent. */
	centerBiasFalloffMode: CenterBiasFalloff;
	/** Steepness exponent on the shaped distance (1 = as-shaped). */
	centerBiasFalloff: number;

	blankRepel: number;
	blankRepelRadius: number;
	/** Accumulation weight when two dead/blank boids overlap. */
	blankBlankRepelWeight: number;
	/** Extra blank↔blank shove when any color is within nearMax of quota. */
	blankRepelNearMaxBoost: number;
	huntRadius: number;
	huntBlankAttract: number;
	huntColorAttract: number;
	/** Blank boids seek lit groups below the near-max quota band; scales up as blanks get scarce. */
	blankSeekAttract: number;
	huntBelowFrac: number;
	preyAboveFrac: number;

	infectIntervalFrames: number;
	infectRadius: number;
	/** Max successful infections per note color per infection tick. */
	infectMaxPerColor: number;
	/** Start spontaneous dead→note infection when count is below this quota fraction. */
	spontaneousInfectThreshold: number;
	/** Per needy color, chance each infection tick to ignite a random dead boid. */
	spontaneousInfectChance: number;
	stealBelowFrac: number;
	nearMaxFrac: number;
	minHoldFrac: number;

	exchangeIntervalFrames: number;
	exchangeChance: number;

	chordRepelMs: number;
	chordRepelForce: number;
	chordRepelSep: number;
	chordRepelSepRadius: number;
	chordRepelSpeedBoost: number;

	litFadeRate: number;
	litRiseRate: number;
	idleAlphaBase: number;
	idleAlphaPulse: number;
	/** Multiplier on glow disc radius (1 = default). */
	glowPointSize: number;
	/** How much speed shrinks point size (0 = constant size, 1 = full shrink when fast). */
	glowSpeedSize: number;

	maxSpeedAssigned: number;
	maxSpeedIdle: number;
	minSpeedIdle: number;
	/**
	 * Quadratic speed drag. Higher = more resistance as speed approaches maxSpeed
	 * (soft asymptote). 0 = hard clamp only (legacy).
	 */
	speedDrag: number;
	/** Total boids in the sim; changing re-seeds the flock. */
	boidCount: number;
}

/** Active hardcoded profile — also used by Reset defaults. */
export const DEFAULT_BOIDS_PARAMS: Readonly<BoidsParams> = snapshotProfileParams(
	ACTIVE_BOIDS_PROFILE_ID
);

/** Active flock preset bundled with the default profile. */
export const DEFAULT_FLOCK_PRESET: Readonly<FlockPreset> = snapshotFlockPreset(
	ACTIVE_MURMUR_FLOCK
);

export function snapshotDefaultProfile(): { params: BoidsParams; flock: FlockPreset } {
	return snapshotProfile(ACTIVE_BOIDS_PROFILE_ID);
}

const SAVED_STORAGE = 'p5-playground:boidsParams:saved';

export interface BoidsPresetBundle {
	params: BoidsParams;
	flock?: FlockPreset;
}

function logPresetBundle(action: 'save' | 'load', name: string, bundle: BoidsPresetBundle): void {
	const payload = JSON.parse(JSON.stringify(bundle)) as BoidsPresetBundle;
	console.log(`[boids/preset] ${action} "${name}"`, payload);
	if (action === 'load') {
		console.info('[boids/preset] dynamic population tuning disabled until Reset defaults or Load built-in profile');
	}
}

function isCenterBiasFalloff(value: unknown): value is CenterBiasFalloff {
	return value === 'linear' || value === 'quadratic';
}

/** Merge unknown JSON onto defaults; ignore bad fields. */
export function coerceBoidsParams(raw: unknown): BoidsParams {
	const out: BoidsParams = { ...DEFAULT_BOIDS_PARAMS };
	if (!raw || typeof raw !== 'object') return out;
	const src = raw as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_BOIDS_PARAMS) as (keyof BoidsParams)[]) {
		const value = src[key as string];
		if (value === undefined) continue;
		const def = DEFAULT_BOIDS_PARAMS[key];
		if (typeof def === 'boolean' && typeof value === 'boolean') {
			out[key] = value as never;
		} else if (typeof def === 'number' && typeof value === 'number' && Number.isFinite(value)) {
			out[key] = value as never;
		} else if (key === 'centerBiasFalloffMode' && isCenterBiasFalloff(value)) {
			out.centerBiasFalloffMode = value;
		}
	}
	return out;
}

/** Merge `next` onto a live params object (renderer instance). */
export function applyBoidsParams(target: BoidsParams, next: BoidsParams): void {
	Object.assign(target, next);
}

export function resetBoidsParams(target: BoidsParams): void {
	applyBoidsParams(target, { ...DEFAULT_BOIDS_PARAMS });
}

export function snapshotBoidsParams(params: BoidsParams): BoidsParams {
	return { ...params };
}

export function listSavedBoidsPresets(): string[] {
	try {
		const raw = localStorage.getItem(SAVED_STORAGE);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!parsed || typeof parsed !== 'object') return [];
		return Object.keys(parsed).sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

function readSavedMap(): Record<string, unknown> {
	try {
		const raw = localStorage.getItem(SAVED_STORAGE);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object') return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function saveBoidsPreset(
	name: string,
	params: BoidsParams,
	flock?: FlockPreset
): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	try {
		const map = readSavedMap();
		const bundle: BoidsPresetBundle = {
			params: { ...params },
			...(flock ? { flock: snapshotFlockPreset(flock) } : {})
		};
		map[trimmed] = bundle;
		localStorage.setItem(SAVED_STORAGE, JSON.stringify(map));
		logPresetBundle('save', trimmed, bundle);
		return true;
	} catch {
		return false;
	}
}

export function loadBoidsPresetBundle(name: string): BoidsPresetBundle | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	try {
		const map = readSavedMap();
		if (!(trimmed in map)) return null;
		const raw = map[trimmed];
		if (raw && typeof raw === 'object' && 'params' in raw) {
			const bundle: BoidsPresetBundle = {
				params: coerceBoidsParams((raw as BoidsPresetBundle).params),
				flock:
					(raw as BoidsPresetBundle).flock != null
						? snapshotFlockPreset((raw as BoidsPresetBundle).flock as FlockPreset)
						: undefined
			};
			logPresetBundle('load', trimmed, bundle);
			return bundle;
		}
		const legacy: BoidsPresetBundle = { params: coerceBoidsParams(raw) };
		logPresetBundle('load', trimmed, legacy);
		return legacy;
	} catch {
		return null;
	}
}

export function loadBoidsPreset(name: string): BoidsParams | null {
	return loadBoidsPresetBundle(name)?.params ?? null;
}

export function deleteBoidsPreset(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	try {
		const map = readSavedMap();
		if (!(trimmed in map)) return false;
		delete map[trimmed];
		localStorage.setItem(SAVED_STORAGE, JSON.stringify(map));
		return true;
	} catch {
		return false;
	}
}
