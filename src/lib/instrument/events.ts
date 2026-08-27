/** Typed events flowing through the instrument session. */

export interface VoicingChange {
	kind: 'voicing';
	notes: number[];
	/** Mirrored canvas-space x where the voicing was struck. */
	originX: number;
	reason: 'chord' | 'quality' | 'inversion' | 'bass' | 'key';
	bassActive: boolean;
}

export interface ReleaseEvent {
	kind: 'release';
}

export interface ConversionPing {
	midi: number;
	x: number;
	y: number;
}

/** Renderer → player feedback after each sim step. */
export interface SimFeedback {
	intensity: number;
	conversions: ConversionPing[];
}

export interface SimFeedbackEvent {
	kind: 'simFeedback';
	feedback: SimFeedback;
}

export type InstrumentEvent = VoicingChange | ReleaseEvent | SimFeedbackEvent;

export const EMPTY_SIM_FEEDBACK: SimFeedback = {
	intensity: 1,
	conversions: []
};
