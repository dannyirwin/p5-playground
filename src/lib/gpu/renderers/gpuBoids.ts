import type p5 from 'p5';
import {
	createBoidsEngine,
	type BoidsEngine,
	type BoidsSimRng
} from '../../boids/engine.ts';
import { clampBoidCount } from '../../boids/boidCount.ts';
import type { VoicingChange } from '../../instrument/events.ts';
import type { RendererAudioMix } from '../../instrument/hud.ts';
import type { BoidsParamsBridge } from '../../sketch/renderers/boids.ts';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import {
	DEFAULT_BOIDS_PARAMS,
	DEFAULT_FLOCK_PRESET
} from '../../sketch/renderers/boidsParams.ts';
import type { BoidsProfileId } from '../../sketch/renderers/boidsProfiles.ts';
import { snapshotProfile } from '../../sketch/renderers/boidsProfiles.ts';
import type { FlockPreset } from '../../boids/flockSeparation.ts';
import { snapshotFlockPreset } from '../../boids/flockSeparation.ts';
import { BOID_FLOATS } from '../compute/boidLayout.ts';
import { detectWebGPU } from '../compute/detectWebGPU.ts';
import {
	createWebGpuBoidsEngine,
	packCpuBoids,
	type WebGpuBoidsEngine
} from '../compute/webgpuBoidsEngine.ts';
import { DEFAULT_GPU_BOID_COUNT } from '../constants.ts';
import type { WebGLHostInternal } from '../createWebGLHost.ts';
import { BoidGlowMesh } from '../render/boidGlowMesh.ts';
import { WindFieldMesh } from '../render/windFieldMesh.ts';
import type { GpuFrame, GpuRenderer } from '../types.ts';
import { drawBoidsDebugFromState, drawColorCountsCanvas } from '../../boids/debugDraw.ts';
import type { BoidsEngine as CpuEngine } from '../../boids/engine.ts';

export type GpuBoidsRenderer = GpuRenderer &
	BoidsParamsBridge & {
		bindHost(host: WebGLHostInternal, width: number, height: number): Promise<void>;
		initRng(p: p5): void;
		tick(frame: GpuFrame): Promise<void>;
		drawDebugOverlay(
			ctx: CanvasRenderingContext2D,
			width: number,
			height: number,
			millis: number
		): void;
		getSimBackend(): 'webgpu' | 'cpu';
	};

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
const WIND_FIELD_MAX_SEGMENTS = 12_000;

