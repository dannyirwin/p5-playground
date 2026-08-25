import type p5 from 'p5';
import { createInstrumentCore } from './instrumentCore.ts';
import { coerceRenderModeId, createRenderer } from './renderers/index.ts';
import type { Renderer, RenderModeId, SketchOptions } from './types.ts';

/**
 * Wires the instrument controller to a renderer chosen at runtime, so the
 * visualization can be swapped without touching input or audio.
 */
export function createSketch(options: SketchOptions): (p: p5) => void {
	let activeId: RenderModeId | undefined;
	let renderer: Renderer | undefined;

	return createInstrumentCore({
		...options,
		getRenderer: () => {
			const id = coerceRenderModeId(options.getRenderMode());
			if (!renderer || activeId !== id) {
				activeId = id;
				renderer = createRenderer(id);
			}
			return renderer;
		}
	});
}
