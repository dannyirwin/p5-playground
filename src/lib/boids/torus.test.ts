import { describe, expect, it } from 'vitest';
import {
	cellMayIntersectDisc,
	wrapDelta,
	wrapDist,
	wrapOffset,
	wrapPosition
} from './neighborKernel.ts';
import { sampleCenterBiasField, sampleWindField } from './fieldSample.ts';
import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';
import { DEFAULT_BOIDS_PARAMS } from '../sketch/renderers/boidsParams.ts';

describe('wrapDelta', () => {
	it('returns shortest signed delta on a circle', () => {
		expect(wrapDelta(10, 100)).toBe(10);
		expect(wrapDelta(90, 100)).toBe(-10);
		expect(wrapDelta(-90, 100)).toBe(10);
		expect(wrapDelta(50, 100)).toBe(50);
		expect(wrapDelta(-50, 100)).toBe(-50);
	});

	it('is antisymmetric', () => {
		for (const d of [-80, -10, 0, 10, 80]) {
			expect(wrapDelta(d, 100)).toBeCloseTo(-wrapDelta(-d, 100), 10);
		}
	});
});

describe('wrapPosition', () => {
	it('maps into [0, size)', () => {
		expect(wrapPosition(0, 100)).toBe(0);
		expect(wrapPosition(100, 100)).toBe(0);
		expect(wrapPosition(-1, 100)).toBe(99);
		expect(wrapPosition(250, 100)).toBe(50);
	});
});

describe('wrapOffset / wrapDist', () => {
	it('uses the short arc across edges', () => {
		const o = wrapOffset(5, 50, 995, 50, 1000, 100);
		expect(o.x).toBeCloseTo(-10, 5);
		expect(o.y).toBeCloseTo(0, 5);
		expect(wrapDist(5, 50, 995, 50, 1000, 100)).toBeCloseTo(10, 5);
	});
});

describe('cellMayIntersectDisc', () => {
	it('sees wrapped neighbor cells near the left edge', () => {
		const w = 1000;
		const h = 800;
		const cs = 50;
		const cols = Math.ceil(w / cs);
		// Query near left edge; last column (cols-1) should intersect via wrap.
		expect(
			cellMayIntersectDisc(10, 400, -1, Math.floor(400 / cs), cs, 40, w, h)
		).toBe(true);
		expect(
			cellMayIntersectDisc(10, 400, cols - 1, Math.floor(400 / cs), cs, 40, w, h)
		).toBe(true);
	});
});

describe('toroidal fields', () => {
	const params: BoidsParams = {
		...DEFAULT_BOIDS_PARAMS,
		windEnabled: true,
		windForce: 1,
		windSpatial: 1.8,
		windTime: 0.0001,
		windAngleTurns: 1.5,
		centerBiasEnabled: true,
		centerBiasStrength: 1,
		centerBiasFalloff: 1,
		centerBiasFalloffMode: 'linear'
	};
	const w = 1000;
	const h = 800;

	it('wind is continuous across the left/right seam', () => {
		const left = sampleWindField(1, 400, w, h, 12_000, params);
		const right = sampleWindField(w - 1, 400, w, h, 12_000, params);
		expect(left.x).toBeCloseTo(right.x, 2);
		expect(left.y).toBeCloseTo(right.y, 2);
	});

	it('wind is continuous across the top/bottom seam', () => {
		const top = sampleWindField(500, 1, w, h, 12_000, params);
		const bottom = sampleWindField(500, h - 1, w, h, 12_000, params);
		expect(top.x).toBeCloseTo(bottom.x, 1);
		expect(top.y).toBeCloseTo(bottom.y, 1);
	});

	it('center bias pulls toward mid along the short arc', () => {
		const nearRight = sampleCenterBiasField(w - 20, h / 2, w, h, params);
		expect(nearRight.x).toBeLessThan(0);
		expect(Math.abs(nearRight.y)).toBeLessThan(0.05);

		const nearLeft = sampleCenterBiasField(20, h / 2, w, h, params);
		expect(nearLeft.x).toBeGreaterThan(0);
	});

	it('center bias is ~0 on wrap seam, stronger mid-span', () => {
		const corner = sampleCenterBiasField(0, 0, w, h, params);
		expect(Math.hypot(corner.x, corner.y)).toBeLessThan(0.05);

		const edgeMid = sampleCenterBiasField(0, h / 2, w, h, params);
		expect(Math.hypot(edgeMid.x, edgeMid.y)).toBeLessThan(0.05);

		const midSpan = sampleCenterBiasField(w * 0.75, h / 2, w, h, params);
		expect(Math.abs(midSpan.x)).toBeGreaterThan(0.4);
		expect(Math.abs(midSpan.x)).toBeGreaterThan(Math.hypot(corner.x, corner.y) + 0.3);
	});

	it('center bias matches at x=0 and x=w', () => {
		const at0 = sampleCenterBiasField(0, h / 2, w, h, params);
		const atW = sampleCenterBiasField(w, h / 2, w, h, params);
		expect(at0.x).toBeCloseTo(atW.x, 5);
		expect(at0.y).toBeCloseTo(atW.y, 5);
	});

	it('wind matches at x=0 and x=w', () => {
		const a = sampleWindField(0, 400, w, h, 12_000, params);
		const b = sampleWindField(w, 400, w, h, 12_000, params);
		expect(a.x).toBeCloseTo(b.x, 5);
		expect(a.y).toBeCloseTo(b.y, 5);
	});
});
