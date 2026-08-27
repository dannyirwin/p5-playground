import type p5 from 'p5';
import type { VoicingChange } from '../instrument/events.ts';
import type { InstrumentHudState, RendererAudioMix } from '../instrument/hud.ts';
import type { PitchClass, ScaleMode } from './harmony.ts';
import type { InstrumentPlayer } from '../instrument/player/types.ts';
import type { QualityName } from '../instrument/quality.ts';
import type { RenderModeId } from '../instrument/modes/ids.ts';
import type { BoidsParams } from './renderers/boidsParams.ts';
import type { BoidsParamsBridge } from './renderers/boids.ts';

export type { InstrumentPlayer };
export type { InstrumentHudState, RendererAudioMix, RenderModeId, QualityName };
export type { PitchClass, ScaleMode };
export type { InstrumentHostId } from '../instrument/modes/ids.ts';

export interface HandKeypoint {
	x: number;
	y: number;
}

export interface Hand {
	handedness: string;
	keypoints: HandKeypoint[];
}

export interface AudioControls {
	unlock: () => void;
	isReady: () => boolean;
}

/**
 * @deprecated Use VoicingChange via frame.voicingChange or renderer.onVoicing.
 */
export interface NoteEvent {
	notes: number[];
	originX: number;
}

export function noteEventFromVoicing(event: VoicingChange): NoteEvent {
	return { notes: event.notes, originX: event.originX };
}

/** Snapshot of controller + music state handed to the active renderer each draw. */
export interface InstrumentFrame {
	width: number;
	height: number;
	millis: number;
	deltaTime: number;
	rootPc: PitchClass;
	mode: ScaleMode;
	hands: Hand[];
	captureWidth: number;
	captureHeight: number;
	followerX: number;
	followerY: number;
	notes: number[] | null;
	degree: number | null;
	quality: QualityName | null;
	bassActive: boolean;
	voicingChange: VoicingChange | null;
	/** @deprecated Prefer voicingChange. */
	noteEvent: NoteEvent | null;
	audioMix: RendererAudioMix;
}

export interface Renderer {
	id: RenderModeId;
	label: string;
	setup?(p: p5): void;
	resize?(p: p5): void;
	draw(p: p5, frame: InstrumentFrame): void;
	onVoicing?(p: p5, event: VoicingChange, audioMix: RendererAudioMix): void;
	onRelease?(p: p5): void;
	destroy?(): void;
}

export interface InstrumentOptions {
	getShowVideo: () => boolean;
	getShowHands: () => boolean;
	getRootPc: () => PitchClass;
	getMode: () => ScaleMode;
	onHudUpdate?: (state: InstrumentHudState) => void;
	onAudioControls?: (controls: AudioControls) => void;
	onAudioReadyChange?: (ready: boolean) => void;
}

export interface InstrumentCoreOptions extends InstrumentOptions {
	getRenderer: () => Renderer;
	getPlayer: (p: p5) => InstrumentPlayer;
}

export interface SketchOptions extends InstrumentOptions {
	getRenderMode: () => RenderModeId;
	initialBoidsParams?: BoidsParams;
	onBoidsParamsBridge?: (bridge: BoidsParamsBridge | null) => void;
}
