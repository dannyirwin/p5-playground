/** Pitch class 0 = C … 11 = B. */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/**
 * Scale / mode ids used by the instrument.
 * `minor` is natural minor (Aeolian), kept for localStorage compatibility.
 */
export type ScaleMode =
	| 'major'
	| 'minor'
	| 'harmonic-minor'
	| 'melodic-minor'
	| 'dorian'
	| 'phrygian'
	| 'lydian'
	| 'mixolydian'
	| 'locrian'
	| 'major-pentatonic'
	| 'minor-pentatonic'
	| 'major-blues'
	| 'minor-blues';

/** Natural triad quality for a scale degree (stacked thirds, classified). */
export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';

export const PITCH_CLASS_NAMES = [
	'C',
	'C#',
	'D',
	'D#',
	'E',
	'F',
	'F#',
	'G',
	'G#',
	'A',
	'A#',
	'B'
] as const;

interface ScaleDef {
	id: ScaleMode;
	/** Short label for the Mode dropdown / key HUD. */
	label: string;
	/** Semitone offsets from the tonic, ascending within one octave. */
	intervals: readonly number[];
}

/**
 * Popular scales for the Mode control.
 * Heptatonic modes use stacked-third triads; shorter scales only expose
 * as many degree poses as they have tones (higher poses release).
 */
export const SCALE_DEFS: readonly ScaleDef[] = [
	{ id: 'major', label: 'major', intervals: [0, 2, 4, 5, 7, 9, 11] },
	{ id: 'minor', label: 'natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
	{
		id: 'harmonic-minor',
		label: 'harmonic minor',
		intervals: [0, 2, 3, 5, 7, 8, 11]
	},
	{
		id: 'melodic-minor',
		label: 'melodic minor',
		intervals: [0, 2, 3, 5, 7, 9, 11]
	},
	{ id: 'dorian', label: 'dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
	{ id: 'phrygian', label: 'phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
	{ id: 'lydian', label: 'lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
	{ id: 'mixolydian', label: 'mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
	{ id: 'locrian', label: 'locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
	{
		id: 'major-pentatonic',
		label: 'major pentatonic',
		intervals: [0, 2, 4, 7, 9]
	},
	{
		id: 'minor-pentatonic',
		label: 'minor pentatonic',
		intervals: [0, 3, 5, 7, 10]
	},
	{ id: 'major-blues', label: 'major blues', intervals: [0, 2, 3, 4, 7, 9] },
	{ id: 'minor-blues', label: 'minor blues', intervals: [0, 3, 5, 6, 7, 10] }
] as const;

const SCALE_BY_ID: Record<ScaleMode, ScaleDef> = Object.fromEntries(
	SCALE_DEFS.map((def) => [def.id, def])
) as Record<ScaleMode, ScaleDef>;

export function isScaleMode(value: unknown): value is ScaleMode {
	return typeof value === 'string' && value in SCALE_BY_ID;
}

export function scaleIntervals(mode: ScaleMode): readonly number[] {
	return SCALE_BY_ID[mode].intervals;
}

export function scaleDegreeCount(mode: ScaleMode): number {
	return SCALE_BY_ID[mode].intervals.length;
}

export function scaleModeLabel(mode: ScaleMode): string {
	return SCALE_BY_ID[mode].label;
}

/** Absolute scale tone for degree index 0 = tonic (may cross octaves). */
function scaleTone(intervals: readonly number[], degreeIndex: number): number {
	const n = intervals.length;
	const oct = Math.floor(degreeIndex / n);
	const deg = ((degreeIndex % n) + n) % n;
	return oct * 12 + intervals[deg];
}

/**
 * Natural triad on `degree` (1-based) via stacked scale thirds.
 * Degrees past the scale length return null (those poses release).
 */
export function diatonicTriadQuality(
	degree: number,
	mode: ScaleMode
): TriadQuality | null {
	const intervals = scaleIntervals(mode);
	if (degree < 1 || degree > intervals.length) return null;

	const rootIdx = degree - 1;
	const root = scaleTone(intervals, rootIdx);
	const third = scaleTone(intervals, rootIdx + 2);
	const fifth = scaleTone(intervals, rootIdx + 4);
	const i3 = ((third - root) % 12 + 12) % 12;
	const i5 = ((fifth - root) % 12 + 12) % 12;

	if (i3 === 4 && i5 === 7) return 'major';
	if (i3 === 3 && i5 === 7) return 'minor';
	if (i3 === 3 && i5 === 6) return 'diminished';
	if (i3 === 4 && i5 === 8) return 'augmented';

	if (i3 === 4) return 'major';
	if (i3 === 3) return 'minor';

	const tonicThird = scaleTone(intervals, 2) - scaleTone(intervals, 0);
	const tonicI3 = ((tonicThird % 12) + 12) % 12;
	return tonicI3 === 3 ? 'minor' : 'major';
}

/** MIDI note for scale degree index 0 = tonic, wrapping octaves. */
export function scaleDegreeMidi(
	rootMidi: number,
	mode: ScaleMode,
	degreeIndex: number
): number {
	return rootMidi + scaleTone(scaleIntervals(mode), degreeIndex);
}

/** C4 + pitch-class offset so root sits near middle C. */
export function rootMidiFromPc(rootPc: PitchClass): number {
	return 60 + rootPc;
}

export function formatKeyLabel(rootPc: PitchClass, mode: ScaleMode): string {
	return `${PITCH_CLASS_NAMES[rootPc]} ${scaleModeLabel(mode)}`;
}
