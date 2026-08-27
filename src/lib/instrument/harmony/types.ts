import type { PitchClass, ScaleMode } from './scales.ts';
import type { InstrumentEvent } from '../events.ts';
import type { QualityName } from '../quality.ts';

export type { HarmonyController, HarmonyUpdateParams } from './controller.ts';
export { createHarmonyController } from './controller.ts';

export interface HarmonyState {
	currentDegree: number | null;
	currentQuality: QualityName;
	notes: number[] | null;
	bassActive: boolean;
}
