import {
	BufferAttribute,
	BufferGeometry,
	LineSegments,
	LineBasicMaterial,
	type Scene
} from 'three';
import { sampleWindField } from '../../boids/fieldSample.ts';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';

/** Grid of direction arrows for the Perlin wind layer only. */
export class WindFieldMesh {
	private readonly lines: LineSegments;
	private readonly positions: Float32Array;
	private readonly capacity: number;

	constructor(scene: Scene, maxSegments: number) {
		this.capacity = maxSegments;
		this.positions = new Float32Array(maxSegments * 6);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
		const material = new LineBasicMaterial({
			color: 0xa0c8dc,
			transparent: true,
			opacity: 0.55,
			depthWrite: false,
			depthTest: false
		});
		this.lines = new LineSegments(geometry, material);
		this.lines.frustumCulled = false;
		this.lines.renderOrder = -10;
		this.lines.visible = false;
		scene.add(this.lines);
	}

	update(
		width: number,
		height: number,
		millis: number,
		params: BoidsParams
	): void {
		if (!params.showWindField || !params.windEnabled || width < 16 || height < 16) {
			this.lines.visible = false;
			return;
		}

		const step = Math.max(16, params.windFieldStep);
		const scale = params.windFieldScale;
		let seg = 0;

		for (let y = step * 0.5; y < height && seg < this.capacity; y += step) {
			for (let x = step * 0.5; x < width && seg < this.capacity; x += step) {
				const field = sampleWindField(x, y, width, height, millis, params);
				const mag = Math.hypot(field.x, field.y);
				if (mag < 0.001) continue;

				const len = Math.min(scale * 1.6, scale * (0.35 + mag * 1.4));
				const ux = (field.x / mag) * len;
				const uy = (field.y / mag) * len;
				const x2 = x + ux;
				const y2 = y + uy;
				const hx = -uy * 0.28;
				const hy = ux * 0.28;

				const base = seg * 6;
				this.positions[base] = x;
				this.positions[base + 1] = y;
				this.positions[base + 2] = 0;
				this.positions[base + 3] = x2;
				this.positions[base + 4] = y2;
				this.positions[base + 5] = 0;
				seg++;

				if (seg >= this.capacity) break;
				const b2 = seg * 6;
				this.positions[b2] = x2;
				this.positions[b2 + 1] = y2;
				this.positions[b2 + 2] = 0;
				this.positions[b2 + 3] = x2 - ux * 0.28 + hx;
				this.positions[b2 + 4] = y2 - uy * 0.28 + hy;
				this.positions[b2 + 5] = 0;
				seg++;

				if (seg >= this.capacity) break;
				const b3 = seg * 6;
				this.positions[b3] = x2;
				this.positions[b3 + 1] = y2;
				this.positions[b3 + 2] = 0;
				this.positions[b3 + 3] = x2 - ux * 0.28 - hx;
				this.positions[b3 + 4] = y2 - uy * 0.28 - hy;
				this.positions[b3 + 5] = 0;
				seg++;
			}
		}

		const geo = this.lines.geometry as BufferGeometry;
		const attr = geo.getAttribute('position') as BufferAttribute;
		geo.setDrawRange(0, seg * 2);
		attr.needsUpdate = true;

		const material = this.lines.material as LineBasicMaterial;
		material.opacity = 0.55;
		this.lines.visible = seg > 0;
	}

	destroy(): void {
		this.lines.geometry.dispose();
		(this.lines.material as LineBasicMaterial).dispose();
		this.lines.removeFromParent();
	}
}
