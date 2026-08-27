import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	ShaderMaterial,
	Vector3,
	type Scene
} from 'three';
import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import { BOID_FLOATS } from '../compute/boidLayout.ts';
import { BOID_GLOW_FRAG, BOID_GLOW_VERT } from './glowShaders.ts';

const NOTE_COLORS_RGB: readonly number[] = [
	72 / 255, 255 / 255, 195 / 255,
	255 / 255, 205 / 255, 72 / 255,
	88 / 255, 210 / 255, 255 / 255,
	255 / 255, 108 / 255, 175 / 255,
	210 / 255, 130 / 255, 255 / 255,
	255 / 255, 245 / 255, 95 / 255,
	64 / 255, 255 / 255, 238 / 255,
	255 / 255, 92 / 255, 210 / 255,
	130 / 255, 255 / 255, 108 / 255,
	255 / 255, 155 / 255, 88 / 255,
	175 / 255, 175 / 255, 255 / 255,
	255 / 255, 215 / 255, 145 / 255
];

const BASS_COLOR_RGB = [255 / 255, 92 / 255, 42 / 255] as const;

const NOTE_COLOR_V3: Vector3[] = [];
for (let i = 0; i < NOTE_COLORS_RGB.length; i += 3) {
	NOTE_COLOR_V3.push(
		new Vector3(NOTE_COLORS_RGB[i]!, NOTE_COLORS_RGB[i + 1]!, NOTE_COLORS_RGB[i + 2]!)
	);
}

const BASS_COLOR_V3 = new Vector3(BASS_COLOR_RGB[0]!, BASS_COLOR_RGB[1]!, BASS_COLOR_RGB[2]!);

/** Instanced attrs packed into vec4s — WebGL caps vertex attribs at 16 (InstancedMesh uses 4). */
const PACK_ATTRS = ['iPack0', 'iPack1', 'iPack2'] as const;

export class BoidGlowMesh {
	readonly mesh: InstancedMesh;
	private readonly material: ShaderMaterial;
	private readonly count: number;
	private readonly pack0: Float32Array;
	private readonly pack1: Float32Array;
	private readonly pack2: Float32Array;

	constructor(scene: Scene, count: number) {
		this.count = count;
		this.pack0 = new Float32Array(count * 4);
		this.pack1 = new Float32Array(count * 4);
		this.pack2 = new Float32Array(count * 4);

		const noteColors = NOTE_COLOR_V3;
		const geometry = new BufferGeometry();
		const corners = new Float32Array([
			-1, -1, 0,
			1, -1, 0,
			1, 1, 0,
			-1, -1, 0,
			1, 1, 0,
			-1, 1, 0
		]);
		geometry.setAttribute('position', new BufferAttribute(corners, 3));

		for (const [arr, name] of [
			[this.pack0, 'iPack0'],
			[this.pack1, 'iPack1'],
			[this.pack2, 'iPack2']
		] as const) {
			const attr = new InstancedBufferAttribute(arr, 4);
			attr.setUsage(DynamicDrawUsage);
			geometry.setAttribute(name, attr);
		}

		this.material = new ShaderMaterial({
			vertexShader: BOID_GLOW_VERT,
			fragmentShader: BOID_GLOW_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: false,
			side: DoubleSide,
			blending: AdditiveBlending,
			uniforms: {
				uMillis: { value: 0 },
				uMaxSpeedAssigned: { value: 5.4 },
				uMaxSpeedIdle: { value: 2.4 },
				uIdleAlphaBase: { value: 0.16 },
				uIdleAlphaPulse: { value: 0.14 },
				uGlowPointSize: { value: 1 },
				uGlowSpeedSize: { value: 1 },
				uNoteCount: { value: 0 },
				uNotes: { value: new Float32Array(8) },
				uBassActive: { value: 0 },
				uNoteColors: { value: noteColors },
				uBassColor: { value: BASS_COLOR_V3 }
			}
		});

		this.mesh = new InstancedMesh(geometry, this.material, count);
		this.mesh.frustumCulled = false;
		scene.add(this.mesh);
	}

	setParams(params: BoidsParams): void {
		const u = this.material.uniforms;
		u.uMaxSpeedAssigned!.value = params.maxSpeedAssigned;
		u.uMaxSpeedIdle!.value = params.maxSpeedIdle;
		u.uIdleAlphaBase!.value = params.idleAlphaBase;
		u.uIdleAlphaPulse!.value = params.idleAlphaPulse;
		u.uGlowPointSize!.value = params.glowPointSize;
		u.uGlowSpeedSize!.value = params.glowSpeedSize;
	}

	setSoundingNotes(notes: readonly number[] | null, bassActive: boolean): void {
		const u = this.material.uniforms;
		u.uNoteCount!.value = notes?.length ?? 0;
		const arr = u.uNotes!.value as Float32Array;
		arr.fill(-1);
		if (notes) {
			for (let i = 0; i < notes.length && i < 8; i++) arr[i] = notes[i]!;
		}
		u.uBassActive!.value = bassActive ? 1 : 0;
	}

	setMillis(millis: number): void {
		this.material.uniforms.uMillis!.value = millis;
	}

	uploadPacked(data: Float32Array, count = this.count): void {
		const n = Math.min(count, this.count);
		for (let i = 0; i < n; i++) {
			const base = i * BOID_FLOATS;
			const p0 = i * 4;
			this.pack0[p0] = data[base]!;
			this.pack0[p0 + 1] = data[base + 1]!;
			this.pack0[p0 + 2] = data[base + 2]!;
			this.pack0[p0 + 3] = data[base + 3]!;
			this.pack1[p0] = data[base + 4]!;
			this.pack1[p0 + 1] = data[base + 5]!;
			this.pack1[p0 + 2] = data[base + 6]!;
			this.pack1[p0 + 3] = data[base + 7]!;
			this.pack2[p0] = data[base + 8]!;
			this.pack2[p0 + 1] = data[base + 9]!;
			this.pack2[p0 + 2] = data[base + 10]!;
			this.pack2[p0 + 3] = data[base + 11]!;
		}
		const geo = this.mesh.geometry as BufferGeometry;
		for (const name of PACK_ATTRS) {
			(geo.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true;
		}
	}

	destroy(): void {
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.mesh.removeFromParent();
	}
}
