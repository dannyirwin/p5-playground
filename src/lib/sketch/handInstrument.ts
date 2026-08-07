import type p5 from 'p5';

export interface HandKeypoint {
	x: number;
	y: number;
}

export interface Hand {
	handedness: string;
	keypoints: HandKeypoint[];
}

interface HandPose {
	detectStart: (
		video: p5.Element,
		callback: (results: Hand[]) => void
	) => void;
}

interface Ml5Api {
	handPose: (options: { maxHands: number }) => HandPose;
}

interface SoundFilter {
	freq: (value: number) => void;
}

interface SoundOscillator {
	disconnect: () => void;
	connect: (unit: SoundFilter) => void;
	freq: (value: number) => void;
	amp: (value: number, rampTime?: number) => void;
	start: () => void;
	stop: () => void;
}

interface P5SoundConstructors {
	Filter: new (type: string) => SoundFilter;
	Oscillator: new (type: string) => SoundOscillator;
}

interface StringState {
	midi: number;
	amplitude: number;
	lastPluck: number;
	active: boolean;
	originX: number;
	y: number;
}

type QualityName =
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

export interface HandInstrumentOptions {
	getShowVideo: () => boolean;
}

declare global {
	interface Window {
		ml5: Ml5Api;
	}
}

const majorScale = [0, 2, 4, 5, 7, 9, 11];
const rootMidi = 60; // C4

