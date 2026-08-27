import type { Boid } from '../../boids/engine.ts';
import type { VoicingChange } from '../../instrument/events.ts';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import { DEFAULT_BOIDS_PARAMS, DEFAULT_FLOCK_PRESET } from '../../sketch/renderers/boidsParams.ts';
import type { BoidsProfileId } from '../../sketch/renderers/boidsProfiles.ts';
import { snapshotProfile } from '../../sketch/renderers/boidsProfiles.ts';
import {
	buildSimContext,
	computeDynamicBoidsParams,
	createDynamicThresholdState,
	resetDynamicThresholds,
	shouldRefreshDynamic,
	type DynamicThresholdState
} from '../../sketch/renderers/boidsDynamic.ts';
import { BOID_BYTES, BOID_FLOATS } from './boidLayout.ts';
import {
	computeGpuCellSize,
	GPU_MAX_GRID_CELLS,
	GPU_MAX_PER_CELL,
	gpuGridDims
} from './gpuGrid.ts';
import { FLOCKING_WGSL } from './flocking.wgsl.ts';
import {
	computeAssignedCountByMidi,
	computeAudioIntensity,
	computeBlankCount,
	runGpuBoidEvents
} from './gpuBoidsEvents.ts';
import { assignTargetsPacked, scatterLitBoidsOnChordChange, setConvertBoostFromFlock, updateLitPacked } from './packedBoidLife.ts';
import type { FlockPreset } from '../../boids/flockSeparation.ts';
import { snapshotFlockPreset } from '../../boids/flockSeparation.ts';
import { SIM_F, SIM_U, SIM_UNIFORM_BYTES, STATS_BUFFER_U32S } from './simUniformLayout.ts';

const WORKGROUP = 256;

function maxNeighborRadius(params: BoidsParams, flock: FlockPreset): number {
	return Math.max(
		flock.cohRadius,
		flock.aliRadius,
		flock.separation.radiusIdle,
		flock.separation.radiusSame,
		flock.separation.radiusDiff,
		params.blankRepelRadius,
		params.huntRadius,
		params.infectRadius,
		params.chordRepelSepRadius
	);
}

function refreshGrid(
	width: number,
	height: number,
	boidCount: number,
	params: BoidsParams,
	flock: FlockPreset
) {
	const cellSize = computeGpuCellSize(width, height, boidCount, maxNeighborRadius(params, flock));
	const { cols, rows } = gpuGridDims(width, height, cellSize);
	return { cellSize, gridCols: cols, gridRows: rows };
}

type GpuDevice = {
	createShaderModule: (d: { code: string }) => unknown;
	createBuffer: (d: object) => GpuBuffer;
	createBindGroupLayout: (d: object) => unknown;
	createPipelineLayout: (d: object) => unknown;
	createComputePipeline: (d: object) => GpuComputePipeline;
	createCommandEncoder: (d?: object) => GpuCommandEncoder;
	queue: {
		writeBuffer: (b: GpuBuffer, o: number, d: BufferSource, s?: number, l?: number) => void;
		submit: (b: unknown[]) => void;
		onSubmittedWorkDone: () => Promise<void>;
	};
};

type GpuBuffer = {
	mapAsync: (mode: number) => Promise<void>;
	getMappedRange: () => ArrayBuffer;
	unmap: () => void;
	destroy: () => void;
};

type GpuComputePipeline = { getBindGroupLayout: (i: number) => unknown };
type GpuCommandEncoder = {
	beginComputePass: () => { setPipeline: (p: unknown) => void; setBindGroup: (i: number, g: unknown) => void; dispatchWorkgroups: (x: number) => void; end: () => void };
	copyBufferToBuffer: (a: GpuBuffer, b: number, c: GpuBuffer, d: number, e: number) => void;
	finish: () => unknown;
};
type GpuBindGroup = unknown;

