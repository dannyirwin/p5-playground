/** Pitch class 0 = C … 11 = B. */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type ScaleMode = 'major' | 'minor';

/** Natural triad quality for a diatonic scale degree. */
export type TriadQuality = 'major' | 'minor' | 'diminished';

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

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
export const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

/** Degree 1–7 → natural triad quality in major. */
export const MAJOR_DIATONIC_TRIADS: readonly TriadQuality[] = [
	'major',
	'minor',
	'minor',
	'major',
	'major',
	'minor',
	'diminished'
];

/** Degree 1–7 → natural triad quality in natural minor. */
export const MINOR_DIATONIC_TRIADS: readonly TriadQuality[] = [
	'minor',
	'diminished',
	'major',
	'minor',
	'minor',
	'major',
	'major'
];

export function isPitchClass(n: number): n is PitchClass {
	return Number.isInteger(n) && n >= 0 && n <= 11;
}

export function scaleIntervals(mode: ScaleMode): readonly number[] {
	return mode === 'major' ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
}

export function diatonicTriadQuality(
	degree: number,
	mode: ScaleMode
): TriadQuality | null {
	if (degree < 1 || degree > 7) return null;
	const table = mode === 'major' ? MAJOR_DIATONIC_TRIADS : MINOR_DIATONIC_TRIADS;
	return table[degree - 1];
}

/** MIDI note for scale degree index 0 = tonic, wrapping octaves. */
export function scaleDegreeMidi(
	rootMidi: number,
	mode: ScaleMode,
	degreeIndex: number
): number {
	const scale = scaleIntervals(mode);
	const oct = Math.floor(degreeIndex / scale.length);
	const deg = ((degreeIndex % scale.length) + scale.length) % scale.length;
	return rootMidi + oct * 12 + scale[deg];
}

/** C4 + pitch-class offset so root sits near middle C. */
export function rootMidiFromPc(rootPc: PitchClass): number {
	return 60 + rootPc;
}

export function formatKeyLabel(rootPc: PitchClass, mode: ScaleMode): string {
	return `${PITCH_CLASS_NAMES[rootPc]} ${mode}`;
}
