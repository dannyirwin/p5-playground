import type p5 from 'p5';
import {
	diatonicTriadQuality,
	formatKeyLabel,
	rootMidiFromPc,
	scaleDegreeMidi,
	type PitchClass,
	type ScaleMode,
	type TriadQuality
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
	freq: (value: number, rampTime?: number) => void;
	res: (value: number) => void;
}

interface SoundOscillator {
	disconnect: () => void;
	connect: (unit: SoundFilter) => void;
	freq: (value: number, rampTime?: number) => void;
	amp: (value: number, rampTime?: number, timeFromNow?: number) => void;
	start: () => void;
	stop: () => void;
}

interface SoundReverb {
	process: (src: SoundFilter, seconds?: number, decayRate?: number) => void;
	drywet: (value: number) => void;
	amp: (value: number) => void;
}

interface P5SoundConstructors {
	Filter: new (type: string) => SoundFilter;
	Oscillator: new (type: string) => SoundOscillator;
	Reverb: new () => SoundReverb;
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

export interface InstrumentHudState {
	keyLabel: string;
	degree: number | null;
	tilt: 'inward' | 'outward' | 'neutral';
	degreeFacing: 'cam' | 'away' | null;
	quality: QualityName | null;
	qualitySource: 'mod' | 'triad' | 'none';
	modFacing: 'cam' | 'away' | null;
	notes: number[] | null;
	followerX: number;
	followerY: number;
	handsDetected: number;
}

export interface HandInstrumentOptions {
	getShowVideo: () => boolean;
	getRootPc: () => PitchClass;
	getMode: () => ScaleMode;
	onHudUpdate?: (state: InstrumentHudState) => void;
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
const RELEASE_TIME = 0.7;
const RELEASE_STOP_MS = 900;
/** Warm, slightly lofi onset - triangle + dark lowpass, almost no click. */
const ATTACK_PITCH_RATIO = 1.004;
const ATTACK_PITCH_TIME = 0.1;
const ATTACK_AMP = 0.16;
const SUSTAIN_AMP = 0.14;
const ATTACK_AMP_TIME = 0.08;
const DETUNE_RATIO = 1.004;
const DETUNE_AMP = 0.05;
const FILTER_CUTOFF = 920;
const FILTER_RES = 8;
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
/** Inclusive MIDI range for strings / vertical voicing (was 36-96). */
const STRING_LOW_MIDI = 48;
const STRING_HIGH_MIDI = 84;

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
		let reverb: SoundReverb | undefined;
		let strings: StringState[] = [];

		let currentChordId: number | null = null;
		let currentQuality: QualityName = 'major';
		let currentTilt: 'inward' | 'outward' | 'neutral' = 'neutral';
		let currentDegreeFacing: boolean | null = null;
		let previousNotes: number[] | null = null;
		let lastRootPc: PitchClass = options.getRootPc();
		let lastMode: ScaleMode = options.getMode();

		/** Joint degree + tilt + palm + quality; all inputs share one settle clock. */
		let harmonyLastRaw = '0|neutral|cam|major';
		let harmonyStable = 0;
		let chordLastRaw = 0;
		let degreeTiltLast: 'inward' | 'outward' | 'neutral' = 'neutral';
		let degreeFacingLast: boolean | null = null;

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

		/** ml5 keypoints are in webcam capture pixels, not canvas pixels. */
		function captureSize(): { w: number; h: number } {
			if (video) {
				const w = video.width as number;
				const h = video.height as number;
				if (w > 0 && h > 0) return { w, h };
			}
			return { w: 640, h: 480 };
		}

		function scaleCaptureX(x: number): number {
			const { w } = captureSize();
			return (x / w) * p.width;
		}

		function scaleCaptureY(y: number): number {
			const { h } = captureSize();
			return (y / h) * p.height;
		}

		p.preload = () => {
			handPose = window.ml5.handPose({ maxHands: 2 });
		};