export interface WebGpuBoidsEngine {
	readonly count: number;
	readonly backend: 'webgpu';
	init(): Promise<void>;
	getParams(): BoidsParams;
	applyParams(next: BoidsParams): void;
	getFlockPreset(): FlockPreset;
	applyFlockPreset(next: FlockPreset): void;
	setProfileBaseline(id: BoidsProfileId): void;
	refreshDynamicTuning(width: number, height: number, force?: boolean): void;
	snapshotParams(): BoidsParams;
	snapshotBaseline(): { params: BoidsParams; flock: FlockPreset };
	applyUserPreset(params: BoidsParams, flock?: FlockPreset): void;
	getSoundingNotes(): readonly number[] | null;
	getSoundingBassActive(): boolean;
	getNoteQuota(noteCount: number): number;
	getAssignedCountByMidi(): Map<number, number>;
	getBlankCount(): number;
	seed(width: number, height: number): void;
	resize(width: number, height: number): void;
	applyVoicing(
		event: VoicingChange,
		width: number,
		height: number,
		millis: number,
		audioMix: { conversions: { midi: number; x: number; y: number }[] }
	): void;
	releaseVoicing(): void;
	step(
		width: number,
		height: number,
		millis: number,
		deltaTime: number,
		audioMix: { intensity: number; conversions: { midi: number; x: number; y: number }[] }
	): Promise<Float32Array>;
	destroy(): void;
}

