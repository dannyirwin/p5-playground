import {
	diatonicTriadQuality,
	type ScaleMode,
	type TriadQuality
} from '../harmony/scales.ts';
import type { HandKeypoint, HandSnapshot } from '../hands.ts';
import { dist } from '../math.ts';
import type { QualityName } from '../quality.ts';

import type { DegreeTilt } from './types.ts';

/**
 * Camera-facing degree poses (fingers generally up). Returns 1-7, or 0
 * for fist / unrecognized (release).
 */
export function classifyDegree(hand: HandSnapshot): number {
	const kp = hand.keypoints;
	const wrist = kp[0];
	const scale = dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
	if (scale < 1) return 0;

	const d = (a: HandKeypoint, b: HandKeypoint) => dist(a.x, a.y, b.x, b.y);
	const up = (tip: number, pip: number) =>
		d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.08;
	const thumbPinkyTouch = d(kp[4], kp[20]) < scale * 0.48;

	const indexUp = up(8, 6);
	const middleUp = up(12, 10);
	const ringUp = up(16, 14);
	const pinkyUp = up(20, 18);
	const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.08;
	const fingerUps = [indexUp, middleUp, ringUp, pinkyUp];
	const upCount = fingerUps.filter(Boolean).length;

	if (thumbOut && upCount === 0) return 7;
	if (upCount === 1 && indexUp) return 1;
	if (upCount === 2 && indexUp && middleUp) return 2;
	if (
		!thumbOut &&
		indexUp &&
		pinkyUp &&
		!middleUp &&
		!ringUp &&
		upCount === 2
	) {
		return 6;
	}
	if (
		indexUp &&
		middleUp &&
		ringUp &&
		!pinkyUp &&
		thumbPinkyTouch &&
		upCount === 3
	) {
		return 3;
	}
	if (upCount === 4) return thumbOut ? 5 : 4;
	return 0;
}

/**
 * Whether the palm faces the camera (true), faces away (false), or is
 * edge-on / unclear (null).
 */
export function palmFacesCamera(hand: HandSnapshot): boolean | null {
	const kp = hand.keypoints;
	const wrist = kp[0];
	const indexMcp = kp[5];
	const pinkyMcp = kp[17];
	const v1x = indexMcp.x - wrist.x;
	const v1y = indexMcp.y - wrist.y;
	const v2x = pinkyMcp.x - wrist.x;
	const v2y = pinkyMcp.y - wrist.y;
	const cross = v1x * v2y - v1y * v2x;
	const scale = dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
	if (scale < 1 || Math.abs(cross) < scale * scale * 0.04) return null;
	return hand.handedness === 'Right' ? cross > 0 : cross < 0;
}

/**
 * Inward vs outward lean of the degree hand.
 * `lastTilt` provides hysteresis to reduce flicker.
 */
export function getDegreeTilt(
	hand: HandSnapshot,
	lastTilt: DegreeTilt
): DegreeTilt {
	const kp = hand.keypoints;
	const wrist = kp[0];
	const middleMcp = kp[9];
	const palmLen = dist(wrist.x, wrist.y, middleMcp.x, middleMcp.y);
	if (palmLen < 1) return 'neutral';

	const ax = middleMcp.x - wrist.x;
	const ay = middleMcp.y - wrist.y;
	const angleFromUp = Math.atan2(ax, -ay);
	const inwardDir = hand.handedness === 'Right' ? -1 : 1;
	const score = angleFromUp * inwardDir;

	const enter = 0.16;
	const hold = 0.08;

	if (lastTilt === 'outward') {
		if (score < -hold) return 'outward';
		if (score > enter) return 'inward';
		return 'neutral';
	}
	if (lastTilt === 'inward') {
		if (score > hold) return 'inward';
		if (score < -enter) return 'outward';
		return 'neutral';
	}
	if (score > enter) return 'inward';
	if (score < -enter) return 'outward';
	return 'neutral';
}

/** Natural triad for degree; counterpart flips maj/min. */
export function resolveDegreeTriad(
	degree: number,
	scaleMode: ScaleMode,
	counterpart: boolean
): TriadQuality {
	const natural = diatonicTriadQuality(degree, scaleMode) ?? 'major';
	if (!counterpart) return natural;
	if (natural === 'major' || natural === 'augmented') return 'minor';
	if (natural === 'minor' || natural === 'diminished') return 'major';
	return 'major';
}

/**
 * Modifier-hand quality poses. Returns null when absent/unclear.
 */
export function getModifierQuality(
	modHand: HandSnapshot,
	triad: TriadQuality
): Exclude<QualityName, 'natural'> | null {
	const kp = modHand.keypoints;
	const wrist = kp[0];
	const scale = dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
	if (scale < 1) return null;

	const facing = palmFacesCamera(modHand);
	if (facing === null) return null;

	const d = (a: HandKeypoint, b: HandKeypoint) => dist(a.x, a.y, b.x, b.y);
	const up = (tip: number, pip: number) =>
		d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.14;

	const indexUp = up(8, 6);
	const middleUp = up(12, 10);
	const ringUp = up(16, 14);
	const pinkyUp = up(20, 18);
	const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.2;

	let fingerCount = 0;
	if (indexUp && !middleUp && !ringUp && !pinkyUp) fingerCount = 1;
	else if (indexUp && middleUp && !ringUp && !pinkyUp) fingerCount = 2;
	else if (indexUp && middleUp && ringUp && !pinkyUp) fingerCount = 3;
	else if (indexUp && middleUp && ringUp && pinkyUp) fingerCount = 4;
	else return null;

	if (facing) {
		const majorish = triad === 'major' || triad === 'augmented';
		if (fingerCount === 1) return majorish ? 'major7' : 'minor7';
		if (fingerCount === 2) {
			if (majorish) return 'dominant7';
			return thumbOut ? 'diminished7' : 'halfDiminished7';
		}
		if (fingerCount === 3) return 'sus2';
		if (fingerCount === 4) return 'sus4';
		return null;
	}

	if (fingerCount === 1) return 'augmented';
	if (fingerCount === 2) return 'diminished';
	return null;
}
