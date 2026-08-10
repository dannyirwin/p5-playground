import type p5 from 'p5';
import {
	formatKeyLabel,
	rootMidiFromPc,
	scaleDegreeMidi,
	type PitchClass,
	type ScaleMode
} from './harmony.ts';

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

/** Instance methods added by the p5.sound addon at runtime. */
type P5WithSound = p5 & {
	userStartAudio: () => Promise<void>;
};

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
	getRootPc: () => PitchClass;
	getMode: () => ScaleMode;
}

declare global {
	interface Window {
		ml5: Ml5Api;
	}
}

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
/** Vertical falloff (px) for proximity glow around the follower dot. */
const PROXIMITY_FALLOFF = 52;
/** Seconds to fade oscillators to silence on release / chord change. */
const RELEASE_TIME = 0.55;
const RELEASE_STOP_MS = 650;
/** Chord / quality gesture settle (frames). */
const SETTLE_FRAMES = 5;
/** Longer hold so vertical voicing only shifts after the hand parks. */
const VOICING_SETTLE_FRAMES = 36;
/** Max follower Y drift (px) still counted as "parked". */
const VOICING_SETTLE_Y = 12;
/**
 * After a voicing commits, ignore Y motion until the hand leaves this
 * deadzone (px) - stops small drifts from flipping inversions.
 */
