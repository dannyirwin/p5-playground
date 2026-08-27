import { describe, expect, it } from 'vitest';
import {
	closestVoicingToDot,
	handYFromMidi,
	nearestNote,
	targetMidiFromHandY
} from './voicing.ts';

describe('hand Y ↔ MIDI', () => {
	it('round-trips through the voicing range', () => {
		const h = 800;
		for (const midi of [48, 60, 72, 84]) {
			const y = handYFromMidi(midi, h);
			expect(targetMidiFromHandY(y, h)).toBeCloseTo(midi, 5);
		}
	});

	it('maps higher on screen to higher pitch', () => {
		const h = 800;
		expect(targetMidiFromHandY(100, h)).toBeGreaterThan(targetMidiFromHandY(700, h));
		expect(handYFromMidi(72, h)).toBeLessThan(handYFromMidi(48, h));
	});
});

describe('closestVoicingToDot', () => {
	it('keeps the chord centroid near the hand target', () => {
		const target = 60;
		const notes = closestVoicingToDot([0, 4, 7], target); // C E G
		const centroid = notes.reduce((a, b) => a + b, 0) / notes.length;
		expect(Math.abs(centroid - target)).toBeLessThan(4);
		for (const n of notes) {
			expect(Math.abs(n - target)).toBeLessThan(10);
		}
	});

	it('nearestNote picks the closest octave', () => {
		expect(nearestNote(0, 60)).toBe(60);
		expect(nearestNote(7, 60)).toBe(55); // G below C is closer than G above
	});
});
