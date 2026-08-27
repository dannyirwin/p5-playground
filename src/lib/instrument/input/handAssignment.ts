import type { HandSnapshot } from '../hands.ts';
import { dist } from '../math.ts';

/** Max distance between index MCPs as a fraction of average palm length. */
export const BASS_KNUCKLE_TAP_RATIO = 0.55;
export const BASS_DOUBLE_TAP_MS = 520;
export const BASS_TOGGLE_COOLDOWN_MS = 450;

/** Wrist→knuckle fraction for follower / octave Y (1 = at MCP knuckles; fingertips ignored). */
export const PALM_ANCHOR_ALONG = 1;

/** Anchor at the knuckle line (MCP average) — stable across open hand vs fist. */
export function palmAnchorCapture(hand: HandSnapshot): { x: number; y: number } {
	const kp = hand.keypoints;
	const wrist = kp[0]!;
	const knuckleX = (kp[5]!.x + kp[9]!.x + kp[13]!.x + kp[17]!.x) * 0.25;
	const knuckleY = (kp[5]!.y + kp[9]!.y + kp[13]!.y + kp[17]!.y) * 0.25;
	return {
		x: wrist.x + (knuckleX - wrist.x) * PALM_ANCHOR_ALONG,
		y: wrist.y + (knuckleY - wrist.y) * PALM_ANCHOR_ALONG
	};
}

export function palmCanvasDist(
	hand: HandSnapshot,
	canvasX: number,
	canvasY: number,
	toCanvasX: (captureX: number) => number,
	toCanvasY: (captureY: number) => number
): number {
	const anchor = palmAnchorCapture(hand);
	return dist(toCanvasX(anchor.x), toCanvasY(anchor.y), canvasX, canvasY);
}

/**
 * Chord hand owns the follower dot. With two hands, stick to whichever
 * is nearest the last chord target.
 */
export function assignChordAndModHands(
	detected: readonly HandSnapshot[],
	lastTargetX: number,
	lastTargetY: number,
	canvasWidth: number,
	captureWidth: number,
	toCanvasX: (captureX: number) => number,
	toCanvasY: (captureY: number) => number
): { chordHand: HandSnapshot | null; modHand: HandSnapshot | null } {
	if (detected.length === 0) return { chordHand: null, modHand: null };
	if (detected.length === 1) {
		return { chordHand: detected[0], modHand: null };
	}

	const palmDist = (hand: HandSnapshot) =>
		palmCanvasDist(hand, lastTargetX, lastTargetY, toCanvasX, toCanvasY);

	const left = detected.find((h) => h.handedness === 'Left');
	const nearest = detected.reduce((best, h) =>
		palmDist(h) < palmDist(best) ? h : best
	);

	const stickyRadius = canvasWidth * (160 / captureWidth);
	const nearTrack = detected.some((h) => palmDist(h) < stickyRadius);
	const chordHand = nearTrack ? nearest : (left ?? nearest);
	const modHand = detected.find((h) => h !== chordHand) ?? null;
	return { chordHand, modHand };
}

/** True when both hands' index MCPs (landmark 5) are close in capture space. */
export function indexKnucklesTogether(detected: readonly HandSnapshot[]): boolean {
	if (detected.length < 2) return false;
	const a = detected[0].keypoints[5];
	const b = detected[1].keypoints[5];
	const palmA = dist(
		detected[0].keypoints[0].x,
		detected[0].keypoints[0].y,
		detected[0].keypoints[9].x,
		detected[0].keypoints[9].y
	);
	const palmB = dist(
		detected[1].keypoints[0].x,
		detected[1].keypoints[0].y,
		detected[1].keypoints[9].x,
		detected[1].keypoints[9].y
	);
	const scale = (palmA + palmB) / 2;
	if (scale < 1) return false;
	return dist(a.x, a.y, b.x, b.y) < scale * BASS_KNUCKLE_TAP_RATIO;
}

export interface BassGestureState {
	bassMode: boolean;
	knucklesTogether: boolean;
	tapTimes: number[];
	cooldownUntil: number;
}

export interface BassGestureUpdate {
	state: BassGestureState;
	toggled: boolean;
	together: boolean;
}

/** Bass toggle via double-tap of index knuckles. */
export function updateBassGesture(
	detected: readonly HandSnapshot[],
	state: BassGestureState,
	nowMs: number
): BassGestureUpdate {
	const together = indexKnucklesTogether(detected);
	const next = { ...state, knucklesTogether: together };

	if (nowMs < state.cooldownUntil) {
		return { state: next, toggled: false, together };
	}

	if (together && !state.knucklesTogether) {
		next.knucklesTogether = true;
	} else if (!together && state.knucklesTogether) {
		next.knucklesTogether = false;
		const tapTimes = state.tapTimes.filter(
			(t) => nowMs - t <= BASS_DOUBLE_TAP_MS
		);
		tapTimes.push(nowMs);
		if (tapTimes.length >= 2) {
			next.bassMode = !state.bassMode;
			next.tapTimes = [];
			next.cooldownUntil = nowMs + BASS_TOGGLE_COOLDOWN_MS;
			return { state: next, toggled: true, together };
		}
		next.tapTimes = tapTimes;
	}

	return { state: next, toggled: false, together };
}