const VOICING_COMMIT_DEADZONE = 48;

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
		let currentQuality: QualityName = 'major';
		let previousNotes: number[] | null = null;
		let lastRootPc: PitchClass = options.getRootPc();
		let lastMode: ScaleMode = options.getMode();

		/** Joint degree+quality raw key; both hands share one settle clock. */
		let harmonyLastRaw = '0|major';
		let harmonyStable = 0;
		let chordLastRaw = 0;

		let voicingCommitY = 0;
		let voicingArmed = false;
		let voicingAnchorY = 0;
		let voicingStable = 0;

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
				video = p.createCapture('video');
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
			void (p as P5WithSound).userStartAudio();
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

			const { chordHand, modHand } = assignChordAndModHands(hands);

			if (chordHand) {
				lastHandTargetX = chordHand.keypoints[9].x;
				lastHandTargetY = chordHand.keypoints[9].y;
			}
			updateFollower(lastHandTargetX, lastHandTargetY);

			const rootPc = options.getRootPc();
			const mode = options.getMode();
			if (rootPc !== lastRootPc || mode !== lastMode) {
				lastRootPc = rootPc;
				lastMode = mode;
				if (currentChordId && currentChordId > 0) {
					startVoicing(currentChordId, currentQuality, {
						onlyIfChanged: false
					});
				}
			}

			const rawChordId = chordHand
				? classifyDegree(chordHand)
				: chordLastRaw;
			if (chordHand) chordLastRaw = rawChordId;

			const rawQuality = modHand ? getModifierQuality(modHand) : 'major';
			const harmonyKey = `${rawChordId}|${rawQuality}`;

			if (harmonyKey === harmonyLastRaw) harmonyStable++;
			else {
				harmonyStable = 0;
				harmonyLastRaw = harmonyKey;
			}

			// One commit when degree + quality have both held steady - moving
			// both hands together yields a single voicing update, not two.
			if (harmonyStable === SETTLE_FRAMES) {
				const chordChanged = rawChordId !== currentChordId;
				const qualityChanged = rawQuality !== currentQuality;
				if (chordChanged || qualityChanged) {
					if (rawChordId === 0) {
						stopChord();
						previousNotes = null;
						voicingCommitY = followerY;
						voicingArmed = false;
						voicingAnchorY = followerY;
						voicingStable = 0;
						for (const s of strings) s.active = false;
					} else {
						startVoicing(rawChordId, rawQuality, {
							onlyIfChanged: !chordChanged
						});
					}
					currentChordId = rawChordId;
					currentQuality = rawQuality;
				}
			}

			// Vertical register: must leave a deadzone around the last commit,
			// then park again before the voicing can change.
			if (currentChordId && currentChordId > 0) {
				if (!voicingArmed) {
					if (p.abs(followerY - voicingCommitY) >= VOICING_COMMIT_DEADZONE) {
						voicingArmed = true;
						voicingAnchorY = followerY;
						voicingStable = 0;
					}
				} else if (p.abs(followerY - voicingAnchorY) <= VOICING_SETTLE_Y) {
					voicingStable++;
					if (voicingStable >= VOICING_SETTLE_FRAMES) {
						const desired = desiredVoicing(currentChordId, currentQuality);
						if (!sameNoteSet(previousNotes, desired)) {
							playVoicing(desired, 0.5, followerX);
							previousNotes = desired;
							voicingCommitY = followerY;
							voicingArmed = false;
						}
					}
				} else {
					voicingAnchorY = followerY;
					voicingStable = 0;
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
			p.text('Key: ' + formatKeyLabel(rootPc, mode), 10, 24);
			p.text('Chord: ' + (currentChordId ? currentChordId : '-'), 10, 44);
			p.text('Quality: ' + currentQuality, 10, 64);
			p.text(
				'Notes: ' + (previousNotes ? previousNotes.join(',') : '-'),
				10,
				84
			);
		};

		function handPalmDist(hand: Hand, x: number, y: number): number {
			const kp = hand.keypoints[9];
			return p.dist(kp.x, kp.y, x, y);
		}

		/**
		 * Chord hand owns the follower dot. With two hands, stick to whichever
		 * is nearest the last chord target so handedness flicker / array order
		 * never yanks the dot onto the modifier hand.
		 */
		function assignChordAndModHands(detected: Hand[]): {
			chordHand: Hand | null;
			modHand: Hand | null;
		} {
			if (detected.length === 0) return { chordHand: null, modHand: null };
			if (detected.length === 1) {
				return { chordHand: detected[0], modHand: null };
			}

			const left = detected.find((h) => h.handedness === 'Left');
			const nearest = detected.reduce((best, h) =>
				handPalmDist(h, lastHandTargetX, lastHandTargetY) <
				handPalmDist(best, lastHandTargetX, lastHandTargetY)
					? h
					: best
			);

			// Prefer Left only when nothing is near the tracked target yet
			// (fresh two-hand appearance); otherwise stay sticky.
			const nearTrack = detected.some(
				(h) => handPalmDist(h, lastHandTargetX, lastHandTargetY) < 160
			);
			const chordHand = nearTrack ? nearest : left ?? nearest;
			const modHand = detected.find((h) => h !== chordHand) ?? null;
			return { chordHand, modHand };
		}

		function noteSetKey(notes: number[]): string {
			return [...notes].sort((a, b) => a - b).join(',');
		}

		function sameNoteSet(a: number[] | null, b: number[]): boolean {
			return a !== null && noteSetKey(a) === noteSetKey(b);
		}

		function pitchClassKey(notes: number[]): string {
			return [...new Set(notes.map((n) => ((n % 12) + 12) % 12))]
				.sort((a, b) => a - b)
				.join(',');
		}

		function samePitchClasses(a: number[] | null, b: number[]): boolean {
			return a !== null && pitchClassKey(a) === pitchClassKey(b);
		}

		function desiredVoicing(chordId: number, quality: QualityName): number[] {
			const targetPCs = chordPitchClassesForQuality(chordId, quality);
			const targetMidi = targetMidiFromHandY(followerY);
			return closestVoicingToDot(targetPCs, targetMidi);
		}

		function startVoicing(
			chordId: number,
			quality: QualityName,
			opts: { onlyIfChanged?: boolean } = {}
		): void {
			const voicing = desiredVoicing(chordId, quality);
			if (opts.onlyIfChanged && samePitchClasses(previousNotes, voicing)) {
				return;
			}
			playVoicing(voicing, 0.5, followerX);
			previousNotes = voicing;
			voicingCommitY = followerY;
			voicingArmed = false;
			voicingAnchorY = followerY;
			voicingStable = 0;
		}

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
					// Held notes settle quickly; released notes ring out longer.
					const tau = s.active
						? p.map(s.midi, 36, 96, 900, 300)
						: p.map(s.midi, 36, 96, 1600, 850);
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
				const rootPcNow = options.getRootPc();
				const isRoot = ((s.midi % 12) + 12) % 12 === rootPcNow;
				const proximity = p.exp(-p.abs(s.y - followerY) / PROXIMITY_FALLOFF);
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
					s.originX = p.width - handX;
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
				osc.amp(0, RELEASE_TIME);
				setTimeout(() => osc.stop(), RELEASE_STOP_MS);
			}
			voices = [];
		}

		function degreeMidi(degreeIndex: number): number {
			return scaleDegreeMidi(
				rootMidiFromPc(options.getRootPc()),
				options.getMode(),
				degreeIndex
			);
		}

		function chordPitchClassesForQuality(
			chordDigit: number,
			qualityName: QualityName
		): number[] {
			const rootIdx = chordDigit - 1;

			if (qualityName === 'natural') {
				return [0, 2, 4].map(
					(off) => ((degreeMidi(rootIdx + off) % 12) + 12) % 12
				);
			}

			const chordRootPc = ((degreeMidi(rootIdx) % 12) + 12) % 12;
			const intervals = qualityIntervals[qualityName];
			return intervals.map((iv) => (chordRootPc + iv) % 12);
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

		/**
		 * Camera-facing degree poses (fingers generally up). Returns 1–7, or 0
		 * for fist / unrecognized (release). No degree 8.
		 */
		function classifyDegree(hand: Hand): number {
			const kp = hand.keypoints;
			const wrist = kp[0];
			const scale = p.dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
			if (scale < 1) return 0;

			const d = (a: HandKeypoint, b: HandKeypoint) =>
				p.dist(a.x, a.y, b.x, b.y);
			// Tip farther from wrist than PIP → finger extended "up".
			const up = (tip: number, pip: number) =>
				d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.08;
			const thumbPinkyTouch = d(kp[4], kp[20]) < scale * 0.48;

			const indexUp = up(8, 6);
			const middleUp = up(12, 10);
			const ringUp = up(16, 14);
			const pinkyUp = up(20, 18);
			const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.08;
			const fingerUps = [indexUp, middleUp, ringUp, pinkyUp];
			const upCount = fingerUps.filter(Boolean).length;

			// 7: thumb out, other fingers curled
			if (thumbOut && upCount === 0) return 7;

			// 1: index only
			if (upCount === 1 && indexUp) return 1;

			// 2: index + middle
			if (upCount === 2 && indexUp && middleUp) return 2;

			// 6: thumb + index + pinky (middle/ring down)
			if (
				thumbOut &&
				indexUp &&
				pinkyUp &&
				!middleUp &&
				!ringUp &&
				upCount === 2
			) {
				return 6;
			}

			// 3: index/middle/ring up with thumb-pinky touch (former ASL 6)
			if (
				indexUp &&
				middleUp &&
				ringUp &&
				!pinkyUp &&
				thumbPinkyTouch &&
				upCount === 3
			) {
				return 3;
			}

			// 4 / 5: four fingers; thumb in vs out
			if (upCount === 4) return thumbOut ? 5 : 4;

			// Former ASL-8-like (and anything else) → release
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
