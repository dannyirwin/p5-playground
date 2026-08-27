import type p5 from 'p5';
import { createInstrumentCore } from './instrumentCore.ts';
import {
	coerceP5RenderModeId,
	createModeBundle,
	isBoidsParamsBridge
} from './modes/registry.ts';
import type { InstrumentPlayer, RenderModeId, Renderer, SketchOptions } from './types.ts';

/**
 * Wires the instrument controller to a mode bundle (renderer + player) at runtime.
 */
export function createSketch(options: SketchOptions): (p: p5) => void {
	let activeId: RenderModeId | undefined;
	let renderer: Renderer | undefined;
	let player: InstrumentPlayer | undefined;

	function notifyBoidsBridge(next: Renderer | undefined): void {
		if (!options.onBoidsParamsBridge) return;
		if (next && isBoidsParamsBridge(next)) {
			options.onBoidsParamsBridge(next);
		} else {
			options.onBoidsParamsBridge(null);
		}
	}

	return createInstrumentCore({
		...options,
		getRenderer: () => {
			if (!renderer) {
				throw new Error('Instrument player must initialize before renderer access');
			}
			return renderer;
		},
		getPlayer: (sketch) => {
			const id = coerceP5RenderModeId(options.getRenderMode());
			if (!player || activeId !== id) {
				const bundle = createModeBundle(sketch, id, {
					boidsParams: options.initialBoidsParams
				});
				activeId = id;
				renderer = bundle.renderer;
				player = bundle.player;
				notifyBoidsBridge(renderer);
			}
			return player;
		}
	});
}
