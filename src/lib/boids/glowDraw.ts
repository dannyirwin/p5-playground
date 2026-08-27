import type { Boid, BoidsEngine } from './engine.ts';
import {
	colorForMidi,
	fireflyPulse,
	GLOW_BASE_RADIUS,
	isPlayingBoid
} from './engine.ts';
import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export interface BoidGlowAppearance {
	cr: number;
	cg: number;
	cb: number;
	alpha: number;
	radius: number;
	speedHeat: number;
}

export function computeBoidGlowAppearance(
	boid: Boid,
	millis: number,
	params: BoidsParams,
	soundingNotes: readonly number[] | null,
	soundingBassActive: boolean
): BoidGlowAppearance {
	const pulse = fireflyPulse(boid, millis);
	const speed = Math.hypot(boid.vx, boid.vy);
	const speedRef = Math.max(params.maxSpeedAssigned * boid.speedTrait, 0.001);
	const speedHeat = clamp(speed / speedRef, 0, 1);
	const sizeFromSpeed = lerp(
		1,
		lerp(1.18, 0.68, speedHeat),
		clamp(params.glowSpeedSize, 0, 1)
	);
	const brightFromSpeed = lerp(1, 1.55, speedHeat * clamp(params.glowSpeedSize, 0, 1));

	const colorMidi =
		boid.targetMidi !== null
			? boid.targetMidi
			: boid.ghostMidi !== null && boid.lit > 0
				? boid.ghostMidi
				: null;
	const showingColor = colorMidi !== null && boid.lit > 0.02;

	let cr: number;
	let cg: number;
	let cb: number;
	let alpha: number;
	let radius: number;

	if (showingColor) {
		const notesForColor = soundingNotes ?? [colorMidi!];
		[cr, cg, cb] = colorForMidi(colorMidi!, notesForColor, soundingBassActive);
		const lit = boid.lit;
		const live = isPlayingBoid(boid);
		const base = live ? 0.42 : 0.22;
		const pulseAmt = live ? 0.58 : 0.38;
		alpha = (base + pulseAmt * pulse) * boid.glowBright * lit * brightFromSpeed;
		radius =
			GLOW_BASE_RADIUS *
			params.glowPointSize *
			boid.glowSize *
			(0.88 + 0.2 * pulse) *
			(0.55 + 0.45 * lit) *
			sizeFromSpeed;
	} else {
		const heat = clamp(speed / params.maxSpeedIdle, 0, 1);
		cr = lerp(85, 130, heat);
		cg = lerp(165, 220, heat);
		cb = lerp(145, 190, heat);
		alpha =
			(params.idleAlphaBase + params.idleAlphaPulse * pulse) *
			boid.glowBright *
			brightFromSpeed;
		radius =
			GLOW_BASE_RADIUS *
			params.glowPointSize *
			boid.glowSize *
			(0.88 + 0.14 * pulse) *
			sizeFromSpeed;
	}

	return { cr, cg, cb, alpha, radius, speedHeat };
}

/** Fuzzy spark — radial gradient core with soft falloff (matches legacy p5 boids). */
export function drawGlowDot(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	cr: number,
	cg: number,
	cb: number,
	alpha: number,
	speedHeat = 0
): void {
	const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
	const coreMix = 0.48 + 0.42 * speedHeat;
	const midStop = 0.18 - 0.1 * speedHeat;
	const fallStop = 0.52 - 0.18 * speedHeat;
	const coreAlpha = Math.min(1, alpha * (1.05 + 0.35 * speedHeat));
	const midAlpha = alpha * (0.88 + 0.1 * speedHeat);
	const rimAlpha = alpha * (0.34 - 0.12 * speedHeat);
	const hr = Math.round(cr + (255 - cr) * coreMix);
	const hg = Math.round(cg + (255 - cg) * coreMix);
	const hb = Math.round(cb + (255 - cb) * coreMix);
	grad.addColorStop(0, `rgba(${hr},${hg},${hb},${coreAlpha})`);
	grad.addColorStop(Math.max(0.04, midStop), `rgba(${cr},${cg},${cb},${midAlpha})`);
	grad.addColorStop(Math.max(midStop + 0.05, fallStop), `rgba(${cr},${cg},${cb},${rimAlpha})`);
	grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.fill();
}

/** Draw all boids as soft radial glows on a 2D canvas (top-left origin, y-down). */
export function drawBoidsGlowCanvas(
	ctx: CanvasRenderingContext2D,
	engine: BoidsEngine,
	millis: number
): void {
	const boids = engine.getBoids();
	const params = engine.getParams();
	const soundingNotes = engine.getSoundingNotes();
	const soundingBassActive = engine.getSoundingBassActive();

	for (const boid of boids) {
		const glow = computeBoidGlowAppearance(
			boid,
			millis,
			params,
			soundingNotes,
			soundingBassActive
		);
		drawGlowDot(
			ctx,
			boid.x,
			boid.y,
			glow.radius,
			glow.cr,
			glow.cg,
			glow.cb,
			glow.alpha,
			glow.speedHeat
		);
	}
}
