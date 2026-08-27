/** How long a pose must hold before audio commits (ms). */
export const SETTLE_MS = {
	/** Fist / release — quick silence, but ignore brief 0 flicker. */
	release: 70,
	/** Degree change — longest guard against wrong chord in transition. */
	chord: 115,
	/** Quality / extension change only. */
	quality: 85
} as const;

/** Audio commit key — degree + quality only (tilt/facing excluded so they don't reset settle). */
export function settleKey(rawDegree: number, rawQuality: string): string {
	return `${rawDegree}|${rawQuality}`;
}

/** @deprecated Use settleKey — kept for any external references. */
export function harmonyKey(
	rawChordId: number,
	_degreeTilt: string,
	_degreeFacing: boolean | null,
	rawQuality: string
): string {
	return settleKey(rawChordId, rawQuality);
}

export interface SettleState {
	lastKey: string;
	stableMs: number;
}

export function requiredSettleMs(key: string, previousKey: string): number {
	const [degStr] = key.split('|');
	const degree = Number(degStr);
	if (degree === 0) return SETTLE_MS.release;

	const [prevDegStr, prevQual] = previousKey.split('|');
	const prevDegree = Number(prevDegStr);
	if (prevDegree !== degree) return SETTLE_MS.chord;

	const [, qual] = key.split('|');
	if (qual !== prevQual) return SETTLE_MS.quality;

	return SETTLE_MS.chord;
}

export function settleProgress(stableMs: number, requiredMs: number): number {
	if (requiredMs <= 0) return 1;
	return Math.min(1, stableMs / requiredMs);
}

export function tickHarmonySettle(
	key: string,
	state: SettleState,
	deltaMs: number
): {
	state: SettleState;
	settled: boolean;
	requiredMs: number;
	progress: number;
} {
	const clampedDelta = Math.min(50, Math.max(0, deltaMs));

	if (key === state.lastKey) {
		const stableMs = state.stableMs + clampedDelta;
		const requiredMs = requiredSettleMs(key, state.lastKey);
		const settled = stableMs >= requiredMs;
		return {
			state: { lastKey: key, stableMs: settled ? requiredMs : stableMs },
			settled,
			requiredMs,
			progress: settleProgress(stableMs, requiredMs)
		};
	}

	const requiredMs = requiredSettleMs(key, state.lastKey);
	return {
		state: { lastKey: key, stableMs: 0 },
		settled: false,
		requiredMs,
		progress: 0
	};
}
