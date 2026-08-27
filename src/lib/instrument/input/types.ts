import type { HandSnapshot } from '../hands.ts';
import type { QualityName } from '../quality.ts';

export type DegreeTilt = 'inward' | 'outward' | 'neutral';
export type DegreeFacing = 'cam' | 'away' | null;

/** Settled musical intent after debounce — shared by HUD, harmony, sim, and player. */
export interface MusicalIntent {
	degree: number | null;
	quality: QualityName | null;
	bassMode: boolean;
	/** Whether the latched bass toggle is in the current voicing. */
	bassActive: boolean;
	tilt: DegreeTilt;
	degreeFacing: DegreeFacing;
	voicingAnchorY: number;
	follower: { x: number; y: number };
}

/** Raw per-frame gesture readings for HUD / debug. */
export interface RawGestureState {
	rawDegree: number;
	rawQuality: QualityName;
	degreeTilt: DegreeTilt;
	degreeFacing: DegreeFacing;
	modFacing: DegreeFacing;
	qualitySource: 'mod' | 'triad' | 'none';
	handsDetected: number;
}

export type InputEvent =
	| { kind: 'bassToggled'; enabled: boolean }
	| { kind: 'handsLost' };

export interface InputUpdate {
	intent: MusicalIntent;
	raw: RawGestureState;
	events: InputEvent[];
	/** True when chord/quality gesture has held steady long enough to commit audio. */
	harmonySettled: boolean;
	/** 0–1 progress toward the current pose committing. */
	settleProgress: number;
}

export interface InputRecognizerConfig {
	settleFrames: number;
	voicingSettleFrames: number;
	voicingSettleY: number;
	voicingCommitDeadzone: number;
}

export interface InputRecognizer {
	update(
		hands: readonly HandSnapshot[],
		rootPc: number,
		mode: string,
		canvasWidth: number,
		canvasHeight: number,
		captureWidth: number,
		captureHeight: number,
		nowMs: number,
		deltaMs: number
	): InputUpdate;
	reset(): void;
	/** Optional — host seeds follower when canvas is first sized. */
	seedFollower?(x: number, y: number): void;
}
