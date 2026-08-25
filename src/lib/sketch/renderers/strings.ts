import type p5 from 'p5';
import type { InstrumentFrame, Renderer } from '../types.ts';

interface StringState {
	midi: number;
	amplitude: number;
	lastPluck: number;
	active: boolean;
	originX: number;
	y: number;
}

/** Inclusive MIDI range for drawn strings (includes bass octave). */
const STRING_LOW_MIDI = 36;
const STRING_HIGH_MIDI = 84;
/** Vertical margin (px) so the outer strings stay off the canvas edge. */
const STRING_Y_MARGIN = 20;
const SUSTAIN_LEVEL = 0.35;
/** Vertical falloff (px) for proximity glow around the follower dot. */
const PROXIMITY_FALLOFF = 52;

/** Vibrating-strings visualization: one string per semitone, plucked by voicings. */
export function createStringsRenderer(): Renderer {
	let strings: StringState[] = [];

	function layoutStringYs(p: p5): void {
		if (strings.length === 0) return;
		strings.forEach((s, i) => {
			s.y = p.map(i, 0, strings.length - 1, p.height - STRING_Y_MARGIN, STRING_Y_MARGIN);
		});
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
		p.noFill();
		for (const s of strings) {
			const elapsed = frame.millis - s.lastPluck;
			const isRoot = ((s.midi % 12) + 12) % 12 === frame.rootPc;
			const proximity = p.exp(-p.abs(s.y - frame.followerY) / PROXIMITY_FALLOFF);
			const amp = p.constrain(s.amplitude, 0, 1);

			// Idle glow tracks the follower so nearby (playable) notes read clearly;
			// roots stay brighter overall for key context. Pluck amplitude can still
			// push a string to full intensity.
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

			if (isRoot) {
				// Brighter, slightly warmer teal so scale roots stand out.
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
			const spatialFreq = p.map(
				s.midi,
				STRING_LOW_MIDI,
				STRING_HIGH_MIDI,
				0.07,
				0.48
			);
			const travelSpeed = p.map(
				s.midi,
				STRING_LOW_MIDI,
				STRING_HIGH_MIDI,
				0.012,
				0.055
			);

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

		draw(p, frame) {
			if (frame.notes === null) {
				for (const s of strings) s.active = false;
			}
			if (frame.noteEvent) {
				pluck(frame.noteEvent.notes, frame.noteEvent.originX, frame.millis);
			}

			updateAmplitudes(p, frame.deltaTime);
			drawStrings(p, frame);

			p.noStroke();
			p.fill(94, 230, 168, 180);
			p.circle(frame.width - frame.followerX, frame.followerY, 18);
		},

		destroy() {
			strings = [];
		}
	};
}
