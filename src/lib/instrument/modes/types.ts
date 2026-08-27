import type { RenderModeId } from './ids.ts';
import type { InstrumentPlayer } from '../player/types.ts';
import type { InstrumentRenderer } from '../renderer/types.ts';

/** Pairs a visualization with its audio behavior. */
export interface InstrumentMode {
	id: RenderModeId;
	label: string;
	createRenderer(): InstrumentRenderer;
	createPlayer(): InstrumentPlayer;
}
