import type p5 from 'p5';
import { createMl5HandCapture } from '../instrument/capture/ml5Capture.ts';
import type { HandCapture, AudioHost } from '../instrument/hosts.ts';
import type { HandSnapshot } from '../instrument/hands.ts';
import { createHarmonyController } from '../instrument/harmony/controller.ts';
import type { PitchClass, ScaleMode } from '../instrument/harmony/scales.ts';
import { createInputRecognizer } from '../instrument/input/recognizer.ts';
import { createBoidsPlayer } from '../instrument/player/adapters/p5/index.ts';
import type { InstrumentHudState } from '../instrument/hud.ts';
import type { VoicingChange } from '../instrument/events.ts';
import { createInstrumentSession } from '../instrument/session.ts';
import type { BoidsParamsBridge } from '../sketch/renderers/boids.ts';
import type { BoidsParams } from '../sketch/renderers/boidsParams.ts';
import { createWebGLHost } from './createWebGLHost.ts';
import { createGpuBoidsRendererWithBackend } from './compute/index.ts';
import { drawFollowerDot, drawHandKeypoints } from './drawOverlay.ts';
import type { GpuBoidsRenderer } from './renderers/gpuBoids.ts';
import type { GpuFrame } from './types.ts';
import { loadBrowserSketchDeps } from '../sketch/loadDeps.ts';
import type { SessionStepResult } from '../instrument/session.ts';

type P5WithSound = p5 & {
	userStartAudio: () => Promise<void>;
};

export interface GpuInstrumentOptions {
	getShowVideo: () => boolean;
	getShowHands: () => boolean;
	getRootPc: () => PitchClass;
	getMode: () => ScaleMode;
	onHudUpdate?: (state: InstrumentHudState) => void;
	onAudioControls?: (controls: { unlock: () => void; isReady: () => boolean }) => void;
	onAudioReadyChange?: (ready: boolean) => void;
	onBoidsParamsBridge?: (bridge: BoidsParamsBridge | null) => void;
	initialBoidsParams?: BoidsParams;
}

function kickSilentBuffer(ctx: AudioContext): void {
	try {
		const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		source.start(0);
	} catch {
		/* ignore */
	}
}

/**
 * WebGL host + shared session loop.
 * Hidden p5 instance handles ml5 capture and p5.sound audio.
 */
