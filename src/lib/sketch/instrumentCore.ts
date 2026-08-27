import type p5 from 'p5';
import { createHarmonyController } from '../instrument/harmony/controller.ts';
import type { AudioHost } from '../instrument/hosts.ts';
import type { VoicingChange } from '../instrument/events.ts';
import { createInputRecognizer } from '../instrument/input/recognizer.ts';
import { createInstrumentSession } from '../instrument/session.ts';
import type { PitchClass, ScaleMode } from './harmony.ts';
import type {
	Hand,
	InstrumentCoreOptions,
	InstrumentFrame,
	InstrumentHudState,
	Renderer,
	RendererAudioMix
} from './types.ts';
import { noteEventFromVoicing } from './types.ts';
import { drawHandKeypoints as drawHandsOverlay } from '../instrument/overlay/hands.ts';

interface HandPose {
	detectStart: (
		video: p5.Element,
		callback: (results: Hand[]) => void
	) => void;
}

interface Ml5Api {
	handPose: (options: { maxHands: number }) => HandPose;
}

type P5WithSound = p5 & {
	userStartAudio: () => Promise<void>;
};

declare global {
	interface Window {
		ml5: Ml5Api;
	}
}

/**
 * p5 host adapter: webcam capture, coordinate transforms, hand overlay,
 * and session wiring. Music logic lives in `createInstrumentSession`.
 */
