import { BOIDS_PERM_BASE } from './perlinPerm.ts';

const PERM = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
	PERM[i] = BOIDS_PERM_BASE[i & 255]!;
}

function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
	return a + t * (b - a);
}

function grad3(hash: number, x: number, y: number, z: number): number {
	const h = hash & 15;
	const u = h < 8 ? x : y;
	const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
	return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** 3D Perlin mapped to 0..1 — shared by CPU sim, wind overlay, and WebGPU shader. */
export function boidsPerlinNoise(x: number, y: number, z: number): number {
	const xi = Math.floor(x) & 255;
	const yi = Math.floor(y) & 255;
	const zi = Math.floor(z) & 255;
	const xf = x - Math.floor(x);
	const yf = y - Math.floor(y);
	const zf = z - Math.floor(z);
	const u = fade(xf);
	const v = fade(yf);
	const w = fade(zf);

	const a = PERM[xi] + yi;
	const aa = PERM[a] + zi;
	const ab = PERM[a + 1] + zi;
	const b = PERM[xi + 1] + yi;
	const ba = PERM[b] + zi;
	const bb = PERM[b + 1] + zi;

	const x1 = lerp(
		grad3(PERM[aa], xf, yf, zf),
		grad3(PERM[ba], xf - 1, yf, zf),
		u
	);
	const x2 = lerp(
		grad3(PERM[ab], xf, yf - 1, zf),
		grad3(PERM[bb], xf - 1, yf - 1, zf),
		u
	);
	const y1 = lerp(x1, x2, v);
	const x3 = lerp(
		grad3(PERM[aa + 1], xf, yf, zf - 1),
		grad3(PERM[ba + 1], xf - 1, yf, zf - 1),
		u
	);
	const x4 = lerp(
		grad3(PERM[ab + 1], xf, yf - 1, zf - 1),
		grad3(PERM[bb + 1], xf - 1, yf - 1, zf - 1),
		u
	);
	const y2 = lerp(x3, x4, v);
	const value = lerp(y1, y2, w);
	return (value + 1) * 0.5;
}
