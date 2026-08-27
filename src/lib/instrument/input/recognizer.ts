import type { HandSnapshot } from '../hands.ts';
import type { QualityName } from '../quality.ts';
import { scaleDegreeCount, type PitchClass, type ScaleMode } from '../harmony/scales.ts';
import {
	assignChordAndModHands,
	palmAnchorCapture,
	updateBassGesture,
	type BassGestureState
} from './handAssignment.ts';
import {
	classifyDegree,
	getDegreeTilt,
	getModifierQuality,
	palmFacesCamera,
	resolveDegreeTriad
} from './gestures.ts';
import { updateFollower, type FollowerState } from './follower.ts';
import {
	settleKey,
	tickHarmonySettle,
	type SettleState,
	SETTLE_MS
} from './settle.ts';
import { getKeyboardChordDegree } from './keyboardChordInput.ts';
import type { InputRecognizer, InputUpdate, RawGestureState } from './types.ts';

function scaleCaptureX(x: number, canvasWidth: number, captureWidth: number): number {
	return (x / captureWidth) * canvasWidth;
}

function scaleCaptureY(y: number, canvasHeight: number, captureHeight: number): number {
	return (y / captureHeight) * canvasHeight;
}

/** Ignore brief fist flicker while changing ASL digits. */
const DEGREE_RELEASE_HOLD_MS = 90;

