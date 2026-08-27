import type { AudioHost } from '../hosts.ts';
import type { ReleaseEvent, SimFeedback, VoicingChange } from '../events.ts';

/** Audio engine — one implementation per mode behavior / backend. */
export interface InstrumentPlayer {
	readonly id: string;
	unlock(host: AudioHost): void;
	onVoicing(event: VoicingChange): void;
	onRelease(event?: ReleaseEvent): void;
	onSimFeedback(feedback: SimFeedback): void;
	tick(dtMs: number): void;
	destroy(): void;
	isReady?(): boolean;
	hasVoices?(): boolean;
}
