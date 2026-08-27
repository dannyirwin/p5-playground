import type p5 from 'p5';
import { VOICING_LOW_MIDI } from '../../../harmony/constants.ts';
import type { SimFeedback, VoicingChange } from '../../../events.ts';
import type { AudioHost } from '../../../hosts.ts';
import type { InstrumentPlayer } from '../../types.ts';
import {
	ATTACK_AMP,
	ATTACK_AMP_TIME,
	ATTACK_PITCH_RATIO,
	ATTACK_PITCH_TIME,
	BOID_INTENSITY_FLOOR,
	BOID_INTENSITY_RAMP,
	BOID_RELEASE_TIME,
	CONVERT_PING_ACTIVITY_MS,
	CONVERT_PING_ADMIT,
	CONVERT_PING_ATTACK,
	CONVERT_PING_AMP,
	CONVERT_PING_ECHO,
	CONVERT_PING_GAP_MAX_MS,
	CONVERT_PING_GAP_MIN_MS,
	CONVERT_PING_HZ_RATIO,
	CONVERT_PING_MS,
	CONVERT_PING_POOL_MAX,
	CONVERT_PING_RELEASE,
	DETUNE_AMP,
	DETUNE_RATIO,
	DRONE_DISTORTION,
	DRONE_DISTORTION_AMP,
	DRONE_PULSE_DEPTH,
	DRONE_PULSE_HZ,
	FILTER_BREATHE_DEPTH,
	FILTER_BREATHE_HZ,
	FILTER_CUTOFF,
	FILTER_RES,
	INTENSITY_FALL_SEC,
	INTENSITY_RISE_SEC,
	MAX_CONVERT_PINGS_PER_WINDOW,
	CONVERT_PING_WINDOW_MS,
	RELEASE_STOP_MS,
	RELEASE_TIME,
	REVERB_AMP,
	REVERB_DECAY,
	REVERB_DRYWET,
	REVERB_SECONDS,
	SOFT_ATTACK_PITCH_RATIO,
	SOFT_ATTACK_PITCH_TIME,
	STATIC_DRONE_INTENSITY,
	SUSTAIN_AMP,
	VOICE_WOBBLE_CENTS,
	VOICE_WOBBLE_HZ
} from './constants.ts';
import {
	soundCtors,
	type P5SoundConstructors,
	type P5WithSound,
	type SoundConnectable,
	type SoundFilter,
	type SoundOscillator
} from './soundTypes.ts';

export interface P5DronePlayerConfig {
	id: string;
	softOnset: boolean;
	quickRelease: boolean;
	simDrivenIntensity: boolean;
	conversionPings: boolean;
}

function midiNumberToHz(m: number): number {
	return 440 * Math.pow(2, (m - 69) / 12);
}