export function createWebGpuBoidsEngine(
	device: GpuDevice,
	count: number,
	initialParams?: BoidsParams,
	initialFlock?: FlockPreset
): WebGpuBoidsEngine {
	const params: BoidsParams = initialParams
		? { ...initialParams }
		: { ...DEFAULT_BOIDS_PARAMS };
	let profileParams: BoidsParams = { ...params };
	let profileFlock: FlockPreset = initialFlock
		? snapshotFlockPreset(initialFlock)
		: snapshotFlockPreset(DEFAULT_FLOCK_PRESET);
	let runtimeFlock: FlockPreset = snapshotFlockPreset(profileFlock);
	setConvertBoostFromFlock(runtimeFlock);
	let dynamicTuningLocked = false;
	const dynamicThresholds: DynamicThresholdState = createDynamicThresholdState();

	let width = 1;
	let height = 1;
	let gridCols = 1;
	let gridRows = 1;
	let cellSize = 64;
	let soundingNotes: number[] | null = null;
	let previousNotes: number[] | null = null;
	let soundingBassActive = false;
	let repelUntilMs = 0;
	let simFrame = 0;
	let lastMidiCounts = new Map<number, number>();
	let lastBlankCount = 0;
	/** Serializes staging-buffer readbacks (step vs voicing). */
	let gpuChain = Promise.resolve();

	let boidBuffer: GpuBuffer;
	let stagingBuffer: GpuBuffer;
	let uniformBuffer: GpuBuffer;
	let cellCountBuffer: GpuBuffer;
	let cellIndexBuffer: GpuBuffer;
	let statsBuffer: GpuBuffer;

	let resetStatsPipeline: GpuComputePipeline;
	let countPipeline: GpuComputePipeline;
	let resetGridPipeline: GpuComputePipeline;
	let insertPipeline: GpuComputePipeline;
	let flockPipeline: GpuComputePipeline;
	let bindGroup: GpuBindGroup;

	const uniformData = new ArrayBuffer(SIM_UNIFORM_BYTES);

	function noteQuota(noteCount: number): number {
		if (noteCount <= 0) return 0;
		return Math.floor(count / noteCount);
	}

	function applyDynamicTuning(w: number, h: number, force = false): void {
		if (dynamicTuningLocked) return;
		const notes = soundingNotes ?? [];
		const ctx = buildSimContext(
			w,
			h,
			count,
			notes.length,
			lastBlankCount,
			lastMidiCounts
		);
		if (!force && !shouldRefreshDynamic(ctx, dynamicThresholds)) return;
		const tuned = computeDynamicBoidsParams(profileParams, profileFlock, ctx);
		Object.assign(params, tuned.params);
		runtimeFlock = snapshotFlockPreset(tuned.flock);
		setConvertBoostFromFlock(runtimeFlock);
	}

	function writeUniforms(millis: number, deltaTime: number): void {
		const flock = runtimeFlock;
		const dv = new DataView(uniformData);
		const f = (slot: number, value: number) => dv.setFloat32(slot * 4, value, true);
		f(SIM_F.width, width);
		f(SIM_F.height, height);
		f(SIM_F.deltaTime, Math.min(Math.max(deltaTime, 0), 50));
		f(SIM_F.millis, millis);
		dv.setUint32(SIM_U.gridCols * 4, gridCols, true);
		dv.setUint32(SIM_U.gridRows * 4, gridRows, true);
		f(SIM_F.cellSize, cellSize);
		dv.setUint32(SIM_U.boidCount * 4, count, true);
		dv.setUint32(SIM_U.maxPerCell * 4, GPU_MAX_PER_CELL, true);
		const notes = soundingNotes ?? [];
		dv.setUint32(SIM_U.noteCount * 4, notes.length, true);
		dv.setUint32(SIM_U.bassActive * 4, soundingBassActive ? 1 : 0, true);
		const quota = noteQuota(notes.length);
		f(SIM_F.quota, quota);
		const repelPhase =
			millis >= repelUntilMs || repelUntilMs <= 0
				? 0
				: (repelUntilMs - millis) / Math.max(1, params.chordRepelMs);
		f(SIM_F.repelPhase, repelPhase);
		f(SIM_F.sepRadiusIdle, flock.separation.radiusIdle);
		f(SIM_F.sepRadiusSame, flock.separation.radiusSame);
		f(SIM_F.aliRadius, flock.aliRadius);
		f(SIM_F.cohRadius, flock.cohRadius);
		f(SIM_F.blankRepelRadius, params.blankRepelRadius);
		f(SIM_F.huntRadius, params.huntRadius);
		f(SIM_F.chordSepRadius, params.chordRepelSepRadius);
		f(SIM_F.sepIdle, flock.separation.idle);
		f(SIM_F.sepSame, flock.separation.same);
		f(SIM_F.sepDiff, flock.separation.diff);
		f(SIM_F.sepRadiusDiff, flock.separation.radiusDiff);
		f(SIM_F.sepDiffLateral, flock.separation.diffLateral);
		f(SIM_F.speedDrag, params.speedDrag);
		f(SIM_F.aliWeight, flock.alignment);
		f(SIM_F.cohWeight, flock.cohesion);
		f(SIM_F.blankRepel, params.blankRepel);
		f(SIM_F.huntBlankAttract, params.huntBlankAttract);
		f(SIM_F.huntColorAttract, params.huntColorAttract);
		f(SIM_F.blankSeekAttract, params.blankSeekAttract);
		f(SIM_F.chordRepelSep, params.chordRepelSep);
		f(SIM_F.chordRepelForce, params.chordRepelForce);
		f(SIM_F.huntBelowFrac, params.huntBelowFrac);
		f(SIM_F.preyAboveFrac, params.preyAboveFrac);
		f(SIM_F.nearMaxFrac, params.nearMaxFrac);
		f(SIM_F.stealBelowFrac, params.stealBelowFrac);
		f(SIM_F.minHoldFrac, params.minHoldFrac);
		f(SIM_F.minSpeedIdle, params.minSpeedIdle);
		f(SIM_F.maxForceAssigned, flock.assigned.maxForce);
		f(SIM_F.maxForceIdle, flock.maxForceIdle);
		f(SIM_F.chordRepelSpeedBoost, params.chordRepelSpeedBoost);
		f(SIM_F.windForce, params.windForce);
		f(SIM_F.windForceIdle, params.windForceIdle);
		f(SIM_F.windEnabled, params.windEnabled ? 1 : 0);
		f(SIM_F.centerStrength, params.centerBiasStrength);
		f(SIM_F.centerFalloff, params.centerBiasFalloff);
		f(SIM_F.centerQuadratic, params.centerBiasFalloffMode === 'quadratic' ? 1 : 0);
		f(SIM_F.centerEnabled, params.centerBiasEnabled ? 1 : 0);
		f(SIM_F.litFadeRate, params.litFadeRate);
		f(SIM_F.litRiseRate, params.litRiseRate);
		f(SIM_F.maxSpeedAssigned, params.maxSpeedAssigned);
		f(SIM_F.maxSpeedIdle, params.maxSpeedIdle);
		f(SIM_F.blankBlankRepelWeight, params.blankBlankRepelWeight);
		f(SIM_F.blankRepelNearMaxBoost, params.blankRepelNearMaxBoost);
		f(SIM_F.blankBlankAliMul, flock.blank.blankBlankAliMul);
		f(SIM_F.blankBlankCohMul, flock.blank.blankBlankCohMul);
		f(SIM_F.blankForceMul, flock.blank.forceMul);
		f(SIM_F.blankSepIdleMul, flock.blank.sepIdleMul);
		f(SIM_F.aliAssignedMul, flock.assigned.aliMul);
		f(SIM_F.cohAssignedMul, flock.assigned.cohMul);
		f(SIM_F.sepAssignedIdleMul, flock.separation.assignedIdleMul);
		f(SIM_F.sepAssignedSameMul, flock.separation.assignedSameMul);
		f(SIM_F.minSpeedPlaying, flock.assigned.minSpeed);
		f(SIM_F.globalForceCapLit, flock.steering.globalForceCapLit);
		f(SIM_F.globalForceCapBlank, flock.steering.globalForceCapBlank);
		f(SIM_F.steeringSmoothPlaying, flock.steering.steeringSmoothPlaying);
		f(SIM_F.steeringSmoothBlank, flock.steering.steeringSmoothBlank);
		f(SIM_F.windSpatial, params.windSpatial);
		f(SIM_F.windTime, params.windTime);
		f(SIM_F.windAngleTurns, params.windAngleTurns);
		for (let i = 0; i < 8; i++) {
			f(SIM_F.notes0 + i, i < notes.length ? notes[i]! : -1);
		}
		f(SIM_F.windAffectsLit, params.windAffectsLit ? 1 : 0);
		f(SIM_F.windAffectsDead, params.windAffectsDead ? 1 : 0);
		f(SIM_F.centerAffectsLit, params.centerBiasAffectsLit ? 1 : 0);
		f(SIM_F.centerAffectsDead, params.centerBiasAffectsDead ? 1 : 0);
		device.queue.writeBuffer(uniformBuffer, 0, uniformData);
	}

	function writeBoidBuffer(data: Float32Array): void {
		device.queue.writeBuffer(
			boidBuffer,
			0,
			data.buffer as ArrayBuffer,
			data.byteOffset,
			data.byteLength
		);
	}

	function dispatchCount(n: number): number {
		return Math.ceil(n / WORKGROUP);
	}

	function seedCpu(): Float32Array {
		const data = new Float32Array(count * BOID_FLOATS);
		for (let i = 0; i < count; i++) {
			const base = i * BOID_FLOATS;
			data[base] = Math.random() * width;
			data[base + 1] = Math.random() * height;
			data[base + 2] = 0;
			data[base + 3] = 0;
			data[base + 4] = 0;
			data[base + 5] = -1;
			data[base + 6] = -1;
			data[base + 7] = 0.75 + Math.random() * 0.55;
			data[base + 8] = 0.85 + Math.random() * 0.3;
			data[base + 9] = Math.random() * Math.PI * 2;
			data[base + 10] = 0.62 + Math.random() * 0.83;
			data[base + 11] = 0.65 + Math.random() * 0.75;
		}
		return data;
	}

	function enqueueGpu<T>(fn: () => Promise<T>): Promise<T> {
		const next = gpuChain.then(fn, fn);
		gpuChain = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}

	async function copyStagingToCpu(): Promise<Float32Array> {
		await stagingBuffer.mapAsync(1 /* READ */);
		try {
			const mapped = stagingBuffer.getMappedRange();
			const copy = new Float32Array(count * BOID_FLOATS);
			copy.set(new Float32Array(mapped));
			return copy;
		} finally {
			stagingBuffer.unmap();
		}
	}

	async function readBoidsFromGpu(): Promise<Float32Array> {
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(boidBuffer, 0, stagingBuffer, 0, count * BOID_BYTES);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		return copyStagingToCpu();
	}

	return {
		count,
		backend: 'webgpu',

		async init() {
			const module = device.createShaderModule({ code: FLOCKING_WGSL });
			const bindLayout = device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility: 4 /* COMPUTE */, buffer: { type: 'uniform' } },
					{ binding: 1, visibility: 4, buffer: { type: 'storage' } },
					{ binding: 2, visibility: 4, buffer: { type: 'storage' } },
					{ binding: 3, visibility: 4, buffer: { type: 'storage' } },
					{ binding: 4, visibility: 4, buffer: { type: 'storage' } }
				]
			});
			const layout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
			resetStatsPipeline = device.createComputePipeline({
				layout,
				compute: { module, entryPoint: 'resetStats' }
			});
			countPipeline = device.createComputePipeline({
				layout,
				compute: { module, entryPoint: 'countBoids' }
			});
			resetGridPipeline = device.createComputePipeline({
				layout,
				compute: { module, entryPoint: 'resetGrid' }
			});
			insertPipeline = device.createComputePipeline({
				layout,
				compute: { module, entryPoint: 'insertBoids' }
			});
			flockPipeline = device.createComputePipeline({
				layout,
				compute: { module, entryPoint: 'flock' }
			});

			boidBuffer = device.createBuffer({
				size: count * BOID_BYTES,
				usage: 0x8c /* STORAGE | COPY_SRC | COPY_DST */
			});
			stagingBuffer = device.createBuffer({
				size: count * BOID_BYTES,
				usage: 0x9 /* MAP_READ | COPY_DST */
			});
			uniformBuffer = device.createBuffer({
				size: SIM_UNIFORM_BYTES,
				usage: 0x40 /* UNIFORM */ | 0x8 /* COPY_DST */
			});
			cellCountBuffer = device.createBuffer({
				size: GPU_MAX_GRID_CELLS * 4,
				usage: 0x88 /* STORAGE | COPY_DST */
			});
			cellIndexBuffer = device.createBuffer({
				size: GPU_MAX_GRID_CELLS * GPU_MAX_PER_CELL * 4,
				usage: 0x88
			});
			statsBuffer = device.createBuffer({
				size: STATS_BUFFER_U32S * 4,
				usage: 0x88
			});

			bindGroup = (device as unknown as { createBindGroup: (d: object) => GpuBindGroup }).createBindGroup({
				layout: bindLayout,
				entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: { buffer: boidBuffer } },
					{ binding: 2, resource: { buffer: cellCountBuffer } },
					{ binding: 3, resource: { buffer: cellIndexBuffer } },
					{ binding: 4, resource: { buffer: statsBuffer } }
				]
			});
		},

		getParams() {
			return params;
		},
		applyParams(next) {
			Object.assign(params, next);
			Object.assign(profileParams, next);
		},
		getFlockPreset() {
			return snapshotFlockPreset(runtimeFlock);
		},
		applyFlockPreset(next) {
			profileFlock = snapshotFlockPreset(next);
			runtimeFlock = snapshotFlockPreset(next);
			setConvertBoostFromFlock(runtimeFlock);
			resetDynamicThresholds(dynamicThresholds);
		},
		setProfileBaseline(id) {
			const snap = snapshotProfile(id);
			profileParams = { ...snap.params };
			profileFlock = snapshotFlockPreset(snap.flock);
			Object.assign(params, snap.params);
			runtimeFlock = snapshotFlockPreset(snap.flock);
			setConvertBoostFromFlock(runtimeFlock);
			dynamicTuningLocked = false;
			resetDynamicThresholds(dynamicThresholds);
		},
		refreshDynamicTuning(w, h, force = false) {
			applyDynamicTuning(w, h, force);
		},
		snapshotParams() {
			return { ...params };
		},
		snapshotBaseline() {
			return {
				params: { ...profileParams },
				flock: snapshotFlockPreset(profileFlock)
			};
		},
		applyUserPreset(next, flock) {
			Object.assign(profileParams, next);
			Object.assign(params, next);
			if (flock) {
				profileFlock = snapshotFlockPreset(flock);
				runtimeFlock = snapshotFlockPreset(flock);
				setConvertBoostFromFlock(runtimeFlock);
			}
			dynamicTuningLocked = true;
			resetDynamicThresholds(dynamicThresholds);
		},
		getSoundingNotes() {
			return soundingNotes;
		},
		getSoundingBassActive() {
			return soundingBassActive;
		},
		getNoteQuota: noteQuota,
		getAssignedCountByMidi() {
			return new Map(lastMidiCounts);
		},
		getBlankCount() {
			return lastBlankCount;
		},

		seed(w, h) {
			width = w;
			height = h;
			({ cellSize, gridCols, gridRows } = refreshGrid(width, height, count, params, runtimeFlock));
			const data = seedCpu();
			writeBoidBuffer(data);
		},

		resize(w, h) {
			width = w;
			height = h;
			({ cellSize, gridCols, gridRows } = refreshGrid(width, height, count, params, runtimeFlock));
			applyDynamicTuning(w, h, true);
		},

		applyVoicing(event, w, h, millis, audioMix) {
			width = w;
			height = h;
			const notes = event.notes;
			soundingNotes = notes.length > 0 ? [...notes] : null;
			soundingBassActive = event.bassActive;
			repelUntilMs = millis + params.chordRepelMs;
			resetDynamicThresholds(dynamicThresholds);

			void enqueueGpu(async () => {
				const data = await readBoidsFromGpu();
				assignTargetsPacked(
					data,
					count,
					notes,
					previousNotes,
					width,
					height,
					audioMix
				);
				scatterLitBoidsOnChordChange(data, count, width, height, params);
				previousNotes = notes.length > 0 ? [...notes] : null;
				writeBoidBuffer(data);
				lastMidiCounts = computeAssignedCountByMidi(data, count);
				lastBlankCount = computeBlankCount(data, count);
				applyDynamicTuning(width, height, true);
			});
		},

		releaseVoicing() {
			soundingNotes = null;
			soundingBassActive = false;
			repelUntilMs = 0;
			void enqueueGpu(async () => {
				const data = await readBoidsFromGpu();
				assignTargetsPacked(
					data,
					count,
					[],
					previousNotes,
					width,
					height,
					{ conversions: [] }
				);
				previousNotes = null;
				writeBoidBuffer(data);
				lastMidiCounts = computeAssignedCountByMidi(data, count);
			});
		},

		step(w, h, millis, deltaTime, audioMix) {
			return enqueueGpu(async () => {
				width = w;
				height = h;
				({ cellSize, gridCols, gridRows } = refreshGrid(width, height, count, params, runtimeFlock));
				applyDynamicTuning(width, height);
				writeUniforms(millis, deltaTime);

				const encoder = device.createCommandEncoder();
				const cells = gridCols * gridRows;

				const statsReset = encoder.beginComputePass();
				statsReset.setBindGroup(0, bindGroup);
				statsReset.setPipeline(resetStatsPipeline);
				statsReset.dispatchWorkgroups(1);
				statsReset.end();

				const countPass = encoder.beginComputePass();
				countPass.setBindGroup(0, bindGroup);
				countPass.setPipeline(countPipeline);
				countPass.dispatchWorkgroups(dispatchCount(count));
				countPass.end();

				const gridReset = encoder.beginComputePass();
				gridReset.setBindGroup(0, bindGroup);
				gridReset.setPipeline(resetGridPipeline);
				gridReset.dispatchWorkgroups(dispatchCount(cells));
				gridReset.end();

				const insertPass = encoder.beginComputePass();
				insertPass.setBindGroup(0, bindGroup);
				insertPass.setPipeline(insertPipeline);
				insertPass.dispatchWorkgroups(dispatchCount(count));
				insertPass.end();

				const flockPass = encoder.beginComputePass();
				flockPass.setBindGroup(0, bindGroup);
				flockPass.setPipeline(flockPipeline);
				flockPass.dispatchWorkgroups(dispatchCount(count));
				flockPass.end();

				encoder.copyBufferToBuffer(boidBuffer, 0, stagingBuffer, 0, count * BOID_BYTES);
				device.queue.submit([encoder.finish()]);
				await device.queue.onSubmittedWorkDone();

				const out = await copyStagingToCpu();

				updateLitPacked(out, count, params);
				runGpuBoidEvents(
					out,
					count,
					width,
					height,
					soundingNotes,
					params,
					simFrame,
					audioMix
				);
				simFrame++;
				lastMidiCounts = computeAssignedCountByMidi(out, count);
				lastBlankCount = computeBlankCount(out, count);
				audioMix.intensity = computeAudioIntensity(
					out,
					count,
					soundingNotes?.length ?? 0,
					noteQuota(soundingNotes?.length ?? 0)
				);
				writeBoidBuffer(out);

				return out;
			});
		},

		destroy() {
			boidBuffer?.destroy();
			stagingBuffer?.destroy();
			uniformBuffer?.destroy();
			cellCountBuffer?.destroy();
			cellIndexBuffer?.destroy();
			statsBuffer?.destroy();
		}
	};
}

export function packCpuBoids(boids: readonly Boid[], out: Float32Array): void {
	for (let i = 0; i < boids.length; i++) {
		const b = boids[i]!;
		const base = i * BOID_FLOATS;
		out[base] = b.x;
		out[base + 1] = b.y;
		out[base + 2] = b.vx;
		out[base + 3] = b.vy;
		out[base + 4] = b.lit;
		out[base + 5] = b.targetMidi ?? -1;
		out[base + 6] = b.ghostMidi ?? -1;
		out[base + 7] = b.glowSize;
		out[base + 8] = b.glowBright;
		out[base + 9] = b.glowPhase;
		out[base + 10] = b.glowRate;
		out[base + 11] = b.speedTrait;
	}
}
