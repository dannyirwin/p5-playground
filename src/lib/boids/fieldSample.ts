import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';
import { wrapDelta, wrapPosition } from './neighborKernel.ts';
import { boidsPerlinNoise } from './perlinNoise.ts';

export type FieldNoise = typeof boidsPerlinNoise;

function windAt(
	x: number,
	y: number,
	width: number,
	height: number,
	millis: number,
	params: BoidsParams
): { x: number; y: number } {
	const t = millis * params.windTime;
	// Couple both torus angles into each sample so the field isn't separable f(x)+g(y).
	const twopi = Math.PI * 2;
	const sx = params.windSpatial * 0.5;
	const ux = (wrapPosition(x, width) / Math.max(1, width)) * twopi;
	const uy = (wrapPosition(y, height) / Math.max(1, height)) * twopi;
	const cu = Math.cos(ux);
	const su = Math.sin(ux);
	const cv = Math.cos(uy);
	const sv = Math.sin(uy);
	const n = boidsPerlinNoise(cu * sx + cv * sx * 0.7, su * sx + sv * sx * 0.7, t);
	const angle = n * Math.PI * 2 * params.windAngleTurns;
	const m = boidsPerlinNoise(
		cu * sx + sv * sx * 0.7 + 19.1,
		su * sx + cv * sx * 0.7 - 7.4,
		t + 3.7
	);
	const mag = 0.45 + m * 0.55;
	return { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag };
}

/** Per-axis harmonic pull toward center; force is ~0 on the wrap seam (avoids corner sinks). */
function centerBiasAt(
	x: number,
	y: number,
	width: number,
	height: number,
	params: BoidsParams
): { x: number; y: number } {
	if (!params.centerBiasEnabled) return { x: 0, y: 0 };
	const px = wrapPosition(x, width);
	const py = wrapPosition(y, height);
	const dx = wrapDelta(px - width / 2, width);
	const dy = wrapDelta(py - height / 2, height);
	const expo = Math.max(0.25, params.centerBiasFalloff);
	const quadratic = params.centerBiasFalloffMode === 'quadratic';

	const axis = (delta: number, size: number): number => {
		const s = Math.sin((delta / Math.max(1, size)) * Math.PI * 2);
		let shaped = quadratic ? Math.sign(s) * s * s : s;
		shaped = Math.sign(shaped) * Math.pow(Math.abs(shaped), expo);
		return -shaped * params.centerBiasStrength;
	};

	return { x: axis(dx, width), y: axis(dy, height) };
}

export function sampleWindField(
	x: number,
	y: number,
	width: number,
	height: number,
	millis: number,
	params: BoidsParams,
	windWeight = params.windForce
): { x: number; y: number } {
	if (!params.windEnabled) return { x: 0, y: 0 };
	const wind = windAt(x, y, width, height, millis, params);
	return { x: wind.x * windWeight, y: wind.y * windWeight };
}

export function sampleCenterBiasField(
	x: number,
	y: number,
	width: number,
	height: number,
	params: BoidsParams
): { x: number; y: number } {
	return centerBiasAt(x, y, width, height, params);
}

export function sampleBoidsField(
	x: number,
	y: number,
	width: number,
	height: number,
	millis: number,
	params: BoidsParams,
	windWeight = params.windForce
): { x: number; y: number } {
	const wind = sampleWindField(x, y, width, height, millis, params, windWeight);
	const bias = sampleCenterBiasField(x, y, width, height, params);
	return { x: wind.x + bias.x, y: wind.y + bias.y };
}

export { boidsPerlinNoise };
