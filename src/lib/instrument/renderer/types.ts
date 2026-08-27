import type { PitchClass, ScaleMode } from '../harmony/scales.ts';
import type { SimFeedback, ReleaseEvent, VoicingChange } from '../events.ts';
import type { RenderHost } from '../hosts.ts';
import type { MusicalIntent } from '../input/types.ts';
import type { QualityName } from '../quality.ts';

/** Read-only snapshot for draw / sim step. */
export interface RenderFrame {
	millis: number;
	deltaTime: number;
	rootPc: PitchClass;
	mode: ScaleMode;
	intent: MusicalIntent;
	notes: number[] | null;
	degree: number | null;
	quality: QualityName | null;
	bassActive: boolean;
}

/** Visualization / simulation — no audio or capture imports. */
export interface InstrumentRenderer {
	readonly id: string;
	onVoicing(event: VoicingChange): void;
	onRelease(event?: ReleaseEvent): void;
	draw(host: RenderHost, frame: RenderFrame): SimFeedback;
	resize?(host: RenderHost): void;
	destroy?(): void;
}