export function startGpuInstrument(
	mountEl: HTMLElement,
	hiddenEl: HTMLElement,
	options: GpuInstrumentOptions
): Promise<() => void> {
	const webglHost = createWebGLHost(mountEl);
	const gpuRenderer: GpuBoidsRenderer = createGpuBoidsRendererWithBackend(
		options.initialBoidsParams,
		'webgpu'
	);
	let simReady = false;
	let tickChain = Promise.resolve();

	const input = createInputRecognizer();
	const session = createInstrumentSession({
		input,
		harmony: createHarmonyController(),
		onHudUpdate: options.onHudUpdate
	});

	let audioP5: p5 | undefined;
	let capture: HandCapture | undefined;
	let videoMounted = false;
	let rafId = 0;
	let lastRootPc = options.getRootPc();
	let lastMode = options.getMode();
	let followerX = 0;
	let followerY = 0;
	let lastMillis = 0;
	let lastNotes: number[] | null = null;
	let lastBassActive = false;
	let audioSketch: p5 | undefined;

	function getNativeContext(): AudioContext | undefined {
		try {
			return (
				audioP5 as p5 & { getAudioContext?: () => AudioContext }
			)?.getAudioContext?.();
		} catch {
			return undefined;
		}
	}

	function audioHost(): AudioHost {
		return {
			getContext: () => getNativeContext() ?? null,
			unlock: async () => {
				void (audioP5 as P5WithSound | undefined)?.userStartAudio?.();
			}
		};
	}

	function replayGpuVoicing(notes: number[] | null, bassActive: boolean): void {
		if (!notes || notes.length === 0) return;
		const event: VoicingChange = {
			kind: 'voicing',
			notes,
			originX: webglHost.width - followerX,
			reason: 'key',
			bassActive
		};
		gpuRenderer.onVoicing?.(event, { intensity: 1, conversions: [] });
	}

	function unlockAudioFromGesture(): void {
		void (audioSketch as P5WithSound | undefined)?.userStartAudio?.();
		session.unlockAudio(audioHost(), followerX, webglHost.width);
		replayGpuVoicing(lastNotes, lastBassActive);

		const ctx = getNativeContext();
		if (ctx) {
			kickSilentBuffer(ctx);
			if (ctx.state !== 'running') void ctx.resume();
			try {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = 523.25;
				gain.gain.value = 0.0001;
				osc.connect(gain);
				gain.connect(ctx.destination);
				const now = ctx.currentTime;
				gain.gain.setValueAtTime(0.0001, now);
				gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
				osc.start(now);
				osc.stop(now + 0.32);
			} catch {
				/* ignore */
			}
		}

		options.onAudioReadyChange?.(true);
	}

	function mountCaptureVideo(): void {
		if (videoMounted || !capture) return;
		const video = capture.getVideoElement?.();
		if (!video) return;
		webglHost.mountVideoElement(video);
		videoMounted = true;
	}

	function syncVideoLayer(): void {
		mountCaptureVideo();
		const video = capture?.getVideoElement?.();
		const show = options.getShowVideo() && video !== null;
		if (video) video.style.display = show ? 'block' : 'none';
		webglHost.setClearOpaque(!show);
	}

	function syncPlayerVoicing(step: SessionStepResult): void {
		const player = session.getPlayer();
		if (!player?.isReady?.()) return;
		const notes = step.hud.notes;
		if (!notes || notes.length === 0) return;
		if (player.hasVoices?.()) return;
		player.onVoicing({
			kind: 'voicing',
			notes,
			originX: webglHost.width - followerX,
			reason: 'key',
			bassActive: step.hud.bassActive
		});
	}

	function drawOverlay(hands: readonly HandSnapshot[], millis: number): void {
		const ctx = webglHost.overlayCanvas.getContext('2d');
		if (!ctx) return;
		const dpr = Math.min(window.devicePixelRatio, 2);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, webglHost.width, webglHost.height);
		gpuRenderer.drawDebugOverlay(ctx, webglHost.width, webglHost.height, millis);
		if (options.getShowHands() && hands.length > 0) {
			drawHandKeypoints(
				ctx,
				hands,
				webglHost.width,
				webglHost.height,
				capture?.captureWidth ?? 640,
				capture?.captureHeight ?? 480,
				millis,
				followerX,
				followerY
			);
		}
		drawFollowerDot(ctx, webglHost.width, followerX, followerY);
	}

	function frame(now: number): void {
		rafId = requestAnimationFrame(frame);
		const deltaTime = lastMillis === 0 ? 16 : Math.min(50, now - lastMillis);
		lastMillis = now;

		webglHost.resize();
		gpuRenderer.resize(webglHost.width, webglHost.height);
		syncVideoLayer();

		const rootPc = options.getRootPc();
		const mode = options.getMode();
		const keyOrModeChanged = rootPc !== lastRootPc || mode !== lastMode;
		if (keyOrModeChanged) {
			lastRootPc = rootPc;
			lastMode = mode;
		}

		const hands = capture?.getHands() ?? [];
		const capW = capture?.captureWidth ?? 640;
		const capH = capture?.captureHeight ?? 480;

		const inputUpdate = input.update(
			hands,
			rootPc,
			mode,
			webglHost.width,
			webglHost.height,
			capW,
			capH,
			now,
			deltaTime
		);
		followerX = inputUpdate.intent.follower.x;
		followerY = inputUpdate.intent.follower.y;

		const step = session.step({
			input: inputUpdate,
			rootPc,
			mode,
			canvasWidth: webglHost.width,
			canvasHeight: webglHost.height,
			keyOrModeChanged,
			deltaMs: deltaTime
		});

		lastNotes = step.hud.notes;
		lastBassActive = step.hud.bassActive;

		if (step.pendingRelease) gpuRenderer.onRelease?.();
		if (step.pendingVoicing) gpuRenderer.onVoicing?.(step.pendingVoicing, step.audioMix);
		syncPlayerVoicing(step);

		const frameState: GpuFrame = {
			width: webglHost.width,
			height: webglHost.height,
			millis: now,
			deltaTime,
			rootPc,
			mode,
			hands,
			captureWidth: capW,
			captureHeight: capH,
			followerX,
			followerY,
			notes: step.hud.notes,
			degree: step.hud.degree,
			quality: step.hud.quality,
			bassActive: step.hud.bassActive,
			voicingChange: step.pendingVoicing,
			audioMix: step.audioMix
		};

		if (audioSketch) {
			session.tick(audioSketch.deltaTime);
		} else {
			session.tick(deltaTime);
		}

		if (simReady) {
			tickChain = tickChain
				.then(async () => {
					await gpuRenderer.tick(frameState);
					session.onSimFeedback(frameState.audioMix);
				})
				.catch((err) => {
					console.error('GPU boids tick failed', err);
				});
		}
		drawOverlay(hands, now);
	}

	const onCanvasPointer = (): void => {
		unlockAudioFromGesture();
	};

	return new Promise((resolve) => {
		void loadBrowserSketchDeps().then(() => {
			void import('p5').then(({ default: P5 }) => {
				audioP5 = new P5((p) => {
					p.preload = () => {
						capture = createMl5HandCapture(p);
						capture.prepare?.();
					};

					/** p5.sound needs the sketch loop for AudioContext + millis(). */
					p.draw = () => {};

					p.setup = () => {
						audioSketch = p;
						p.createCanvas(1, 1);
						p.canvas.style.display = 'none';
						gpuRenderer.initRng(p);
						options.onBoidsParamsBridge?.(gpuRenderer);
						capture?.start();
						mountCaptureVideo();
						session.setPlayer(createBoidsPlayer(p));
						followerX = webglHost.width / 2;
						followerY = webglHost.height / 2;
						input.seedFollower?.(followerX, followerY);

						try {
							const ctx = getNativeContext();
							if (ctx && ctx.state === 'running') {
								void ctx.suspend();
							}
						} catch {
							/* ignore */
						}

						options.onAudioControls?.({
							unlock: unlockAudioFromGesture,
							isReady: () => session.getPlayer()?.isReady?.() ?? false
						});
						options.onAudioReadyChange?.(false);

						webglHost.canvas.addEventListener('pointerdown', onCanvasPointer);
						webglHost.canvas.style.cursor = 'pointer';

						void gpuRenderer
							.bindHost(webglHost, webglHost.width, webglHost.height)
							.then(() => {
								gpuRenderer.setup(webglHost.width, webglHost.height);
								simReady = true;
								rafId = requestAnimationFrame(frame);
							})
							.catch((err) => {
								console.error('[gpu/boids] bindHost failed', err);
								simReady = true;
								rafId = requestAnimationFrame(frame);
							});
					};
				}, hiddenEl);

				resolve(() => {
					cancelAnimationFrame(rafId);
					webglHost.canvas.removeEventListener('pointerdown', onCanvasPointer);
					capture?.stop();
					session.destroy();
					gpuRenderer.destroy?.();
					webglHost.destroy();
					audioP5?.remove();
					audioSketch = undefined;
					options.onBoidsParamsBridge?.(null);
				});
			});
		});
	});
}
