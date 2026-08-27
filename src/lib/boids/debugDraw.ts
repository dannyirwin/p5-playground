import type { BoidsEngine } from './engine.ts';
import { colorForMidi } from './engine.ts';
import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';
import { sampleWindField } from './fieldSample.ts';

export interface BoidsDebugState {
	params: BoidsParams;
	notes: readonly number[] | null;
	bassActive: boolean;
	assignedByMidi: ReadonlyMap<number, number>;
	blankCount: number;
	quota: number;
}

export function drawWindFieldFromParams(
	ctx: CanvasRenderingContext2D,
	params: BoidsParams,
	width: number,
	height: number,
	millis: number
): void {
	if (!params.windEnabled) return;
	const step = Math.max(16, params.windFieldStep);
	const scale = params.windFieldScale;
	ctx.save();
	ctx.lineWidth = 1;
	for (let y = step * 0.5; y < height; y += step) {
		for (let x = step * 0.5; x < width; x += step) {
			const field = sampleWindField(x, y, width, height, millis, params);
			const mag = Math.hypot(field.x, field.y);
			if (mag < 0.001) continue;
			const len = Math.min(scale * 1.6, scale * (0.35 + mag * 1.4));
			const ux = (field.x / mag) * len;
			const uy = (field.y / mag) * len;
			const x2 = x + ux;
			const y2 = y + uy;
			const a = Math.min(0.7, (70 + mag * 90) / 255);
			ctx.strokeStyle = `rgba(160,200,220,${a})`;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x2, y2);
			const hx = -uy * 0.28;
			const hy = ux * 0.28;
			ctx.moveTo(x2, y2);
			ctx.lineTo(x2 - ux * 0.28 + hx, y2 - uy * 0.28 + hy);
			ctx.moveTo(x2, y2);
			ctx.lineTo(x2 - ux * 0.28 - hx, y2 - uy * 0.28 - hy);
			ctx.stroke();
		}
	}
	ctx.restore();
}

/** Debug overlay: Perlin wind direction lines (center attractor is a separate layer). */
export function drawWindFieldCanvas(
	ctx: CanvasRenderingContext2D,
	engine: BoidsEngine,
	width: number,
	height: number,
	millis: number
): void {
	const params = engine.getParams();
	if (!params.windEnabled) return;
	const step = Math.max(16, params.windFieldStep);
	const scale = params.windFieldScale;
	ctx.save();
	ctx.lineWidth = 1;
	for (let y = step * 0.5; y < height; y += step) {
		for (let x = step * 0.5; x < width; x += step) {
			const field = engine.sampleField(x, y, width, height, millis);
			const mag = Math.hypot(field.x, field.y);
			if (mag < 0.001) continue;
			const len = Math.min(scale * 1.6, scale * (0.35 + mag * 1.4));
			const ux = (field.x / mag) * len;
			const uy = (field.y / mag) * len;
			const x2 = x + ux;
			const y2 = y + uy;
			const a = Math.min(0.7, (70 + mag * 90) / 255);
			ctx.strokeStyle = `rgba(160,200,220,${a})`;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x2, y2);
			const hx = -uy * 0.28;
			const hy = ux * 0.28;
			ctx.moveTo(x2, y2);
			ctx.lineTo(x2 - ux * 0.28 + hx, y2 - uy * 0.28 + hy);
			ctx.moveTo(x2, y2);
			ctx.lineTo(x2 - ux * 0.28 - hx, y2 - uy * 0.28 - hy);
			ctx.stroke();
		}
	}
	ctx.restore();
}

export function drawColorCountsFromState(
	ctx: CanvasRenderingContext2D,
	state: BoidsDebugState,
	width: number,
	height: number
): void {
	const { notes, assignedByMidi: counts, blankCount: blanks, quota, bassActive } = state;
	const lineH = 18;
	const pad = 12;
	const rows = notes && notes.length > 0 ? notes.length + 2 : 2;
	const boxW = 168;
	const boxH = pad * 2 + rows * lineH;
	const x0 = pad;
	const y0 = height - boxH - pad;

	ctx.save();
	ctx.fillStyle = 'rgba(8,10,12,0.7)';
	ctx.fillRect(x0, y0, boxW, boxH);

	ctx.font = '12px system-ui, sans-serif';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	let y = y0 + 6;

	ctx.fillStyle = 'rgba(200,210,215,1)';
	ctx.fillText(`quota ${quota}  blank ${blanks}`, x0 + 10, y);
	y += lineH;

	if (notes && notes.length > 0) {
		for (const midi of notes) {
			const [cr, cg, cb] = colorForMidi(midi, notes, bassActive);
			const n = counts.get(midi) ?? 0;
			ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
			ctx.beginPath();
			ctx.arc(x0 + 16, y + 7, 4.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = 'rgba(230,235,240,1)';
			ctx.fillText(`midi ${midi}  ${n}`, x0 + 28, y);
			y += lineH;
		}
	} else {
		ctx.fillStyle = 'rgba(140,150,155,1)';
		ctx.fillText('no chord', x0 + 10, y);
		y += lineH;
	}

	const totalAssigned = [...counts.values()].reduce((a, b) => a + b, 0);
	ctx.fillStyle = 'rgba(160,170,175,1)';
	ctx.fillText(`assigned ${totalAssigned}`, x0 + 10, y);
	ctx.restore();
}

/** Debug overlay: per-note assigned counts + blanks / quota. */
export function drawColorCountsCanvas(
	ctx: CanvasRenderingContext2D,
	engine: BoidsEngine,
	width: number,
	height: number
): void {
	const notes = engine.getSoundingNotes();
	const counts = engine.getAssignedCountByMidi();
	const boids = engine.getBoids();
	let blanks = 0;
	for (const boid of boids) {
		if (boid.targetMidi === null || boid.decaying) blanks++;
	}
	const quota = notes && notes.length > 0 ? engine.getNoteQuota(notes.length) : 0;
	drawColorCountsFromState(
		ctx,
		{
			params: engine.getParams(),
			notes,
			bassActive: engine.getSoundingBassActive(),
			assignedByMidi: counts,
			blankCount: blanks,
			quota
		},
		width,
		height
	);
}

export function drawBoidsDebugFromState(
	ctx: CanvasRenderingContext2D,
	state: BoidsDebugState,
	width: number,
	height: number,
	millis: number
): void {
	if (state.params.showWindField) {
		drawWindFieldFromParams(ctx, state.params, width, height, millis);
	}
	if (state.params.showCounts) {
		drawColorCountsFromState(ctx, state, width, height);
	}
}

export function drawBoidsDebugCanvas(
	ctx: CanvasRenderingContext2D,
	engine: BoidsEngine,
	width: number,
	height: number,
	millis: number
): void {
	const params = engine.getParams();
	if (params.showWindField) {
		drawWindFieldCanvas(ctx, engine, width, height, millis);
	}
	if (params.showCounts) {
		drawColorCountsCanvas(ctx, engine, width, height);
	}
}