/** Gesture → settled musical intent, follower physics, and bass toggle. */
export function createInputRecognizer(): InputRecognizer {
	let harmonySettle: SettleState = {
		lastKey: '0|major',
		stableMs: 0
	};
	let chordLastRaw = 0;
	let degreeTiltLast: 'inward' | 'outward' | 'neutral' = 'neutral';
	let degreeFacingLast: boolean | null = null;
	let bassGesture: BassGestureState = {
		bassMode: false,
		knucklesTogether: false,
		tapTimes: [],
		cooldownUntil: 0
	};
	let follower: FollowerState = { x: 0, y: 0, velX: 0, velY: 0 };
	let lastHandTargetX = 0;
	let lastHandTargetY = 0;
	let canvasWidth = 0;
	let canvasHeight = 0;
	let releaseHoldMs = 0;
	let settleProgress = 0;

	function emptyIntent(): InputUpdate {
		return {
			intent: {
				degree: null,
				quality: null,
				bassMode: bassGesture.bassMode,
				bassActive: bassGesture.bassMode,
				tilt: 'neutral',
				degreeFacing: null,
				voicingAnchorY: follower.y,
				follower: { x: follower.x, y: follower.y }
			},
			raw: {
				rawDegree: 0,
				rawQuality: 'major',
				degreeTilt: 'neutral',
				degreeFacing: null,
				modFacing: null,
				qualitySource: 'none',
				handsDetected: 0
			},
			events: [{ kind: 'handsLost' }],
			harmonySettled: false,
			settleProgress: 0
		};
	}

	function keyboardIntent(mode: ScaleMode): InputUpdate | null {
		const keyboardDegree = getKeyboardChordDegree();
		if (keyboardDegree === null || keyboardDegree <= 0) return null;
		if (keyboardDegree > scaleDegreeCount(mode)) return null;

		const rawQuality = resolveDegreeTriad(keyboardDegree, mode, false);
		const key = settleKey(keyboardDegree, rawQuality);
		harmonySettle = { lastKey: key, stableMs: SETTLE_MS.chord };
		settleProgress = 1;
		chordLastRaw = keyboardDegree;

		return {
			intent: {
				degree: keyboardDegree,
				quality: rawQuality,
				bassMode: bassGesture.bassMode,
				bassActive: bassGesture.bassMode,
				tilt: 'neutral',
				degreeFacing: null,
				voicingAnchorY: follower.y,
				follower: { x: follower.x, y: follower.y }
			},
			raw: {
				rawDegree: keyboardDegree,
				rawQuality,
				degreeTilt: 'neutral',
				degreeFacing: null,
				modFacing: null,
				qualitySource: 'triad',
				handsDetected: 0
			},
			events: [],
			harmonySettled: true,
			settleProgress: 1
		};
	}

	return {
		update(
			hands: readonly HandSnapshot[],
			_rootPc: PitchClass,
			mode: ScaleMode,
			canvasW: number,
			canvasH: number,
			captureWidth: number,
			captureHeight: number,
			nowMs: number,
			deltaMs: number
		): InputUpdate {
			canvasWidth = canvasW;
			canvasHeight = canvasH;
			const dt = Math.min(50, Math.max(0, deltaMs));

			const keyboard = keyboardIntent(mode);
			if (keyboard) return keyboard;

			if (hands.length === 0) {
				harmonySettle = { lastKey: '0|major', stableMs: 0 };
				releaseHoldMs = 0;
				settleProgress = 0;
				chordLastRaw = 0;
				degreeFacingLast = null;
				bassGesture = {
					...bassGesture,
					knucklesTogether: false,
					tapTimes: [],
					cooldownUntil: 0
				};
				return emptyIntent();
			}

			const { chordHand, modHand } = assignChordAndModHands(
				hands,
				lastHandTargetX,
				lastHandTargetY,
				canvasWidth,
				captureWidth,
				(x) => scaleCaptureX(x, canvasWidth, captureWidth),
				(y) => scaleCaptureY(y, canvasHeight, captureHeight)
			);

			if (chordHand) {
				const anchor = palmAnchorCapture(chordHand);
				lastHandTargetX = scaleCaptureX(anchor.x, canvasWidth, captureWidth);
				lastHandTargetY = scaleCaptureY(anchor.y, canvasHeight, captureHeight);
			}
			follower = updateFollower(follower, lastHandTargetX, lastHandTargetY);

			const classified = chordHand ? classifyDegree(chordHand) : 0;
			let poseDegree = classified;
			if (classified === 0 && chordLastRaw > 0) {
				releaseHoldMs += dt;
				if (releaseHoldMs < DEGREE_RELEASE_HOLD_MS) {
					poseDegree = chordLastRaw;
				} else {
					chordLastRaw = 0;
				}
			} else {
				releaseHoldMs = 0;
				if (classified > 0) chordLastRaw = classified;
			}

			const rawDegree =
				poseDegree > 0 && poseDegree <= scaleDegreeCount(mode) ? poseDegree : 0;

			const degreeTilt = chordHand ? getDegreeTilt(chordHand, degreeTiltLast) : degreeTiltLast;
			if (chordHand) degreeTiltLast = degreeTilt;

			const rawDegreeFacing = chordHand ? palmFacesCamera(chordHand) : degreeFacingLast;
			if (chordHand && rawDegreeFacing !== null) {
				degreeFacingLast = rawDegreeFacing;
			}
			const degreeFacing = rawDegreeFacing ?? degreeFacingLast;
			const counterpart = degreeTilt === 'outward' || degreeFacing === false;

			const triadQuality: QualityName =
				rawDegree > 0 ? resolveDegreeTriad(rawDegree, mode, counterpart) : 'major';
			const modFacing = modHand ? palmFacesCamera(modHand) : null;

			const bassUpdate = updateBassGesture(hands, bassGesture, nowMs);
			bassGesture = bassUpdate.state;
			const events: InputUpdate['events'] = [];
			if (bassUpdate.toggled) {
				events.push({ kind: 'bassToggled', enabled: bassGesture.bassMode });
			}

			const modQuality =
				modHand && !bassUpdate.together
					? getModifierQuality(modHand, triadQuality)
					: null;
			const rawQuality: QualityName = modQuality ?? triadQuality;

			const settleResult = tickHarmonySettle(settleKey(rawDegree, rawQuality), harmonySettle, dt);
			harmonySettle = settleResult.state;
			settleProgress = settleResult.progress;

			const degreeFacingLabel =
				degreeFacing === true ? 'cam' : degreeFacing === false ? 'away' : null;

			return {
				intent: {
					degree: rawDegree > 0 ? rawDegree : null,
					quality: rawDegree > 0 ? rawQuality : null,
					bassMode: bassGesture.bassMode,
					bassActive: bassGesture.bassMode,
					tilt: degreeTilt,
					degreeFacing: degreeFacingLabel,
					voicingAnchorY: follower.y,
					follower: { x: follower.x, y: follower.y }
				},
				raw: {
					rawDegree,
					rawQuality,
					degreeTilt,
					degreeFacing: degreeFacingLabel,
					modFacing: modFacing === true ? 'cam' : modFacing === false ? 'away' : null,
					qualitySource: modQuality ? 'mod' : rawDegree > 0 ? 'triad' : 'none',
					handsDetected: hands.length
				},
				events,
				harmonySettled: settleResult.settled,
				settleProgress
			};
		},

		reset(): void {
			harmonySettle = { lastKey: '0|major', stableMs: 0 };
			releaseHoldMs = 0;
			settleProgress = 0;
			chordLastRaw = 0;
			degreeTiltLast = 'neutral';
			degreeFacingLast = null;
			bassGesture = {
				bassMode: false,
				knucklesTogether: false,
				tapTimes: [],
				cooldownUntil: 0
			};
		},

		/** Seed follower position when the canvas is first sized. */
		seedFollower(x: number, y: number): void {
			follower = { x, y, velX: 0, velY: 0 };
			lastHandTargetX = x;
			lastHandTargetY = y;
		}
	};
}