export function createP5DronePlayer(
	p: p5,
	config: P5DronePlayerConfig
): InstrumentPlayer {
	let voices: SoundOscillator[] = [];
	let voiceBaseAmps: number[] = [];
	let voiceBaseHz: number[] = [];
	let voicePulsePhases: number[] = [];
	let filter: SoundFilter | undefined;
	let voiceBus: SoundConnectable | undefined;
	let chimeBus: SoundFilter | undefined;
	let ready = false;
	let smoothedIntensity = 1;
	let simIntensity = 1;
	let convertPingPool: number[] = [];
	let lastInfectionAt = -Infinity;
	let nextConvertPingAt = 0;
	let lastConvertPingMidi: number | null = null;
	let convertPingWindowStart = 0;
	let convertPingsInWindow = 0;

	function ensureGraph(): void {
		if (filter) return;
		const ctors = soundCtors(p.constructor as typeof p5);
		filter = new ctors.Filter('lowpass');
		filter.freq(FILTER_CUTOFF);
		filter.res(FILTER_RES);

		voiceBus = filter;
		if (ctors.Distortion && DRONE_DISTORTION > 0) {
			const dist = new ctors.Distortion(DRONE_DISTORTION, '2x');
			dist.amp(DRONE_DISTORTION_AMP);
			filter.disconnect();
			filter.connect(dist);
			voiceBus = dist;
		}

		const reverb = new ctors.Reverb();
		reverb.process(voiceBus, REVERB_SECONDS, REVERB_DECAY);
		reverb.drywet(REVERB_DRYWET);
		reverb.amp(REVERB_AMP);

		chimeBus = new ctors.Filter('lowpass');
		chimeBus.freq(2800);
		chimeBus.res(1);
		const chimeReverb = new ctors.Reverb();
		chimeReverb.process(chimeBus, 2.4, 3.8);
		chimeReverb.drywet(0.4);
		chimeReverb.amp(0.85);
	}

	function startTone(
		ctors: P5SoundConstructors,
		type: string,
		hz: number,
		attackAmp: number,
		sustainAmp: number,
		softOnset: boolean
	): SoundOscillator {
		const osc = new ctors.Oscillator(type);
		osc.disconnect();
		osc.connect(filter as SoundFilter);
		osc.amp(0);
		osc.start();
		if (softOnset) {
			osc.freq(hz * SOFT_ATTACK_PITCH_RATIO);
			osc.freq(hz, SOFT_ATTACK_PITCH_TIME);
		} else {
			osc.freq(hz * ATTACK_PITCH_RATIO);
			osc.freq(hz, ATTACK_PITCH_TIME);
			osc.amp(attackAmp, ATTACK_AMP_TIME);
			osc.amp(sustainAmp, 0.1, ATTACK_AMP_TIME);
		}
		return osc;
	}

	function stopVoices(quickRelease: boolean): void {
		const release = quickRelease ? BOID_RELEASE_TIME : RELEASE_TIME;
		const stopMs = quickRelease ? 280 : RELEASE_STOP_MS;
		for (const osc of voices) {
			try {
				osc.amp(0, release);
				window.setTimeout(() => {
					try {
						osc.stop();
					} catch {
						/* already stopped */
					}
				}, stopMs);
			} catch {
				/* ignore teardown races */
			}
		}
		voices = [];
		voiceBaseAmps = [];
		voiceBaseHz = [];
		voicePulsePhases = [];
	}

	function admitConversionPings(
		conversions: ReadonlyArray<{ midi: number }>
	): void {
		if (!config.conversionPings || conversions.length === 0) return;
		const now = performance.now();
		lastInfectionAt = now;
		for (let i = 0; i < conversions.length; i++) {
			if (Math.random() > CONVERT_PING_ADMIT) continue;
			convertPingPool.push(conversions[i]!.midi);
		}
		while (convertPingPool.length > CONVERT_PING_POOL_MAX) {
			convertPingPool.shift();
		}
		if (nextConvertPingAt < now) {
			nextConvertPingAt = now + Math.random() * CONVERT_PING_GAP_MIN_MS * 0.6;
		}
	}

	function dripConversionPings(): void {
		if (!config.conversionPings || !ready || !chimeBus) return;
		const now = performance.now();

		if (convertPingPool.length > 0 && now - lastInfectionAt > CONVERT_PING_ACTIVITY_MS) {
			convertPingPool.length = 0;
			return;
		}
		if (convertPingPool.length === 0 || now < nextConvertPingAt) return;

		if (now - convertPingWindowStart > CONVERT_PING_WINDOW_MS) {
			convertPingWindowStart = now;
			convertPingsInWindow = 0;
		}
		if (convertPingsInWindow >= MAX_CONVERT_PINGS_PER_WINDOW) {
			nextConvertPingAt = convertPingWindowStart + CONVERT_PING_WINDOW_MS;
			return;
		}

		let idx = Math.floor(Math.random() * convertPingPool.length);
		if (convertPingPool.length > 1 && convertPingPool[idx] === lastConvertPingMidi) {
			idx = (idx + 1) % convertPingPool.length;
		}
		const midi = convertPingPool.splice(idx, 1)[0]!;
		lastConvertPingMidi = midi;

		const ctors = soundCtors(p.constructor as typeof p5);
		const hz = midiNumberToHz(midi) * CONVERT_PING_HZ_RATIO;
		const bus = chimeBus;

		function pingTap(amp: number, delayMs: number): void {
			window.setTimeout(() => {
				try {
					const osc = new ctors.Oscillator('sine');
					osc.disconnect();
					osc.connect(bus);
					osc.freq(hz);
					osc.amp(0);
					osc.start();
					osc.amp(amp, CONVERT_PING_ATTACK);
					osc.amp(0, CONVERT_PING_RELEASE, CONVERT_PING_ATTACK);
					window.setTimeout(() => {
						try {
							osc.stop();
						} catch {
							/* already stopped */
						}
					}, CONVERT_PING_MS);
				} catch {
					/* graph torn down */
				}
			}, delayMs);
		}

		pingTap(CONVERT_PING_AMP, 0);
		for (const echo of CONVERT_PING_ECHO) {
			pingTap(CONVERT_PING_AMP * echo.ampScale, echo.delayMs);
		}

		convertPingsInWindow += 1;
		nextConvertPingAt =
			now +
			CONVERT_PING_GAP_MIN_MS +
			Math.random() * (CONVERT_PING_GAP_MAX_MS - CONVERT_PING_GAP_MIN_MS);
	}

	function easeIntensity(target: number, dtMs: number): number {
		const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
		const tau = target >= smoothedIntensity ? INTENSITY_RISE_SEC : INTENSITY_FALL_SEC;
		const alpha = 1 - Math.exp(-dt / tau);
		smoothedIntensity += (target - smoothedIntensity) * alpha;
		return smoothedIntensity;
	}

	return {
		id: config.id,

		unlock(_host: AudioHost): void {
			void _host.unlock();
			ensureGraph();
			void (p as P5WithSound).userStartAudio?.();
			ready = true;
		},

		onVoicing(event: VoicingChange): void {
			stopVoices(config.quickRelease);
			if (config.simDrivenIntensity) {
				smoothedIntensity = BOID_INTENSITY_FLOOR;
				simIntensity = BOID_INTENSITY_FLOOR;
			}
			if (!ready || !filter) return;

			const ctors = soundCtors(p.constructor as typeof p5);
			filter.freq(FILTER_CUTOFF);
			voiceBaseAmps = [];
			voiceBaseHz = [];
			voicePulsePhases = [];

			for (const note of event.notes) {
				const hz = midiNumberToHz(note);
				const bassish = note < VOICING_LOW_MIDI;
				const attack = bassish ? ATTACK_AMP * 1.35 : ATTACK_AMP;
				const sustain = bassish ? SUSTAIN_AMP * 1.4 : SUSTAIN_AMP;
				const detune = bassish ? DETUNE_AMP * 0.7 : DETUNE_AMP;
				const detuneHz = hz * DETUNE_RATIO;
				voices.push(
					startTone(
						ctors,
						'triangle',
						hz,
						attack,
						sustain,
						config.softOnset
					)
				);
				voiceBaseAmps.push(sustain);
				voiceBaseHz.push(hz);
				voicePulsePhases.push(p.random(p.TWO_PI));
				voices.push(
					startTone(
						ctors,
						'triangle',
						detuneHz,
						detune * 1.2,
						detune,
						config.softOnset
					)
				);
				voiceBaseAmps.push(detune);
				voiceBaseHz.push(detuneHz);
				voicePulsePhases.push(p.random(p.TWO_PI));
			}
		},

		onRelease(): void {
			stopVoices(false);
			convertPingPool.length = 0;
			lastInfectionAt = -Infinity;
			if (config.simDrivenIntensity) {
				smoothedIntensity = 1;
				simIntensity = 1;
			}
		},

		onSimFeedback(feedback: SimFeedback): void {
			if (config.simDrivenIntensity) {
				simIntensity = feedback.intensity;
			}
			admitConversionPings(feedback.conversions);
		},

		tick(dtMs: number): void {
			if (!ready || voices.length === 0) {
				dripConversionPings();
				return;
			}

			const intensity = config.simDrivenIntensity
				? easeIntensity(simIntensity, dtMs)
				: STATIC_DRONE_INTENSITY;

			const t = p.millis() * 0.001;
			const pulseOmega = p.TWO_PI * DRONE_PULSE_HZ;
			const breatheOmega = p.TWO_PI * FILTER_BREATHE_HZ;
			const wobbleOmega = p.TWO_PI * VOICE_WOBBLE_HZ;

			if (filter) {
				try {
					const breathe = Math.sin(t * breatheOmega);
					filter.freq(FILTER_CUTOFF + breathe * FILTER_BREATHE_DEPTH, 0.1);
				} catch {
					/* ignore teardown races */
				}
			}

			for (let i = 0; i < voices.length; i++) {
				const base = voiceBaseAmps[i] ?? SUSTAIN_AMP;
				const phase = voicePulsePhases[i] ?? 0;
				const pulse = 1 + DRONE_PULSE_DEPTH * Math.sin(t * pulseOmega + phase);
				try {
					voices[i].amp(base * intensity * pulse, BOID_INTENSITY_RAMP);
				} catch {
					/* ignore teardown races */
				}
				const hz = voiceBaseHz[i];
				if (hz !== undefined) {
					try {
						const wobble = Math.sin(t * wobbleOmega + phase * 1.63);
						const ratio = Math.pow(2, (wobble * VOICE_WOBBLE_CENTS) / 1200);
						voices[i].freq(hz * ratio, 0.08);
					} catch {
						/* ignore teardown races */
					}
				}
			}

			dripConversionPings();
		},

		destroy(): void {
			stopVoices(false);
			convertPingPool.length = 0;
			filter = undefined;
			voiceBus = undefined;
			chimeBus = undefined;
			ready = false;
		},

		isReady(): boolean {
			return ready;
		},

		hasVoices(): boolean {
			return voices.length > 0;
		}
	};
}

export type P5DronePlayer = ReturnType<typeof createP5DronePlayer> & {
	isReady(): boolean;
	hasVoices(): boolean;
};