		p.setup = () => {
			p.createCanvas(p.windowWidth, p.windowHeight);

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
			filter.freq(FILTER_CUTOFF);
			filter.res(FILTER_RES);

			reverb = new ctors.Reverb();
			reverb.process(filter, 2.8, 3.2);
			reverb.drywet(0.32);
			reverb.amp(0.65);

			setupStrings();
			followerX = lastHandTargetX = p.width / 2;
			followerY = lastHandTargetY = p.height / 2;
		};

		p.windowResized = () => {
			p.resizeCanvas(p.windowWidth, p.windowHeight);
			layoutStringYs();
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
					p.circle(p.width - scaleCaptureX(kp.x), scaleCaptureY(kp.y), 6);
				}
			}

			const { chordHand, modHand } = assignChordAndModHands(hands);

			if (hands.length === 0) {
				clearPlayingState();
			} else {
				if (chordHand) {
					lastHandTargetX = scaleCaptureX(chordHand.keypoints[9].x);
					lastHandTargetY = scaleCaptureY(chordHand.keypoints[9].y);
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

				const degreeTilt = chordHand
					? getDegreeTilt(chordHand)
					: degreeTiltLast;
				if (chordHand) degreeTiltLast = degreeTilt;

				const rawDegreeFacing = chordHand
					? palmFacesCamera(chordHand)
					: degreeFacingLast;
				if (chordHand && rawDegreeFacing !== null) {
					degreeFacingLast = rawDegreeFacing;
				}
				const degreeFacing = rawDegreeFacing ?? degreeFacingLast;
				const counterpart =
					degreeTilt === 'outward' || degreeFacing === false;

				const triadQuality =
					rawChordId > 0
						? resolveDegreeTriad(rawChordId, mode, counterpart)
						: 'major';
				const modFacing = modHand ? palmFacesCamera(modHand) : null;
				const modQuality = modHand
					? getModifierQuality(modHand, triadQuality)
					: null;
				const rawQuality: QualityName = modQuality ?? triadQuality;
				const facingTag =
					degreeFacing === false
						? 'away'
						: degreeFacing === true
							? 'cam'
							: 'edge';
				const harmonyKey = `${rawChordId}|${degreeTilt}|${facingTag}|${rawQuality}`;

				if (harmonyKey === harmonyLastRaw) harmonyStable++;
				else {
					harmonyStable = 0;
					harmonyLastRaw = harmonyKey;
				}

				if (harmonyStable === SETTLE_FRAMES) {
					const chordChanged = rawChordId !== currentChordId;
					const qualityChanged = rawQuality !== currentQuality;
					if (chordChanged || qualityChanged) {
						if (rawChordId === 0) {
							clearPlayingState();
						} else {
							startVoicing(rawChordId, rawQuality, {
								onlyIfChanged: false
							});
							currentChordId = rawChordId;
							currentQuality = rawQuality;
						}
					}
					currentTilt = degreeTilt;
					currentDegreeFacing = degreeFacing;
				}

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
								playVoicing(desired, followerX);
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

				reportHud({
					keyLabel: formatKeyLabel(rootPc, mode),
					degree: currentChordId,
					tilt: degreeTilt,
					degreeFacing:
						degreeFacing === true
							? 'cam'
							: degreeFacing === false
								? 'away'
								: null,
					quality: currentQuality,
					qualitySource: modQuality ? 'mod' : currentChordId ? 'triad' : 'none',
					modFacing:
						modFacing === true ? 'cam' : modFacing === false ? 'away' : null,
					notes: previousNotes,
					followerX: p.width - followerX,
					followerY: followerY,
					handsDetected: hands.length
				});
			}

			updateStrings();
			drawStrings();

			p.noStroke();
			p.fill(94, 230, 168, 180);
			p.circle(p.width - followerX, followerY, 18);
		};

