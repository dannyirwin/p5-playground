import { describe, expect, it } from 'vitest';
import { classifyDegree } from './gestures.ts';
import type { HandSnapshot } from '../hands.ts';

/** Build a 21-keypoint hand with palm scale ~100px (wrist → middle MCP). */
function makeHand(
	overrides: Partial<Record<number, { x: number; y: number }>> = {}
): HandSnapshot {
	const keypoints = Array.from({ length: 21 }, (_, i) => {
		const base = overrides[i] ?? { x: 320, y: 240 };
		return { ...base };
	});
	keypoints[0] = overrides[0] ?? { x: 300, y: 300 };
	keypoints[9] = overrides[9] ?? { x: 300, y: 200 };
	return { handedness: 'Right', keypoints };
}

/** Index extended up; other fingers curled. */
function indexOnlyHand(): HandSnapshot {
	const wrist = { x: 300, y: 300 };
	const hand = makeHand({ 0: wrist, 9: { x: 300, y: 200 } });
	const kp = hand.keypoints;
	// Index up
	kp[6] = { x: 300, y: 250 };
	kp[8] = { x: 300, y: 100 };
	// Other fingers curled (tip near wrist)
	for (const [pip, tip] of [
		[10, 12],
		[14, 16],
		[18, 20]
	] as const) {
		kp[pip] = { x: 305, y: 260 };
		kp[tip] = { x: 306, y: 295 };
	}
	// Thumb in
	kp[2] = { x: 285, y: 270 };
	kp[4] = { x: 282, y: 275 };
	kp[17] = { x: 320, y: 260 };
	return hand;
}

describe('classifyDegree', () => {
	it('returns 1 for index-only pose', () => {
		expect(classifyDegree(indexOnlyHand())).toBe(1);
	});

	it('returns 0 for fist (no extended fingers)', () => {
		const hand = makeHand();
		const wrist = hand.keypoints[0];
		for (let i = 1; i < 21; i++) {
			hand.keypoints[i] = { x: wrist.x + 5, y: wrist.y - 8 };
		}
		expect(classifyDegree(hand)).toBe(0);
	});
});