const qualityIntervals: Record<Exclude<QualityName, 'natural'>, number[]> = {
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

const FOLLOWER_ACCEL = 0.05;
const FOLLOWER_DAMPING = 0.8;
const FOLLOWER_MAX_SPEED = 60;
const SUSTAIN_LEVEL = 0.35;

function soundCtors(P5: typeof p5): P5SoundConstructors {
	return P5 as unknown as P5SoundConstructors;
}

/** p5 instance-mode sketch: webcam hand-tracking chord instrument. */
export function createHandInstrument(options: HandInstrumentOptions): (p: p5) => void {
	return (p: p5) => {
		let video: p5.Element | undefined;
		let handPose: HandPose | undefined;
		let hands: Hand[] = [];
		let voices: SoundOscillator[] = [];
		let filter: SoundFilter | undefined;
		let strings: StringState[] = [];

		let currentChordId: number | null = null;
		let chordStable = 0;
		let chordLastRaw = 0;
		let previousNotes: number[] | null = null;

		let followerX = 0;
		let followerY = 0;
		let followerVelX = 0;
		let followerVelY = 0;
		let lastHandTargetX = 0;
		let lastHandTargetY = 0;

		p.preload = () => {
			handPose = window.ml5.handPose({ maxHands: 2 });
		};

		p.setup = () => {
			p.createCanvas(640, 480);

			try {
				video = p.createCapture(p.VIDEO);
				video.size(640, 480);
				video.hide();
				handPose?.detectStart(video, (results) => {
					hands = results;
				});
			} catch (err) {
				console.warn('No webcam found', err);
				video = undefined;
			}

			const ctors = soundCtors(p.constructor as typeof p5);
			filter = new ctors.Filter('lowpass');
			filter.freq(2000);

			setupStrings();
			followerX = lastHandTargetX = p.width / 2;
			followerY = lastHandTargetY = p.height / 2;
		};

		p.mousePressed = () => {
			void p.userStartAudio();
		};

		p.draw = () => {
			p.background(10, 12, 13);

			if (options.getShowVideo() && video) {
				p.push();
				p.translate(p.width, 0);
				p.scale(-1, 1);
				p.image(video as unknown as p5.Image, 0, 0, p.width, p.height);
				p.pop();
			}

			for (const hand of hands) {
				p.noStroke();
				p.fill(94, 230, 168);
				for (const kp of hand.keypoints) {
					p.circle(p.width - kp.x, kp.y, 6);
				}
			}

			const chordHand =
				hands.find((h) => h.handedness === 'Left') || hands[0] || null;
			const modHand = hands.find((h) => h !== chordHand) || null;

			if (chordHand) {
				lastHandTargetX = chordHand.keypoints[9].x;
				lastHandTargetY = chordHand.keypoints[9].y;
			}
			updateFollower(lastHandTargetX, lastHandTargetY);

			const quality = modHand ? getModifierQuality(modHand) : 'major';

			if (chordHand) {
				const chordId = classifyASLNumber(chordHand);
				if (chordId === chordLastRaw) chordStable++;
				else {
					chordStable = 0;
					chordLastRaw = chordId;
				}

				if (chordStable === 5 && chordId !== currentChordId) {
					if (chordId === 0) {
						stopChord();
						previousNotes = null;
						for (const s of strings) s.active = false;
					} else {
						const targetPCs = chordPitchClassesForQuality(chordId, quality);
						const targetMidi = targetMidiFromHandY(followerY);
						const voicing = closestVoicingToDot(targetPCs, targetMidi);
						playVoicing(voicing, 0.5, followerX);
						previousNotes = voicing;
					}
					currentChordId = chordId;
				}
			}

			updateStrings();
			drawStrings();

			p.noStroke();
			p.fill(94, 230, 168, 180);
			p.circle(p.width - followerX, followerY, 18);

			p.fill(255);
			p.noStroke();
			p.textSize(16);
			p.text('Chord: ' + (currentChordId ? currentChordId : '-'), 10, 24);
			p.text('Quality: ' + quality, 10, 44);
			p.text(
				'Notes: ' + (previousNotes ? previousNotes.join(',') : '-'),
				10,
				64
			);
		};

		function midiNumberToHz(m: number): number {
			return 440 * p.pow(2, (m - 69) / 12);
		}

		function updateFollower(targetX: number, targetY: number): void {
			const dx = targetX - followerX;
			const dy = targetY - followerY;

			const accX = dx * FOLLOWER_ACCEL;
			const accY = dy * FOLLOWER_ACCEL;

			followerVelX = (followerVelX + accX) * FOLLOWER_DAMPING;
			followerVelY = (followerVelY + accY) * FOLLOWER_DAMPING;

			const speed = Math.hypot(followerVelX, followerVelY);
			if (speed > FOLLOWER_MAX_SPEED) {
				const scale = FOLLOWER_MAX_SPEED / speed;
				followerVelX *= scale;
				followerVelY *= scale;
			}

			followerX += followerVelX;
			followerY += followerVelY;
		}

		function setupStrings(): void {
			const lowMidi = 36;
			const highMidi = 96;
			strings = [];
			for (let m = lowMidi; m <= highMidi; m++) {
				strings.push({
					midi: m,
					amplitude: 0,
					lastPluck: 0,
					active: false,
					originX: p.width / 2,
					y: 0
				});
			}
			strings.forEach((s, i) => {
				s.y = p.map(i, 0, strings.length - 1, p.height - 20, 20);
			});
		}

		function nearestString(midi: number): StringState {
			return strings.reduce((best, s) =>
				Math.abs(s.midi - midi) < Math.abs(best.midi - midi) ? s : best
			);
		}

		function updateStrings(): void {
			for (const s of strings) {
				const floor = s.active ? SUSTAIN_LEVEL : 0;
				if (Math.abs(s.amplitude - floor) > 0.001) {
					const tau = p.map(s.midi, 36, 96, 900, 300);
					s.amplitude = floor + (s.amplitude - floor) * p.exp(-p.deltaTime / tau);
				} else {
					s.amplitude = floor;
				}
			}
		}

		function drawStrings(): void {
			p.noFill();
			for (const s of strings) {
				const elapsed = p.millis() - s.lastPluck;
				const alpha = p.lerp(50, 255, p.constrain(s.amplitude, 0, 1));
				const weight = p.lerp(1, 2, p.constrain(s.amplitude, 0, 1));
				p.stroke(94, 230, 168, alpha);
				p.strokeWeight(weight);

				const originX = s.originX;
				const spatialFreq = p.map(s.midi, 36, 96, 0.12, 0.22);
				const travelSpeed = p.map(s.midi, 36, 96, 0.015, 0.03);

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

		function playVoicing(notes: number[], x: number, handX: number): void {
			stopChord();
			if (!filter) return;

			const activatedStrings = notes.map((note) => nearestString(note));
			const activatedSet = new Set(activatedStrings);

			for (const s of strings) {
				if (activatedSet.has(s)) {
					if (!s.active) {
						s.amplitude = 1;
						s.lastPluck = p.millis();
					}
					s.originX = handX;
					s.active = true;
				} else {
					s.active = false;
				}
			}

			const ctors = soundCtors(p.constructor as typeof p5);
			for (const note of notes) {
				const osc = new ctors.Oscillator('sawtooth');
				osc.disconnect();
				osc.connect(filter);
				osc.freq(midiNumberToHz(note));
				osc.amp(0);
				osc.start();
				osc.amp(0.15, 0.05);
				voices.push(osc);
			}
			filter.freq(300 + x * 4000);
		}

		function stopChord(): void {
			for (const osc of voices) {
				osc.amp(0, 0.08);
				setTimeout(() => osc.stop(), 150);
			}
			voices = [];
		}

		function scaleDegreeMidi(idx: number): number {
			const oct = Math.floor(idx / majorScale.length);
			const deg =
				((idx % majorScale.length) + majorScale.length) % majorScale.length;
			return rootMidi + oct * 12 + majorScale[deg];
		}

		function chordPitchClassesForQuality(
			chordDigit: number,
			qualityName: QualityName
		): number[] {
			const rootIdx = chordDigit - 1;

			if (qualityName === 'natural') {
				return [0, 2, 4].map(
					(off) => ((scaleDegreeMidi(rootIdx + off) % 12) + 12) % 12
				);
			}

			const rootPc = ((scaleDegreeMidi(rootIdx) % 12) + 12) % 12;
			const intervals = qualityIntervals[qualityName];
			return intervals.map((iv) => (rootPc + iv) % 12);
		}

		function targetMidiFromHandY(y: number): number {
			const lowMidi = 36;
			const highMidi = 96;
			return p.constrain(
				p.map(y, p.height - 20, 20, lowMidi, highMidi),
				lowMidi,
				highMidi
			);
		}

		function nearestNote(pitchClass: number, reference: number): number {
			const candidate =
				Math.round((reference - pitchClass) / 12) * 12 + pitchClass;
			return [candidate - 12, candidate, candidate + 12].reduce((best, c) =>
				Math.abs(c - reference) < Math.abs(best - reference) ? c : best
			);
		}

		function closestVoicingToDot(
			targetPitchClasses: number[],
			targetMidi: number
		): number[] {
			return targetPitchClasses.map((pc) => nearestNote(pc, targetMidi));
		}

		function classifyASLNumber(hand: Hand): number {
			const kp = hand.keypoints;
			const wrist = kp[0];
			const scale = p.dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
			const d = (a: HandKeypoint, b: HandKeypoint) =>
				p.dist(a.x, a.y, b.x, b.y);
			const up = (tip: number, pip: number) =>
				d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.1;
			const touching = (tipIdx: number) => d(kp[4], kp[tipIdx]) < scale * 0.5;

			const indexUp = up(8, 6);
			const middleUp = up(12, 10);
			const ringUp = up(16, 14);
			const pinkyUp = up(20, 18);
			const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.05;
			const upCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

			if (upCount === 1 && indexUp) return 1;
			if (upCount === 2 && indexUp && middleUp) return thumbOut ? 3 : 2;
			if (upCount === 4) return thumbOut ? 5 : 4;
			if (upCount === 3) {
				if (!pinkyUp && touching(20)) return 6;
				if (!ringUp && touching(16)) return 7;
				if (!middleUp && touching(12)) return 8;
			}
			return 0;
		}

		function getModifierQuality(modHand: Hand): QualityName {
			const kp = modHand.keypoints;
			const wrist = kp[0];
			const d = (a: HandKeypoint, b: HandKeypoint) =>
				p.dist(a.x, a.y, b.x, b.y);
			const up = (tip: number, pip: number) =>
				d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.1;

			const indexUp = up(8, 6);
			const middleUp = up(12, 10);
			const ringUp = up(16, 14);
			const pinkyUp = up(20, 18);
			const thumbExtended = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.3;

			if (!thumbExtended && !indexUp && ringUp && pinkyUp) {
				return middleUp ? 'sus4' : 'sus2';
			}

			let tilt: 'neutral' | 'up' | 'down' = 'neutral';
			if (indexUp) {
				const indexMcp = kp[5];
				const indexTip = kp[8];
				const dx = indexTip.x - indexMcp.x;
				const dy = indexTip.y - indexMcp.y;
				const angle = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
				const THRESH = 40;
				if (angle <= -THRESH) tilt = 'up';
				else if (angle >= THRESH) tilt = 'down';
			}

			let topCount = 0;
			if (indexUp) topCount = middleUp ? 2 : 1;

			if (thumbExtended) {
				if (topCount === 0) return 'dominant7';
				if (topCount === 1) {
					if (tilt === 'up') return 'augmented7';
					if (tilt === 'down') return 'halfDiminished7';
					return 'major7';
				}
				return tilt === 'down' ? 'diminished7' : 'minor7';
			}

			if (topCount === 0) return 'natural';
			if (topCount === 1) return tilt === 'up' ? 'augmented' : 'major';
			return tilt === 'down' ? 'diminished' : 'minor';
		}
	};
}
