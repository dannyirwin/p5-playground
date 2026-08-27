import { describe, expect, it } from 'vitest';
import type { HandSnapshot } from '../hands.ts';
import { palmAnchorCapture } from './handAssignment.ts';

/** Palm with wrist at (300,400), knuckles around y=300 (up on screen). */
function makePalmHand(tipY: number): HandSnapshot {
	const keypoints = Array.from({ length: 21 }, () => ({ x: 300, y: 350 }));
	keypoints[0] = { x: 300, y: 400 }; // wrist
	keypoints[5] = { x: 260, y: 300 }; // index MCP
	keypoints[9] = { x: 300, y: 295 }; // middle MCP
	keypoints[13] = { x: 335, y: 300 }; // ring MCP
	keypoints[17] = { x: 365, y: 308 }; // pinky MCP
	// Finger tips — open hand high, fist low near knuckles
	for (const tip of [4, 8, 12, 16, 20]) {
		keypoints[tip] = { x: 300, y: tipY };
	}
	return { handedness: 'Right', keypoints };
}

describe('palmAnchorCapture', () => {
	it('ignores fingertip height so open hand ≈ fist for octave Y', () => {
		const open = palmAnchorCapture(makePalmHand(180));
		const fist = palmAnchorCapture(makePalmHand(310));
		expect(open.y).toBeCloseTo(fist.y, 5);
		expect(open.x).toBeCloseTo(fist.x, 5);
	});

	it('sits on the knuckle line (not the wrist)', () => {
		const anchor = palmAnchorCapture(makePalmHand(180));
		// Average MCP y ≈ 300.75
		expect(anchor.y).toBeCloseTo(300.75, 5);
		expect(Math.abs(anchor.y - 300)).toBeLessThan(Math.abs(anchor.y - 400));
	});
});