export function createInstrumentCore(
	options: InstrumentCoreOptions
): (p: p5) => void {
	return (p: p5) => {
		let video: p5.Element | undefined;
		let handPose: HandPose | undefined;
		let hands: Hand[] = [];

		let activeRenderer: Renderer | undefined;
		let lastRootPc: PitchClass = options.getRootPc();
		let lastMode: ScaleMode = options.getMode();
		let followerX = 0;
		let followerY = 0;
		let hostResizeObserver: ResizeObserver | undefined;

		const input = createInputRecognizer();
		const session = createInstrumentSession({
			input,
			harmony: createHarmonyController(),
			onHudUpdate: options.onHudUpdate
		});

		function sizeFromParent(): { w: number; h: number } {
			const parent = p.canvas?.parentElement;
			if (parent) {
				const w = Math.floor(parent.clientWidth);
				const h = Math.floor(parent.clientHeight);
				if (w > 0 && h > 0) return { w, h };
			}
			return { w: p.windowWidth, h: p.windowHeight };
		}

		function fitCanvasToParent(): void {
			const { w, h } = sizeFromParent();
			if (w === p.width && h === p.height) return;
			p.resizeCanvas(w, h);
			activeRenderer?.resize?.(p);
		}

		function captureSize(): { w: number; h: number } {
			if (video) {
				const w = video.width as number;
				const h = video.height as number;
				if (w > 0 && h > 0) return { w, h };
			}
			return { w: 640, h: 480 };
		}

		function scaleCaptureX(x: number): number {
			const { w } = captureSize();
			return (x / w) * p.width;
		}

		function scaleCaptureY(y: number): number {
			const { h } = captureSize();
			return (y / h) * p.height;
		}

		function getNativeContext(): AudioContext | undefined {
			try {
				const fromSketch = (
					p as p5 & { getAudioContext?: () => AudioContext }
				).getAudioContext?.();
				if (fromSketch) return fromSketch;
				return (
					window as unknown as { getAudioContext?: () => AudioContext }
				).getAudioContext?.();
			} catch {
				return undefined;
			}
		}

		function audioHost(): AudioHost {
			return {
				getContext: () => getNativeContext() ?? null,
				unlock: async () => {
					void (p as P5WithSound).userStartAudio?.();
				}
			};
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

		function unlockAudioFromGesture(): void {
			syncMode();
			session.unlockAudio(audioHost(), followerX, p.width);

			const ctx = getNativeContext();
			if (ctx) {
				kickSilentBuffer(ctx);
				if (ctx.state !== 'running') {
					void ctx.resume();
				}
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

		function syncMode(): void {
			session.setPlayer(options.getPlayer(p));

			const nextRenderer = options.getRenderer();
			if (nextRenderer === activeRenderer) return;
			activeRenderer?.destroy?.();
			activeRenderer = nextRenderer;
			activeRenderer.setup?.(p);
		}

		p.preload = () => {
			handPose = window.ml5.handPose({ maxHands: 2 });
		};

		p.setup = () => {
			// Parent exists once createCanvas attaches; size to host (not window) like GPU.
			p.createCanvas(p.windowWidth, p.windowHeight);
			fitCanvasToParent();

			const parent = p.canvas?.parentElement;
			if (parent && typeof ResizeObserver !== 'undefined') {
				hostResizeObserver = new ResizeObserver(() => fitCanvasToParent());
				hostResizeObserver.observe(parent);
			}

			try {
				video = p.createCapture('video');
				video.size(640, 480);
				video.hide();
				handPose?.detectStart(video, (results) => {
					hands = results;
				});
			} catch (err) {
				console.warn('No webcam found', err);
				video = undefined;
			}

			try {
				const ctx = getNativeContext();
				if (ctx && ctx.state === 'running') {
					void ctx.suspend();
				}
			} catch {
				/* ignore */
			}

			followerX = p.width / 2;
			followerY = p.height / 2;
			input.seedFollower?.(followerX, followerY);

			syncMode();

			options.onAudioControls?.({
				unlock: unlockAudioFromGesture,
				isReady: () => session.getPlayer()?.isReady?.() ?? false
			});
			options.onAudioReadyChange?.(false);
		};

		p.windowResized = () => {
			fitCanvasToParent();
		};

		p.mousePressed = () => {
			unlockAudioFromGesture();
		};

		p.touchEnded = () => {
			unlockAudioFromGesture();
			return false;
		};

		const p5WithRemove = p as p5 & {
			registerMethod?: (name: string, fn: (this: p5) => void) => void;
		};
		p5WithRemove.registerMethod?.('remove', function () {
			hostResizeObserver?.disconnect();
			hostResizeObserver = undefined;
		});

		p.draw = () => {
			syncMode();

			p.background(10, 12, 13);

			if (options.getShowVideo() && video) {
				p.push();
				p.translate(p.width, 0);
				p.scale(-1, 1);
				p.image(video as unknown as p5.Image, 0, 0, p.width, p.height);
				p.pop();
			}

			const rootPc = options.getRootPc();
			const mode = options.getMode();
			const keyOrModeChanged = rootPc !== lastRootPc || mode !== lastMode;
			if (keyOrModeChanged) {
				lastRootPc = rootPc;
				lastMode = mode;
			}

			const { w, h } = captureSize();
			const inputUpdate = input.update(
				hands,
				rootPc,
				mode,
				p.width,
				p.height,
				w,
				h,
				p.millis(),
				p.deltaTime
			);
			followerX = inputUpdate.intent.follower.x;
			followerY = inputUpdate.intent.follower.y;

			const step = session.step({
				input: inputUpdate,
				rootPc,
				mode,
				canvasWidth: p.width,
				canvasHeight: p.height,
				keyOrModeChanged,
				deltaMs: p.deltaTime
			});

			if (step.pendingRelease) {
				activeRenderer?.onRelease?.(p);
			}
			if (step.pendingVoicing) {
				activeRenderer?.onVoicing?.(p, step.pendingVoicing, step.audioMix);
			}

			const frame = buildFrame(step.hud, step.audioMix, step.pendingVoicing);
			activeRenderer?.draw(p, frame);
			session.onSimFeedback(frame.audioMix);
			session.tick(p.deltaTime);

			// Strings draws its own octave cursor; keep the shared dot for other modes.
			if (activeRenderer?.id !== 'strings') {
				drawFollowerDot();
			}
			if (options.getShowHands()) {
				const { w, h } = captureSize();
				drawHandsOverlay(
					p.drawingContext as CanvasRenderingContext2D,
					hands,
					p.width,
					p.height,
					w,
					h,
					p.millis(),
					followerX,
					followerY
				);
			}
		};

		function drawFollowerDot(): void {
			p.noStroke();
			p.fill(94, 230, 168, 180);
			p.circle(p.width - followerX, followerY, 18);
		}

		function buildFrame(
			hud: InstrumentHudState,
			audioMix: RendererAudioMix,
			voicingChange: VoicingChange | null
		): InstrumentFrame {
			const { w, h } = captureSize();
			return {
				width: p.width,
				height: p.height,
				millis: p.millis(),
				deltaTime: p.deltaTime,
				rootPc: options.getRootPc(),
				mode: options.getMode(),
				hands,
				captureWidth: w,
				captureHeight: h,
				followerX,
				followerY,
				notes: hud.notes,
				degree: hud.degree,
				quality: hud.quality,
				bassActive: hud.bassActive,
				voicingChange,
				noteEvent: voicingChange ? noteEventFromVoicing(voicingChange) : null,
				audioMix
			};
		}
	};
}
