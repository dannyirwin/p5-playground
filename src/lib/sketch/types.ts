import type p5 from 'p5';
import type { PitchClass, ScaleMode } from './harmony.ts';

export interface HandKeypoint {
	x: number;
	y: number;
}

export interface Hand {
	handedness: string;
	keypoints: HandKeypoint[];
}

export type QualityName =
	| 'major'
	| 'minor'
	| 'sus2'
	| 'sus4'
	| 'augmented'
	| 'diminished'
	| 'dominant7'
	| 'major7'
	| 'minor7'
	| 'augmented7'
	| 'halfDiminished7'
	| 'diminished7'
	| 'natural';

export interface InstrumentHudState {
	keyLabel: string;
	degree: number | null;
	tilt: 'inward' | 'outward' | 'neutral';
	degreeFacing: 'cam' | 'away' | null;
	quality: QualityName | null;
	qualitySource: 'mod' | 'triad' | 'none';
	modFacing: 'cam' | 'away' | null;
	/** Latched toggle from the modifier gesture. */
	bassMode: boolean;
	/** Whether the currently sounding chord includes the −8ve root. */
	bassActive: boolean;
	notes: number[] | null;
	followerX: number;
	followerY: number;
	handsDetected: number;
}

export interface AudioControls {
	/** Call from a button click / touchend. Creates the sound graph if needed. */
	unlock: () => void;
	/** Whether unlock has succeeded and the graph is ready. */
	isReady: () => boolean;
}

/** Available visualizations. Unknown ids fall back to `strings`. */
export type RenderModeId = 'strings' | 'boids';

/**
 * Emitted on the frame a voicing starts or changes so renderers can pluck
 * without knowing anything about the audio graph.
 */
export interface NoteEvent {
	notes: number[];
	/** Canvas-space (mirrored) x the voicing was struck from. */
	originX: number;
}

/** Snapshot of controller + music state handed to the active renderer each draw. */
export interface InstrumentFrame {
	width: number;
	height: number;
	millis: number;
	deltaTime: number;
	rootPc: PitchClass;
	mode: ScaleMode;
	/** Keypoints are in webcam capture pixels, not canvas pixels. */
	hands: Hand[];
	captureWidth: number;
	captureHeight: number;
	/**
	 * Follower position in unmirrored canvas space: draw at
	 * `frame.width - frame.followerX` to line up with the mirrored video.
	 */
	followerX: number;
	followerY: number;
	notes: number[] | null;
	degree: number | null;
	quality: QualityName | null;
	bassActive: boolean;
	noteEvent: NoteEvent | null;
}

export interface Renderer {
	id: RenderModeId;
	label: string;
	setup?(p: p5): void;
	resize?(p: p5): void;
	draw(p: p5, frame: InstrumentFrame): void;
	destroy?(): void;
}

/** Options shared by the controller core and the sketch factory. */
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
}

export interface SketchOptions extends InstrumentOptions {
	getRenderMode: () => RenderModeId;
}
