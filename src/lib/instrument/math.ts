/** Framework-agnostic math helpers for gesture and voicing code. */

export function dist(x1: number, y1: number, x2: number, y2: number): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	return Math.hypot(dx, dy);
}

export function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}

export function mapRange(
	value: number,
	inMin: number,
	inMax: number,
	outMin: number,
	outMax: number
): number {
	if (inMax === inMin) return outMin;
	return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}
