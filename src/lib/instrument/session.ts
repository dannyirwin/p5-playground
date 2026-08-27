import { formatKeyLabel, type PitchClass, type ScaleMode } from './harmony/scales.ts';
import type { InstrumentHudState, RendererAudioMix } from './hud.ts';
import type { InstrumentEvent, VoicingChange } from './events.ts';
import type { HarmonyController } from './harmony/types.ts';
import type { InputRecognizer, InputUpdate } from './input/types.ts';
import type { InstrumentPlayer } from './player/types.ts';
import type { AudioHost } from './hosts.ts';

export interface SessionStepParams {
	input: InputUpdate;
	rootPc: PitchClass;
	mode: ScaleMode;
	canvasWidth: number;
	canvasHeight: number;
	keyOrModeChanged: boolean;
	deltaMs: number;
}

export interface SessionStepResult {
	events: InstrumentEvent[];
	hud: InstrumentHudState;
	pendingVoicing: VoicingChange | null;
	pendingRelease: boolean;
	audioMix: RendererAudioMix;
}

export interface InstrumentSessionDeps {
	input: InputRecognizer;
	harmony: HarmonyController;
	onHudUpdate?: (state: InstrumentHudState) => void;
}

/** Orchestrates input → harmony → player each frame. */
export interface InstrumentSession {
	step(params: SessionStepParams): SessionStepResult;
	unlockAudio(host: AudioHost, followerX: number, canvasWidth: number): void;
	setPlayer(player: InstrumentPlayer | undefined): void;
	getPlayer(): InstrumentPlayer | undefined;
	onSimFeedback(feedback: RendererAudioMix): void;
	tick(dtMs: number): void;
	destroy(): void;
}

function buildHud(
	params: SessionStepParams,
	input: InputUpdate,
	music: ReturnType<HarmonyController['getState']>
): InstrumentHudState {
	const previewDegree = input.raw.rawDegree > 0 ? input.raw.rawDegree : null;
	const previewQuality = previewDegree ? input.raw.rawQuality : null;
	const soundingDegree = music.currentDegree;
	const soundingQuality = music.currentDegree ? music.currentQuality : null;
	const isSettling =
		previewDegree !== soundingDegree ||
		(previewDegree !== null &&
			soundingDegree !== null &&
			previewQuality !== soundingQuality) ||
		(previewDegree === null && soundingDegree !== null && input.settleProgress > 0);

	return {
		keyLabel: formatKeyLabel(params.rootPc, params.mode),
		degree: soundingDegree,
		tilt: input.raw.degreeTilt,
		degreeFacing: input.raw.degreeFacing,
		quality: soundingQuality,
		qualitySource: input.raw.qualitySource,
		modFacing: input.raw.modFacing,
		bassMode: input.intent.bassMode,
		bassActive: music.bassActive,
		notes: music.notes,
		followerX: params.canvasWidth - input.intent.follower.x,
		followerY: input.intent.follower.y,
		handsDetected: input.raw.handsDetected,
		previewDegree,
		previewQuality,
		isSettling,
		settleProgress: input.settleProgress
	};
}

export function createInstrumentSession(deps: InstrumentSessionDeps): InstrumentSession {
	let activePlayer: InstrumentPlayer | undefined;
	const audioMix: RendererAudioMix = { intensity: 1, conversions: [] };

	function hasActiveVoices(): boolean {
		return activePlayer?.hasVoices?.() ?? false;
	}

	function applyHarmonyEvents(
		events: InstrumentEvent[],
		out: { voicing: VoicingChange | null; release: boolean }
	): void {
		for (const event of events) {
			if (event.kind === 'voicing') {
				out.voicing = event;
				activePlayer?.onVoicing(event);
			} else if (event.kind === 'release') {
				if (hasActiveVoices()) {
					activePlayer?.onRelease();
				}
				out.release = true;
			}
		}
	}

	function releaseAll(out: { release: boolean }): void {
		const music = deps.harmony.getState();
		const hadSound =
			(music.currentDegree !== null && music.currentDegree > 0) ||
			music.notes !== null ||
			hasActiveVoices();
		if (hadSound) {
			activePlayer?.onRelease();
		}
		deps.harmony.reset();
		if (hadSound) {
			out.release = true;
		}
	}

	return {
		step(params: SessionStepParams): SessionStepResult {
			const { input } = params;
			const frameEvents = { voicing: null as VoicingChange | null, release: false };

			for (const event of input.events) {
				if (event.kind === 'bassToggled') {
					deps.harmony.setBassMode(event.enabled);
				} else if (event.kind === 'handsLost') {
					releaseAll(frameEvents);
					const hud: InstrumentHudState = {
						keyLabel: formatKeyLabel(params.rootPc, params.mode),
						degree: null,
						tilt: 'neutral',
						degreeFacing: null,
						quality: null,
						qualitySource: 'none',
						modFacing: null,
						bassMode: input.intent.bassMode,
						bassActive: input.intent.bassMode,
						notes: null,
						followerX: params.canvasWidth - input.intent.follower.x,
						followerY: input.intent.follower.y,
						handsDetected: 0,
						previewDegree: null,
						previewQuality: null,
						isSettling: false,
						settleProgress: 0
					};
					deps.onHudUpdate?.(hud);
					audioMix.intensity = 1;
					audioMix.conversions.length = 0;
					return {
						events: [{ kind: 'release' }],
						hud,
						pendingVoicing: null,
						pendingRelease: frameEvents.release,
						audioMix
					};
				}
			}

			const harmonyEvents = deps.harmony.update({
				rawChordId: input.raw.rawDegree,
				rawQuality: input.raw.rawQuality,
				harmonySettled: input.harmonySettled,
				followerX: input.intent.follower.x,
				followerY: input.intent.follower.y,
				canvasWidth: params.canvasWidth,
				canvasHeight: params.canvasHeight,
				rootPc: params.rootPc,
				mode: params.mode,
				bassMode: input.intent.bassMode,
				keyOrModeChanged: params.keyOrModeChanged,
				deltaMs: params.deltaMs
			});
			applyHarmonyEvents(harmonyEvents, frameEvents);

			const music = deps.harmony.getState();
			const hud = buildHud(params, input, music);
			deps.onHudUpdate?.(hud);

			audioMix.intensity = 1;
			audioMix.conversions.length = 0;

			return {
				events: harmonyEvents,
				hud,
				pendingVoicing: frameEvents.voicing,
				pendingRelease: frameEvents.release,
				audioMix
			};
		},

		unlockAudio(host: AudioHost, followerX: number, canvasWidth: number): void {
			activePlayer?.unlock(host);
			const music = deps.harmony.getState();
			if (music.currentDegree && music.currentDegree > 0 && music.notes) {
				activePlayer?.onVoicing({
					kind: 'voicing',
					notes: music.notes,
					originX: canvasWidth - followerX,
					reason: 'key',
					bassActive: music.bassActive
				});
			}
		},

		setPlayer(player: InstrumentPlayer | undefined): void {
			if (player === activePlayer) return;
			activePlayer?.destroy();
			activePlayer = player;
		},

		getPlayer(): InstrumentPlayer | undefined {
			return activePlayer;
		},

		onSimFeedback(feedback: RendererAudioMix): void {
			activePlayer?.onSimFeedback({
				intensity: feedback.intensity,
				conversions: [...feedback.conversions]
			});
		},

		tick(dtMs: number): void {
			activePlayer?.tick(dtMs);
		},

		destroy(): void {
			activePlayer?.destroy();
			activePlayer = undefined;
		}
	};
}
