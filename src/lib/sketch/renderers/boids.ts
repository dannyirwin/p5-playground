import type p5 from 'p5';
import {
	colorForMidi,
	createBoidsEngine,
	type BoidsEngine,
	type BoidsSimRng
} from '../../boids/engine.ts';
import { clampBoidCount, DEFAULT_BOID_COUNT } from '../../boids/boidCount.ts';
import { drawBoidsGlowCanvas } from '../../boids/glowDraw.ts';
import type { VoicingChange } from '../../instrument/events.ts';
import type { InstrumentFrame, Renderer } from '../types.ts';
import type { BoidsParams } from './boidsParams.ts';
import {
	DEFAULT_BOIDS_PARAMS,
	DEFAULT_FLOCK_PRESET,
	type BoidsProfileBridge
} from './boidsParams.ts';
import type { BoidsProfileId } from './boidsProfiles.ts';
import type { FlockPreset } from '../../boids/flockSeparation.ts';

/** Live-tunable params on a boids renderer instance. */
export interface BoidsParamsBridge extends BoidsProfileBridge {
	getParams(): BoidsParams;
	snapshotParams(): BoidsParams;
	getBoidCount?(): number;
	setBoidCount?(count: number): void;
	/** Baseline params/flock before dynamic population scaling — use for save/load. */
	snapshotBaseline?(): { params: BoidsParams; flock: FlockPreset };
	/** Apply saved preset exactly; disables dynamic retuning until profile reset. */
	applyUserPreset?(params: BoidsParams, flock?: FlockPreset): void;
	getFlockPreset?(): FlockPreset;
	applyFlockPreset?(flock: FlockPreset): void;
}

export type BoidsRenderer = Renderer & BoidsParamsBridge;

function createP5Rng(p: p5): BoidsSimRng {
	return {
		random(max = 1) {
			return p.random(max);
		},
		randomMin(min: number, max: number) {
			return p.random(min, max);
		},
		noise(x: number, y: number, z: number) {
			return p.noise(x, y, z);
		}
	};
}

function drawWindField(p: p5, engine: BoidsEngine, width: number, height: number, millis: number): void {
	const params = engine.getParams();
	if (!params.windEnabled) return;
	const step = Math.max(16, params.windFieldStep);
	const scale = params.windFieldScale;
	p.push();
	p.strokeWeight(1);
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
			const a = Math.min(180, 70 + mag * 90);
			p.stroke(160, 200, 220, a);
			p.line(x, y, x2, y2);
			const hx = -uy * 0.28;
			const hy = ux * 0.28;
			p.line(x2, y2, x2 - ux * 0.28 + hx, y2 - uy * 0.28 + hy);
			p.line(x2, y2, x2 - ux * 0.28 - hx, y2 - uy * 0.28 - hy);
		}
	}
	p.pop();
}

function drawColorCounts(p: p5, engine: BoidsEngine): void {
	const params = engine.getParams();
	if (!params.showCounts) return;
	const notes = engine.getSoundingNotes();
	const counts = engine.getAssignedCountByMidi();
	const boids = engine.getBoids();
	let blanks = 0;
	for (const boid of boids) {
		if (boid.targetMidi === null || boid.decaying) blanks++;
	}

	const quota = notes && notes.length > 0 ? engine.getNoteQuota(notes.length) : 0;
	const lineH = 18;
	const pad = 12;
	const rows = notes && notes.length > 0 ? notes.length + 2 : 2;
	const boxW = 168;
	const boxH = pad * 2 + rows * lineH;
	const x0 = pad;
	const y0 = p.height - boxH - pad;

	p.push();
	p.noStroke();
	p.fill(8, 10, 12, 180);
	p.rect(x0, y0, boxW, boxH, 6);

	p.textAlign(p.LEFT, p.TOP);
	p.textSize(12);
	let y = y0 + 6;

	p.fill(200, 210, 215);
	p.text(`quota ${quota}  blank ${blanks}`, x0 + 10, y);
	y += lineH;

	if (notes && notes.length > 0) {
		for (const midi of notes) {
			const [cr, cg, cb] = colorForMidi(midi, notes, engine.getSoundingBassActive());
			const n = counts.get(midi) ?? 0;
			p.fill(cr, cg, cb);
			p.circle(x0 + 16, y + 7, 9);
			p.fill(230, 235, 240);
			p.text(`midi ${midi}  ${n}`, x0 + 28, y);
			y += lineH;
		}
	} else {
		p.fill(140, 150, 155);
		p.text('no chord', x0 + 10, y);
		y += lineH;
	}

	const totalAssigned = [...counts.values()].reduce((a, b) => a + b, 0);
	p.fill(160, 170, 175);
	p.text(`assigned ${totalAssigned}`, x0 + 10, y);
	p.pop();
}

