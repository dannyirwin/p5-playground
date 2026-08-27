import type { HandSnapshot } from './hands.ts';

/** Webcam / ml5 / MediaPipe / fixture playback. */
export interface HandCapture {
	/** Load models (call from p5 preload when using ml5). */
	prepare?(): void;
	start(): void;
	stop(): void;
	/** Capture pixel width (for coordinate transforms). */
	readonly captureWidth: number;
	/** Capture pixel height. */
	readonly captureHeight: number;
	/** Latest hands from the most recent frame. */
	getHands(): readonly HandSnapshot[];
	/** Underlying video element, when available. */
	getVideoElement?(): HTMLVideoElement | null;
}

/** Opaque render surface provided by p5, Three, Canvas2D, etc. */
export interface RenderHost {
	width: number;
	height: number;
	/** Host-specific draw context; renderers cast internally. */
	ctx: unknown;
}

/** Audio unlock and context access — not tied to p5 or Tone. */
export interface AudioHost {
	getContext(): AudioContext | null;
	unlock(): Promise<void>;
}
