import type { QualityName } from './quality.ts';

/** HUD snapshot shared by session and all hosts. */
export interface InstrumentHudState {
	keyLabel: string;
	degree: number | null;
	tilt: 'inward' | 'outward' | 'neutral';
	degreeFacing: 'cam' | 'away' | null;
	quality: QualityName | null;
	qualitySource: 'mod' | 'triad' | 'none';
	modFacing: 'cam' | 'away' | null;
	bassMode: boolean;
	bassActive: boolean;
	notes: number[] | null;
	followerX: number;
	followerY: number;
	handsDetected: number;
	/** Live gesture reading (may differ from sounding degree while settling). */
	previewDegree: number | null;
	previewQuality: QualityName | null;
	/** True when preview differs from what is currently sounding. */
	isSettling: boolean;
	settleProgress: number;
}

/** Renderer → player feedback after each sim step. */
export interface RendererAudioMix {
	intensity: number;
	conversions: { midi: number; x: number; y: number }[];
}