/** Reynolds flocking on a torus; chord notes assign attractors + colors. */
export function createBoidsRenderer(initialParams?: BoidsParams): BoidsRenderer {
	const paramsSeed: BoidsParams = {
		...(initialParams ?? DEFAULT_BOIDS_PARAMS),
		boidCount: clampBoidCount(initialParams?.boidCount ?? DEFAULT_BOID_COUNT)
	};
	let flockSeed: FlockPreset = DEFAULT_FLOCK_PRESET;
	let engine: BoidsEngine | undefined;
	let p5Ref: p5 | undefined;
	let lastW = 0;
	let lastH = 0;

	function createEngine(p: p5): BoidsEngine {
		return createBoidsEngine(
			paramsSeed.boidCount,
			paramsSeed,
			createP5Rng(p),
			flockSeed
		);
	}

	function recreateEngine(p: p5): void {
		engine?.destroy();
		engine = createEngine(p);
		if (lastW > 0 && lastH > 0) engine.seed(lastW, lastH);
	}

	function ensureEngine(p: p5): BoidsEngine {
		p5Ref = p;
		if (!engine) {
			engine = createEngine(p);
		}
		return engine;
	}

	return {
		id: 'boids',
		label: 'Boids',

		setup(p) {
			ensureEngine(p).seed(p.width, p.height);
			lastW = p.width;
			lastH = p.height;
		},

		resize(p) {
			lastW = p.width;
			lastH = p.height;
			ensureEngine(p).resize(p.width, p.height);
		},

		onVoicing(p, event, audioMix) {
			const sim = ensureEngine(p);
			sim.applyVoicing(event, p.width, p.height, p.millis(), audioMix);
		},

		onRelease() {
			engine?.releaseVoicing();
		},

		getParams() {
			return engine?.getParams() ?? { ...paramsSeed };
		},

		getBoidCount() {
			return engine?.count ?? paramsSeed.boidCount;
		},

		setBoidCount(count: number) {
			const next = clampBoidCount(count);
			if (next === (engine?.count ?? paramsSeed.boidCount)) {
				paramsSeed.boidCount = next;
				engine?.applyParams({ ...engine.getParams(), boidCount: next });
				return;
			}
			paramsSeed.boidCount = next;
			if (p5Ref) recreateEngine(p5Ref);
		},

		applyParams(next: BoidsParams) {
			const countChanged =
				next.boidCount !== undefined &&
				clampBoidCount(next.boidCount) !== (engine?.count ?? paramsSeed.boidCount);
			Object.assign(paramsSeed, next);
			paramsSeed.boidCount = clampBoidCount(paramsSeed.boidCount);
			if (countChanged && p5Ref) {
				recreateEngine(p5Ref);
				return;
			}
			engine?.applyParams({ ...next, boidCount: paramsSeed.boidCount });
		},

		applyFlockPreset(flock: FlockPreset) {
			flockSeed = flock;
			engine?.applyFlockPreset(flock);
		},

		setProfileBaseline(id: BoidsProfileId) {
			engine?.setProfileBaseline(id);
		},

		getFlockPreset() {
			return engine?.getFlockPreset() ?? flockSeed;
		},

		snapshotParams() {
			return engine?.snapshotParams() ?? { ...paramsSeed };
		},

		snapshotBaseline() {
			return (
				engine?.snapshotBaseline() ?? {
					params: { ...paramsSeed },
					flock: flockSeed
				}
			);
		},

		applyUserPreset(params: BoidsParams, flock?: FlockPreset) {
			const countChanged =
				params.boidCount !== undefined &&
				clampBoidCount(params.boidCount) !== (engine?.count ?? paramsSeed.boidCount);
			Object.assign(paramsSeed, params);
			paramsSeed.boidCount = clampBoidCount(paramsSeed.boidCount);
			if (flock) flockSeed = flock;
			if (countChanged && p5Ref) {
				recreateEngine(p5Ref);
				engine?.applyUserPreset({ ...params, boidCount: paramsSeed.boidCount }, flock);
				return;
			}
			engine?.applyUserPreset({ ...params, boidCount: paramsSeed.boidCount }, flock);
		},

		draw(p, frame: InstrumentFrame) {
			lastW = frame.width;
			lastH = frame.height;
			const sim = ensureEngine(p);
			if (sim.getBoids().length === 0) sim.seed(frame.width, frame.height);
			sim.step(frame.width, frame.height, frame.millis, frame.deltaTime, frame.audioMix);
			if (sim.getParams().showWindField) {
				drawWindField(p, sim, frame.width, frame.height, frame.millis);
			}
			drawBoidsGlowCanvas(p.drawingContext as CanvasRenderingContext2D, sim, frame.millis);
			drawColorCounts(p, sim);
		},

		destroy() {
			engine?.destroy();
			engine = undefined;
			p5Ref = undefined;
		}
	};
}