		function clearPlayingState(): void {
			if (currentChordId !== null || previousNotes !== null || voices.length > 0) {
				stopChord();
			}
			previousNotes = null;
			currentChordId = null;
			currentQuality = 'major';
			currentTilt = 'neutral';
			currentDegreeFacing = null;
			harmonyLastRaw = '0|neutral|cam|major';
			harmonyStable = 0;
			chordLastRaw = 0;
			degreeFacingLast = null;
			voicingCommitY = followerY;
			voicingArmed = false;
			voicingAnchorY = followerY;
			voicingStable = 0;
			for (const s of strings) s.active = false;
			reportHud({
				keyLabel: formatKeyLabel(options.getRootPc(), options.getMode()),
				degree: null,
				tilt: 'neutral',
				degreeFacing: null,
				quality: null,
				qualitySource: 'none',
				modFacing: null,
				notes: null,
				followerX: p.width - followerX,
				followerY: followerY,
				handsDetected: 0
			});
		}

		function reportHud(state: InstrumentHudState): void {
			options.onHudUpdate?.(state);
		}

		function handPalmDist(hand: Hand, x: number, y: number): number {
			const kp = hand.keypoints[9];
			return p.dist(scaleCaptureX(kp.x), scaleCaptureY(kp.y), x, y);
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
			const stickyRadius = p.width * (160 / captureSize().w);
			const nearTrack = detected.some(
				(h) => handPalmDist(h, lastHandTargetX, lastHandTargetY) < stickyRadius
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
			playVoicing(voicing, followerX);
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
			layoutStringYs();
		}

		function layoutStringYs(): void {
			if (strings.length === 0) return;
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
					const tau = s.active
						? p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 700, 280)
						: p.map(s.midi, STRING_LOW_MIDI, STRING_HIGH_MIDI, 220, 110);
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

				const originX = p.width - followerX;
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

		function playVoicing(notes: number[], handX: number): void {
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
			filter.freq(FILTER_CUTOFF);

			for (const note of notes) {
				const hz = midiNumberToHz(note);
				voices.push(
					startTone(ctors, 'triangle', hz, ATTACK_AMP, SUSTAIN_AMP)
				);
				voices.push(
					startTone(
						ctors,
						'triangle',
						hz * DETUNE_RATIO,
						DETUNE_AMP * 1.2,
						DETUNE_AMP
					)
				);
			}
		}

		function startTone(
			ctors: P5SoundConstructors,
			type: string,
			hz: number,
			attackAmp: number,
			sustainAmp: number
		): SoundOscillator {
			const osc = new ctors.Oscillator(type);
			osc.disconnect();
			osc.connect(filter as SoundFilter);
			osc.freq(hz * ATTACK_PITCH_RATIO);
			osc.amp(0);
			osc.start();
			osc.freq(hz, ATTACK_PITCH_TIME);
			osc.amp(attackAmp, ATTACK_AMP_TIME);
			osc.amp(sustainAmp, 0.18, ATTACK_AMP_TIME);
			return osc;
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
			return p.constrain(
				p.map(
					y,
					p.height - 20,
					20,
					STRING_LOW_MIDI,
					STRING_HIGH_MIDI
				),
				STRING_LOW_MIDI,
				STRING_HIGH_MIDI
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
		 * Inward vs outward lean of the degree hand (camera-facing).
		 * Uses wrist→palm angle from vertical so it still works when fingers
		 * are curled (middle tip lean was too weak). Hysteresis reduces flicker.
		 */
		function getDegreeTilt(hand: Hand): 'inward' | 'outward' | 'neutral' {
			const kp = hand.keypoints;
			const wrist = kp[0];
			const middleMcp = kp[9];
			const palmLen = p.dist(wrist.x, wrist.y, middleMcp.x, middleMcp.y);
			if (palmLen < 1) return 'neutral';

			// 0 = straight up in camera space (y grows downward).
			const ax = middleMcp.x - wrist.x;
			const ay = middleMcp.y - wrist.y;
			const angleFromUp = Math.atan2(ax, -ay);

			// Person facing camera: Right hand leans inward (toward chest) with
			// negative camera-x; Left hand is the opposite.
			const inwardDir = hand.handedness === 'Right' ? -1 : 1;
			const score = angleFromUp * inwardDir;

			const enter = 0.16; // ~9deg to enter inward/outward
			const hold = 0.08; // hysteresis exit band

			if (degreeTiltLast === 'outward') {
				if (score < -hold) return 'outward';
				if (score > enter) return 'inward';
				return 'neutral';
			}
			if (degreeTiltLast === 'inward') {
				if (score > hold) return 'inward';
				if (score < -enter) return 'outward';
				return 'neutral';
			}
			if (score > enter) return 'inward';
			if (score < -enter) return 'outward';
			return 'neutral';
		}

		/**
		 * Natural diatonic triad for degree in current mode.
		 * Counterpart (outward tilt or palm away) flips maj/min.
		 * Diminished counterpart becomes major on the same root.
		 */
		function resolveDegreeTriad(
			degree: number,
			scaleMode: ScaleMode,
			counterpart: boolean
		): TriadQuality {
			const natural = diatonicTriadQuality(degree, scaleMode) ?? 'major';
			if (!counterpart) return natural;
			if (natural === 'major') return 'minor';
			if (natural === 'minor') return 'major';
			return 'major';
		}

		/**
		 * Camera-facing degree poses (fingers generally up). Returns 1-7, or 0
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

			// 6: index + pinky (middle/ring down, thumb in)
			if (
				!thumbOut &&
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

		/**
		 * Whether the palm faces the camera (true), faces away (false), or is
		 * edge-on / unclear (null). Uses wrist→index MCP × wrist→pinky MCP.
		 */
		function palmFacesCamera(hand: Hand): boolean | null {
			const kp = hand.keypoints;
			const wrist = kp[0];
			const indexMcp = kp[5];
			const pinkyMcp = kp[17];
			const v1x = indexMcp.x - wrist.x;
			const v1y = indexMcp.y - wrist.y;
			const v2x = pinkyMcp.x - wrist.x;
			const v2y = pinkyMcp.y - wrist.y;
			const cross = v1x * v2y - v1y * v2x;
			const scale = p.dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
			if (scale < 1 || Math.abs(cross) < scale * scale * 0.04) return null;
			// Right hand palm-to-camera tends to produce a positive cross in
			// image space; Left hand is mirrored.
			return hand.handedness === 'Right' ? cross > 0 : cross < 0;
		}

		/**
		 * Modifier-hand quality poses. Palm toward camera uses finger count
		 * plus the current maj/min triad; palm away uses 1=aug, 2=dim.
		 * Returns null when absent/unclear so degree+tilt stays in effect.
		 */
		function getModifierQuality(
			modHand: Hand,
			triad: TriadQuality
		): Exclude<QualityName, 'natural'> | null {
			const kp = modHand.keypoints;
			const wrist = kp[0];
			const scale = p.dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
			if (scale < 1) return null;

			const facing = palmFacesCamera(modHand);
			if (facing === null) return null;

			const d = (a: HandKeypoint, b: HandKeypoint) =>
				p.dist(a.x, a.y, b.x, b.y);
			const up = (tip: number, pip: number) =>
				d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.14;

			const indexUp = up(8, 6);
			const middleUp = up(12, 10);
			const ringUp = up(16, 14);
			const pinkyUp = up(20, 18);
			const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.2;

			// Contiguous finger counts from the index.
			let fingerCount = 0;
			if (indexUp && !middleUp && !ringUp && !pinkyUp) fingerCount = 1;
			else if (indexUp && middleUp && !ringUp && !pinkyUp) fingerCount = 2;
			else if (indexUp && middleUp && ringUp && !pinkyUp) fingerCount = 3;
			else if (indexUp && middleUp && ringUp && pinkyUp) fingerCount = 4;
			else return null;

			if (facing) {
				// Palm toward camera — 7ths branch on maj vs min triad.
				if (fingerCount === 1) {
					return triad === 'major' ? 'major7' : 'minor7';
				}
				if (fingerCount === 2) {
					if (triad === 'major') return 'dominant7';
					// Minor (or dim) triad: thumb out = full dim7, else half-dim7.
					return thumbOut ? 'diminished7' : 'halfDiminished7';
				}
				if (fingerCount === 3) return 'sus2';
				if (fingerCount === 4) return 'sus4';
				return null;
			}

			// Palm away from camera
			if (fingerCount === 1) return 'augmented';
			if (fingerCount === 2) return 'diminished';
			return null;
		}
	};
}
