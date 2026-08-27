import type { VoicingChange } from '../instrument/events.ts';
import type { InstrumentHudState, RendererAudioMix } from '../instrument/hud.ts';
import type { PitchClass, ScaleMode } from '../instrument/harmony/scales.ts';
import type { QualityName } from '../instrument/quality.ts';
import type { HandSnapshot } from '../instrument/hands.ts';

/** Frame snapshot for WebGL renderers (mirrors p5 InstrumentFrame). */
export interface GpuFrame {
	width: number;
	height: number;
	millis: number;
	deltaTime: number;
	rootPc: PitchClass;
	mode: ScaleMode;
	hands: readonly HandSnapshot[];
	captureWidth: number;
	captureHeight: number;
	followerX: number;
	followerY: number;
	notes: number[] | null;
	degree: number | null;
	quality: QualityName | null;
	bassActive: boolean;
	voicingChange: VoicingChange | null;
	audioMix: RendererAudioMix;
}

export interface GpuRenderer {
	readonly id: string;
	setup(width: number, height: number): void;
	resize(width: number, height: number): void;
	draw(frame: GpuFrame): void;
	onVoicing?(event: VoicingChange, audioMix: RendererAudioMix): void;
	onRelease?(): void;
	destroy?(): void;
}

export interface WebGLHost {
	readonly canvas: HTMLCanvasElement;
	readonly overlayCanvas: HTMLCanvasElement;
	readonly width: number;
	readonly height: number;
	resize(): void;
	render(): void;
	destroy(): void;
}

export type { InstrumentHudState };
