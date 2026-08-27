import type { QualityName } from '../quality.ts';

export const QUALITY_INTERVALS: Record<Exclude<QualityName, 'natural'>, number[]> = {
	major: [0, 4, 7],
	minor: [0, 3, 7],
	sus2: [0, 2, 7],
	sus4: [0, 5, 7],
	augmented: [0, 4, 8],
	diminished: [0, 3, 6],
	dominant7: [0, 4, 7, 10],
	major7: [0, 4, 7, 11],
	minor7: [0, 3, 7, 10],
	augmented7: [0, 4, 8, 10],
	halfDiminished7: [0, 3, 6, 10],
	diminished7: [0, 3, 6, 9]
};

export const VOICING_LOW_MIDI = 48;
export const VOICING_HIGH_MIDI = 84;
export const VOICING_Y_MARGIN = 20;
/** Hand must move this far (px) before inversion re-voicing arms. */
export const VOICING_COMMIT_DEADZONE = 58;
/** Anchor band (px) — Y must stay within this while the settle timer runs. */
export const VOICING_SETTLE_Y = 22;
/** How long Y must hold steady before an inversion commit (ms). */
export const VOICING_SETTLE_MS = 190;