/** WebGPU sim + instanced glow shader render. */
export function createGpuBoidsRenderer(initialParams?: BoidsParams): GpuBoidsRenderer {
	const paramsSeed: BoidsParams = {
		...(initialParams ?? DEFAULT_BOIDS_PARAMS),
		boidCount: clampBoidCount(initialParams?.boidCount ?? DEFAULT_GPU_BOID_COUNT)
	};
	let flockSeed: FlockPreset = snapshotFlockPreset(DEFAULT_FLOCK_PRESET);

	let rng: BoidsSimRng | undefined;
	let host: WebGLHostInternal | undefined;
	let glow: BoidGlowMesh | undefined;
	let windField: WindFieldMesh | undefined;
	let webgpu: WebGpuBoidsEngine | undefined;
	let cpuEngine: BoidsEngine | undefined;
	let cpuPack = new Float32Array(paramsSeed.boidCount * BOID_FLOATS);
	let backend: 'webgpu' | 'cpu' = 'cpu';
	let boidCount = paramsSeed.boidCount;
	let seededW = 0;
	let seededH = 0;
	let bindPromise: Promise<void> | undefined;
	/** CPU debug overlay still uses engine when available. */
	let debugEngine: CpuEngine | undefined;

	function desiredCount(): number {
		return clampBoidCount(paramsSeed.boidCount);
	}

	function attachCpuPath(webglHost: WebGLHostInternal, width: number, height: number): void {
		backend = 'cpu';
		boidCount = desiredCount();
		glow?.destroy();
		glow = new BoidGlowMesh(webglHost.scene, boidCount);
		windField?.destroy();
		windField = new WindFieldMesh(webglHost.scene, WIND_FIELD_MAX_SEGMENTS);
		glow.setParams(paramsSeed);
		cpuPack = new Float32Array(boidCount * BOID_FLOATS);
		cpuEngine?.destroy();
		cpuEngine = undefined;
		const sim = ensureCpuEngine();
		sim.seed(width, height);
		seededW = width;
		seededH = height;
		debugEngine = sim;
	}

	async function bindSim(webglHost: WebGLHostInternal, width: number, height: number): Promise<void> {
		host = webglHost;
		glow?.destroy();
		webgpu?.destroy();
		webgpu = undefined;
		windField?.destroy();
		windField = undefined;
		cpuEngine?.destroy();
		cpuEngine = undefined;
		debugEngine = undefined;

		boidCount = desiredCount();
		const caps = await detectWebGPU();
		if (caps?.device) {
			try {
				backend = 'webgpu';
				glow = new BoidGlowMesh(webglHost.scene, boidCount);
				windField = new WindFieldMesh(webglHost.scene, WIND_FIELD_MAX_SEGMENTS);
				glow.setParams(paramsSeed);
				cpuPack = new Float32Array(boidCount * BOID_FLOATS);

				webgpu = createWebGpuBoidsEngine(
					caps.device as Parameters<typeof createWebGpuBoidsEngine>[0],
					boidCount,
					paramsSeed,
					flockSeed
				);
				await webgpu.init();
				webgpu.seed(width, height);
				seededW = width;
				seededH = height;
				console.info(`[gpu/boids] WebGPU sim (${boidCount.toLocaleString()} boids)`);
				return;
			} catch (err) {
				console.warn('[gpu/boids] WebGPU init failed, using CPU sim', err);
				webgpu?.destroy();
				webgpu = undefined;
				cpuEngine = undefined;
			}
		}

		attachCpuPath(webglHost, width, height);
		console.info(`[gpu/boids] CPU sim (${boidCount.toLocaleString()} boids)`);
	}

	function maybeReseed(width: number, height: number): void {
		if (width < 16 || height < 16) return;
		if (seededW >= 16 && seededH >= 16) return;
		if (webgpu) webgpu.seed(width, height);
		else ensureCpuEngine().seed(width, height);
		seededW = width;
		seededH = height;
	}

	function ensureCpuEngine(): BoidsEngine {
		if (!cpuEngine) {
			if (!rng) throw new Error('GpuBoidsRenderer: call initRng before sim');
			cpuEngine = createBoidsEngine(boidCount, paramsSeed, rng, flockSeed);
		}
		return cpuEngine;
	}

	return {
		id: 'boids-gpu',
		getSimBackend: () => backend,

		initRng(p: p5) {
			rng = createP5Rng(p);
			cpuEngine = undefined;
			webgpu = undefined;
		},

		async bindHost(webglHost: WebGLHostInternal, width: number, height: number) {
			const pending = bindSim(webglHost, width, height);
			bindPromise = pending;
			await pending;
			if (bindPromise === pending) bindPromise = undefined;
		},

		setup(width, height) {
			if (webgpu) {
				webgpu.seed(width, height);
				seededW = width;
				seededH = height;
			} else {
				ensureCpuEngine().seed(width, height);
				seededW = width;
				seededH = height;
			}
		},

		resize(width, height) {
			if (webgpu) webgpu.resize(width, height);
			else cpuEngine?.resize(width, height);
			maybeReseed(width, height);
		},

		onVoicing(event: VoicingChange, audioMix: RendererAudioMix) {
			if (webgpu) webgpu.applyVoicing(event, host!.width, host!.height, performance.now(), audioMix);
			else ensureCpuEngine().applyVoicing(event, host!.width, host!.height, performance.now(), audioMix);
		},

		onRelease() {
			if (webgpu) webgpu.releaseVoicing();
			else cpuEngine?.releaseVoicing();
		},

		getParams() {
			return webgpu?.getParams() ?? cpuEngine?.getParams() ?? { ...paramsSeed };
		},

		getBoidCount() {
			return boidCount;
		},

		setBoidCount(count: number) {
			const next = clampBoidCount(count);
			if (next === boidCount) {
				paramsSeed.boidCount = next;
				return;
			}
			paramsSeed.boidCount = next;
			if (host && seededW > 0 && seededH > 0) {
				const pending = bindSim(host, seededW, seededH);
				bindPromise = pending;
				void pending.finally(() => {
					if (bindPromise === pending) bindPromise = undefined;
				});
			}
		},

		applyParams(next: BoidsParams) {
			const prevCount = boidCount;
			Object.assign(paramsSeed, next);
			paramsSeed.boidCount = clampBoidCount(paramsSeed.boidCount);
			webgpu?.applyParams({ ...next, boidCount: paramsSeed.boidCount });
			cpuEngine?.applyParams({ ...next, boidCount: paramsSeed.boidCount });
			glow?.setParams(paramsSeed);
			if (paramsSeed.boidCount !== prevCount && host && seededW > 0 && seededH > 0) {
				const pending = bindSim(host, seededW, seededH);
				bindPromise = pending;
				void pending.finally(() => {
					if (bindPromise === pending) bindPromise = undefined;
				});
			}
		},

		applyFlockPreset(flock: FlockPreset) {
			flockSeed = snapshotFlockPreset(flock);
			webgpu?.applyFlockPreset(flock);
			cpuEngine?.applyFlockPreset(flock);
		},

		setProfileBaseline(id: BoidsProfileId) {
			const snap = snapshotProfile(id);
			Object.assign(paramsSeed, snap.params);
			flockSeed = snapshotFlockPreset(snap.flock);
			webgpu?.setProfileBaseline(id);
			cpuEngine?.setProfileBaseline(id);
			glow?.setParams(paramsSeed);
		},

		getFlockPreset() {
			return webgpu?.getFlockPreset() ?? cpuEngine?.getFlockPreset() ?? flockSeed;
		},

		snapshotParams() {
			return webgpu?.snapshotParams() ?? cpuEngine?.snapshotParams() ?? { ...paramsSeed };
		},

		snapshotBaseline() {
			return (
				webgpu?.snapshotBaseline() ??
				cpuEngine?.snapshotBaseline() ?? {
					params: { ...paramsSeed },
					flock: flockSeed
				}
			);
		},

		applyUserPreset(params: BoidsParams, flock?: FlockPreset) {
			const prevCount = boidCount;
			Object.assign(paramsSeed, params);
			paramsSeed.boidCount = clampBoidCount(paramsSeed.boidCount);
			if (flock) flockSeed = snapshotFlockPreset(flock);
			webgpu?.applyUserPreset({ ...params, boidCount: paramsSeed.boidCount }, flock);
			cpuEngine?.applyUserPreset({ ...params, boidCount: paramsSeed.boidCount }, flock);
			glow?.setParams(paramsSeed);
			if (paramsSeed.boidCount !== prevCount && host && seededW > 0 && seededH > 0) {
				const pending = bindSim(host, seededW, seededH);
				bindPromise = pending;
				void pending.finally(() => {
					if (bindPromise === pending) bindPromise = undefined;
				});
			}
		},

		draw(_frame: GpuFrame) {
			/* tick() uploads + host.render() handles draw */
		},

		async tick(frame: GpuFrame) {
			if (!glow || !host) return;
			if (bindPromise) await bindPromise;

			const params = webgpu?.getParams() ?? cpuEngine?.getParams() ?? paramsSeed;

			if (webgpu) {
				const data = await webgpu.step(
					frame.width,
					frame.height,
					frame.millis,
					frame.deltaTime,
					frame.audioMix
				);
				const notes = webgpu.getSoundingNotes();
				glow.setSoundingNotes(notes, webgpu.getSoundingBassActive());
				glow.setMillis(frame.millis);
				glow.uploadPacked(data, boidCount);
			} else {
				const sim = ensureCpuEngine();
				if (sim.getBoids().length === 0) sim.seed(frame.width, frame.height);
				sim.step(frame.width, frame.height, frame.millis, frame.deltaTime, frame.audioMix);
				packCpuBoids(sim.getBoids(), cpuPack);
				glow.setSoundingNotes(sim.getSoundingNotes(), sim.getSoundingBassActive());
				glow.setMillis(frame.millis);
				glow.uploadPacked(cpuPack, boidCount);
				debugEngine = sim;
			}

			if (windField) {
				windField.update(frame.width, frame.height, frame.millis, params);
			}

			host.render();
		},

		drawDebugOverlay(ctx, width, height, millis) {
			const params = webgpu?.getParams() ?? cpuEngine?.getParams() ?? paramsSeed;
			if (!params.showCounts) return;

			if (debugEngine) {
				if (debugEngine.getParams().showCounts) {
					drawColorCountsCanvas(ctx, debugEngine, width, height);
				}
				return;
			}

			const notes = webgpu?.getSoundingNotes() ?? cpuEngine?.getSoundingNotes() ?? null;
			const bassActive =
				webgpu?.getSoundingBassActive() ?? cpuEngine?.getSoundingBassActive() ?? false;
			const assignedByMidi =
				webgpu?.getAssignedCountByMidi() ?? cpuEngine?.getAssignedCountByMidi() ?? new Map();
			const noteLen = notes?.length ?? 0;
			const quota =
				webgpu?.getNoteQuota(noteLen) ?? cpuEngine?.getNoteQuota(noteLen) ?? 0;
			const blankCount = webgpu
				? webgpu.getBlankCount()
				: cpuEngine
					? cpuEngine.getBoids().filter((b) => b.targetMidi === null || b.decaying).length
					: 0;

			drawBoidsDebugFromState(
				ctx,
				{
					params: { ...params, showWindField: false },
					notes,
					bassActive,
					assignedByMidi,
					blankCount,
					quota
				},
				width,
				height,
				millis
			);
		},

		destroy() {
			glow?.destroy();
			glow = undefined;
			windField?.destroy();
			windField = undefined;
			webgpu?.destroy();
			webgpu = undefined;
			cpuEngine?.destroy();
			cpuEngine = undefined;
			debugEngine = undefined;
		}
	};
}
