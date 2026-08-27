import { scaleDegreeCount, type PitchClass, type ScaleMode } from './scales.ts';
import type { InstrumentEvent, ReleaseEvent, VoicingChange } from '../events.ts';
import type { QualityName } from '../quality.ts';
import {
	VOICING_COMMIT_DEADZONE,
	VOICING_SETTLE_MS,
	VOICING_SETTLE_Y
} from './constants.ts';
import { desiredVoicing, sameNoteSet, samePitchClasses } from './voicing.ts';
import type { HarmonyState } from './types.ts';

export interface HarmonyUpdateParams {
	rawChordId: number;
	rawQuality: QualityName;
	harmonySettled: boolean;
	followerX: number;
	followerY: number;
	canvasWidth: number;
	canvasHeight: number;
	rootPc: PitchClass;
	mode: ScaleMode;
	bassMode: boolean;
	keyOrModeChanged: boolean;
	deltaMs: number;
}

interface VoicingSettleState {
	commitY: number;
	armed: boolean;
	anchorY: number;
	stableMs: number;
}

export interface HarmonyController {
	update(params: HarmonyUpdateParams): InstrumentEvent[];
	getState(): HarmonyState;
	reset(): void;
	setBassMode(bassMode: boolean): void;
}

export function createHarmonyController(): HarmonyController {
	let currentDegree: number | null = null;
	let currentQuality: QualityName = 'major';
	let notes: number[] | null = null;
	let bassActive = false;
	let voicingSettle: VoicingSettleState = {
		commitY: 0,
		armed: false,
		anchorY: 0,
		stableMs: 0
	};

	function mirroredOriginX(canvasWidth: number, followerX: number): number {
		return canvasWidth - followerX;
	}

	function tryCommitVoicing(
		chordId: number,
		quality: QualityName,
		withBass: boolean,
		params: HarmonyUpdateParams,
		reason: VoicingChange['reason'],
		onlyIfPitchClasses = false
	): VoicingChange | null {
		bassActive = withBass;
		const next = desiredVoicing(
			chordId,
			quality,
			withBass,
			params.followerY,
			params.canvasHeight,
			params.rootPc,
			params.mode
		);
		if (onlyIfPitchClasses && samePitchClasses(notes, next)) {
			return null;
		}
		notes = next;
		voicingSettle = {
			commitY: params.followerY,
			armed: false,
			anchorY: params.followerY,
			stableMs: 0
		};
		return {
			kind: 'voicing',
			notes: [...next],
			originX: mirroredOriginX(params.canvasWidth, params.followerX),
			reason,
			bassActive: withBass
		};
	}

	function release(): ReleaseEvent {
		notes = null;
		currentDegree = null;
		currentQuality = 'major';
		bassActive = false;
		voicingSettle = {
			commitY: 0,
			armed: false,
			anchorY: 0,
			stableMs: 0
		};
		return { kind: 'release' };
	}

	function tickInversion(params: HarmonyUpdateParams): VoicingChange | null {
		if (!currentDegree || currentDegree <= 0) return null;
		if (!params.harmonySettled) return null;

		const y = params.followerY;
		const dt = Math.min(50, Math.max(0, params.deltaMs));

		if (!voicingSettle.armed) {
			if (Math.abs(y - voicingSettle.commitY) >= VOICING_COMMIT_DEADZONE) {
				voicingSettle = {
					...voicingSettle,
					armed: true,
					anchorY: y,
					stableMs: 0
				};
			}
			return null;
		}

		if (Math.abs(y - voicingSettle.anchorY) <= VOICING_SETTLE_Y) {
			const stableMs = voicingSettle.stableMs + dt;
			if (stableMs >= VOICING_SETTLE_MS) {
				const next = desiredVoicing(
					currentDegree,
					currentQuality,
					bassActive,
					y,
					params.canvasHeight,
					params.rootPc,
					params.mode
				);
				if (sameNoteSet(notes, next)) {
					voicingSettle = { ...voicingSettle, stableMs: 0 };
					return null;
				}
				notes = next;
				voicingSettle = {
					commitY: y,
					armed: false,
					anchorY: y,
					stableMs: 0
				};
				return {
					kind: 'voicing',
					notes: [...next],
					originX: mirroredOriginX(params.canvasWidth, params.followerX),
					reason: 'inversion',
					bassActive
				};
			}
			voicingSettle = { ...voicingSettle, stableMs };
			return null;
		}

		voicingSettle = { ...voicingSettle, anchorY: y, stableMs: 0 };
		return null;
	}

	return {
		update(params: HarmonyUpdateParams): InstrumentEvent[] {
			const events: InstrumentEvent[] = [];

			if (params.keyOrModeChanged) {
				if (
					currentDegree &&
					currentDegree > 0 &&
					currentDegree <= scaleDegreeCount(params.mode)
				) {
					const e = tryCommitVoicing(
						currentDegree,
						currentQuality,
						bassActive,
						params,
						'key'
					);
					if (e) events.push(e);
				} else if (
					currentDegree &&
					currentDegree > scaleDegreeCount(params.mode)
				) {
					events.push(release());
				}
			}

			if (params.harmonySettled) {
				const chordChanged = params.rawChordId !== (currentDegree ?? 0);
				const qualityChanged = params.rawQuality !== currentQuality;
				if (chordChanged || qualityChanged) {
					if (params.rawChordId === 0) {
						events.push(release());
					} else {
						currentDegree = params.rawChordId;
						currentQuality = params.rawQuality;
						const reason = chordChanged ? 'chord' : 'quality';
						const e = tryCommitVoicing(
							params.rawChordId,
							params.rawQuality,
							params.bassMode,
							params,
							reason
						);
						if (e) events.push(e);
					}
				}
			}

			const inversion = tickInversion(params);
			if (inversion) events.push(inversion);

			return events;
		},

		getState(): HarmonyState {
			return {
				currentDegree,
				currentQuality,
				notes,
				bassActive
			};
		},

		reset(): void {
			release();
		},

		setBassMode(bassMode: boolean): void {
			if (!currentDegree || currentDegree === 0 || notes === null) {
				bassActive = bassMode;
			}
		}
	};
}
