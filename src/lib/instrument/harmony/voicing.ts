import {
	rootMidiFromPc,
	scaleDegreeMidi,
	type PitchClass,
	type ScaleMode
} from './scales.ts';
import { clamp, mapRange } from '../math.ts';
import type { QualityName } from '../quality.ts';
import {
	QUALITY_INTERVALS,
	VOICING_HIGH_MIDI,
	VOICING_LOW_MIDI,
	VOICING_Y_MARGIN
} from './constants.ts';

function degreeMidi(
	rootPc: PitchClass,
	mode: ScaleMode,
	degreeIndex: number
): number {
	return scaleDegreeMidi(rootMidiFromPc(rootPc), mode, degreeIndex);
}

export function chordPitchClassesForQuality(
	rootPc: PitchClass,
	mode: ScaleMode,
	chordDigit: number,
	qualityName: QualityName
): number[] {
	const rootIdx = chordDigit - 1;

	if (qualityName === 'natural') {
		return [0, 2, 4].map(
			(off) => ((degreeMidi(rootPc, mode, rootIdx + off) % 12) + 12) % 12
		);
	}

	const chordRootPc = ((degreeMidi(rootPc, mode, rootIdx) % 12) + 12) % 12;
	const intervals = QUALITY_INTERVALS[qualityName];
	return intervals.map((iv) => (chordRootPc + iv) % 12);
}

export function targetMidiFromHandY(
	y: number,
	canvasHeight: number
): number {
	return clamp(
		mapRange(
			y,
			canvasHeight - VOICING_Y_MARGIN,
			VOICING_Y_MARGIN,
			VOICING_LOW_MIDI,
			VOICING_HIGH_MIDI
		),
		VOICING_LOW_MIDI,
		VOICING_HIGH_MIDI
	);
}

/** Inverse of targetMidiFromHandY — string / cursor Y for a MIDI note. */
export function handYFromMidi(midi: number, canvasHeight: number): number {
	return mapRange(
		midi,
		VOICING_LOW_MIDI,
		VOICING_HIGH_MIDI,
		canvasHeight - VOICING_Y_MARGIN,
		VOICING_Y_MARGIN
	);
}

export function nearestNote(pitchClass: number, reference: number): number {
	const pc = ((pitchClass % 12) + 12) % 12;
	const candidate =
		Math.round((reference - pc) / 12) * 12 + pc;
	return [candidate - 12, candidate, candidate + 12].reduce((best, c) =>
		Math.abs(c - reference) < Math.abs(best - reference) ? c : best
	);
}

function voicingScore(notes: number[], targetMidi: number): number {
	const centroid = notes.reduce((a, b) => a + b, 0) / notes.length;
	const spread = notes.reduce((a, m) => a + Math.abs(m - targetMidi), 0);
	// Prefer chord centered on the hand target, then compact around it.
	return Math.abs(centroid - targetMidi) * notes.length * 3 + spread;
}

/**
 * Place each chord tone so the voicing sits on the hand target pitch
 * (centroid near targetMidi), not biased sharp of the cursor.
 */
export function closestVoicingToDot(
	targetPitchClasses: number[],
	targetMidi: number
): number[] {
	if (targetPitchClasses.length === 0) return [];

	let best: number[] = targetPitchClasses.map((pc) => nearestNote(pc, targetMidi));
	let bestScore = voicingScore(best, targetMidi);

	for (let delta = -12; delta <= 12; delta++) {
		const notes = targetPitchClasses.map((pc) => nearestNote(pc, targetMidi + delta));
		const score = voicingScore(notes, targetMidi);
		if (score < bestScore) {
			bestScore = score;
			best = notes;
		}
	}
	return best;
}

/** Root of the chord, one octave below the voiced root. */
export function applyBassNote(
	notes: number[],
	rootPc: number
): number[] {
	if (notes.length === 0) return notes;
	const roots = notes.filter((n) => ((n % 12) + 12) % 12 === rootPc);
	const chordRoot =
		roots.length > 0 ? Math.min(...roots) : Math.min(...notes);
	const bass = chordRoot - 12;
	if (notes.some((n) => n === bass)) return notes;
	return [bass, ...notes];
}

export function desiredVoicing(
	chordId: number,
	quality: QualityName,
	withBass: boolean,
	followerY: number,
	canvasHeight: number,
	rootPc: PitchClass,
	mode: ScaleMode
): number[] {
	const targetPCs = chordPitchClassesForQuality(rootPc, mode, chordId, quality);
	const targetMidi = targetMidiFromHandY(followerY, canvasHeight);
	const notes = closestVoicingToDot(targetPCs, targetMidi);
	if (!withBass) return notes;
	const bassRootPc = targetPCs[0];
	return applyBassNote(notes, bassRootPc);
}

export function noteSetKey(notes: number[]): string {
	return [...notes].sort((a, b) => a - b).join(',');
}

export function sameNoteSet(a: number[] | null, b: number[]): boolean {
	return a !== null && noteSetKey(a) === noteSetKey(b);
}

export function pitchClassKey(notes: number[]): string {
	return [...new Set(notes.map((n) => ((n % 12) + 12) % 12))]
		.sort((a, b) => a - b)
		.join(',');
}

export function samePitchClasses(a: number[] | null, b: number[]): boolean {
	return a !== null && pitchClassKey(a) === pitchClassKey(b);
}
