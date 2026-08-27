import type p5 from 'p5';
import type { InstrumentFrame, Renderer } from '../types.ts';
import type { VoicingChange } from '../../instrument/events.ts';
import { VOICING_HIGH_MIDI } from '../../instrument/harmony/constants.ts';
import {
	closestVoicingToDot,
	handYFromMidi,
	targetMidiFromHandY
} from '../../instrument/harmony/voicing.ts';

interface StringState {
	midi: number;
	amplitude: number;
	lastPluck: number;
	active: boolean;
	originX: number;
	y: number;
}

/** Drawn range — extends a bit below voicing for octave-bass notes. */
const STRING_LOW_MIDI = 36;
const STRING_HIGH_MIDI = VOICING_HIGH_MIDI;
const SUSTAIN_LEVEL = 0.35;
/** Soft glow falloff in semitones from the cursor's target pitch. */
const PROXIMITY_SEMITONES = 5.5;

/** Vibrating-strings visualization: one string per semitone, plucked by voicings. */
export function createStringsRenderer(): Renderer {
	let strings: StringState[] = [];
	let layoutHeight = 0;

	function layoutStringYs(p: p5): void {
		layoutHeight = p.height;
		for (const s of strings) {
			s.y = handYFromMidi(s.midi, p.height);
		}
	}

	function ensureLayout(p: p5): void {
		if (layoutHeight !== p.height) layoutStringYs(p);
	}

	function nearestString(midi: number): StringState {
		return strings.reduce((best, s) =>
			Math.abs(s.midi - midi) < Math.abs(best.midi - midi) ? s : best
		);
	}

	function pluck(notes: number[], originX: number, millis: number): void {
		const activated = new Set(notes.map((note) => nearestString(note)));
		for (const s of strings) {
			if (activated.has(s)) {
				if (!s.active) {
					s.amplitude = 1;
					s.lastPluck = millis;
				}
				s.originX = originX;
				s.active = true;
			} else {
				s.active = false;
			}
		}
	}

	function updateAmplitudes(p: p5, deltaTime: number): void {
		for (const s of strings) {
			const floor = s.active ? SUSTAIN_LEVEL : 0;
			if (Math.abs(s.amplitude - floor) > 0.001) {
				const tau = s.active
					? p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 700, 280)
					: p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 220, 110);
				s.amplitude = floor + (s.amplitude - floor) * p.exp(-deltaTime / tau);
			} else {
				s.amplitude = floor;
			}
		}
	}

	function drawStrings(p: p5, frame: InstrumentFrame): void {
		const targetMidi = targetMidiFromHandY(frame.followerY, frame.height);
		// Chord tones closest to the cursor — same picker the synth uses.
		const cursorChord = frame.notes
			? closestVoicingToDot(
					[...new Set(frame.notes.map((n) => ((n % 12) + 12) % 12))],
					targetMidi
				)
			: [];
		const cursorChordSet = new Set(cursorChord);

		p.noFill();
		for (const s of strings) {
			const elapsed = frame.millis - s.lastPluck;
			const isRoot = ((s.midi % 12) + 12) % 12 === frame.rootPc;
			const nearCursor = Math.exp(
				-Math.abs(s.midi - targetMidi) / PROXIMITY_SEMITONES
			);
			const isCursorChord = cursorChordSet.has(s.midi);
			const proximity = isCursorChord
				? Math.max(nearCursor, 0.85)
				: nearCursor * (frame.notes ? 0.35 : 1);
			const amp = p.constrain(s.amplitude, 0, 1);

			const idleAlpha = p.lerp(
				isRoot ? 72 : 18,
				isRoot ? 230 : 175,
				proximity
			);
			const alpha = Math.max(idleAlpha, p.lerp(0, 255, amp));
			const weight = p.lerp(
				isRoot ? 1.25 : 0.85,
				2.15,
				Math.max(proximity * 0.55, amp)
			);

			if (isCursorChord && !s.active) {
				p.stroke(120, 220, 180, 160 + 60 * nearCursor);
			} else if (isRoot) {
				p.stroke(
					p.lerp(150, 220, proximity),
					p.lerp(235, 255, proximity),
					p.lerp(200, 235, proximity),
					alpha
				);
			} else {
				p.stroke(
					p.lerp(70, 110, proximity),
					p.lerp(160, 230, proximity),
					p.lerp(130, 180, proximity),
					alpha
				);
			}
			p.strokeWeight(weight);

			const originX = frame.width - frame.followerX;
			const spatialFreq = p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 0.07, 0.48);
			const travelSpeed = p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 0.012, 0.055);

			p.beginShape();
			for (let x = 0; x <= p.width; x += 4) {
				const distFromOrigin = p.abs(x - originX);
				const envelope = p.exp(-distFromOrigin / 90);
				const wiggle = p.sin(distFromOrigin * spatialFreq - elapsed * travelSpeed);
				const displacement = s.amplitude * 7 * envelope * wiggle;
				p.vertex(x, s.y + displacement);
			}
			p.endShape();
		}
	}

	/** Register marker on the voicing Y for the cursor's target pitch. */
	function drawOctaveCursor(p: p5, frame: InstrumentFrame): void {
		const targetMidi = targetMidiFromHandY(frame.followerY, frame.height);
		const y = handYFromMidi(targetMidi, frame.height);
		const x = frame.width - frame.followerX;
		p.noStroke();
		p.fill(94, 230, 168, 210);
		p.circle(x, y, 16);
		p.noFill();
		p.stroke(94, 230, 168, 140);
		p.strokeWeight(1.5);
		p.circle(x, y, 26);
	}

	return {
		id: 'strings',
		label: 'Strings',

		setup(p) {
			strings = [];
			for (let m = STRING_LOW_MIDI; m <= STRING_HIGH_MIDI; m++) {
				strings.push({
					midi: m,
					amplitude: 0,
					lastPluck: 0,
					active: false,
					originX: p.width / 2,
					y: 0
				});
			}
			layoutStringYs(p);
		},

		resize(p) {
			layoutStringYs(p);
		},

		onVoicing(p, event, _audioMix) {
			pluck(event.notes, event.originX, p.millis());
		},

		onRelease() {
			for (const s of strings) s.active = false;
		},

		draw(p, frame) {
			ensureLayout(p);
			if (frame.notes === null) {
				for (const s of strings) s.active = false;
			}

			updateAmplitudes(p, frame.deltaTime);
			drawStrings(p, frame);
			drawOctaveCursor(p, frame);
		},

		destroy() {
			strings = [];
			layoutHeight = 0;
		}
	};
}
