import { Color, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { WebGLHost } from './types.ts';

export interface WebGLHostInternal extends WebGLHost {
	wrapper: HTMLElement;
	scene: Scene;
	camera: OrthographicCamera;
	renderer: WebGLRenderer;
	overlayCanvas: HTMLCanvasElement;
	setClearOpaque(opaque: boolean): void;
	mountVideoElement(video: HTMLVideoElement): void;
}

export function createWebGLHost(mountEl: HTMLElement): WebGLHostInternal {
	const wrapper = document.createElement('div');
	wrapper.style.position = 'relative';
	wrapper.style.width = '100%';
	wrapper.style.height = '100%';
	mountEl.appendChild(wrapper);

	const canvas = document.createElement('canvas');
	canvas.style.display = 'block';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	canvas.style.position = 'relative';
	canvas.style.zIndex = '1';

	const overlayCanvas = document.createElement('canvas');
	overlayCanvas.style.position = 'absolute';
	overlayCanvas.style.inset = '0';
	overlayCanvas.style.width = '100%';
	overlayCanvas.style.height = '100%';
	overlayCanvas.style.pointerEvents = 'none';
	overlayCanvas.style.zIndex = '2';

	wrapper.appendChild(canvas);
	wrapper.appendChild(overlayCanvas);

	const scene = new Scene();
	scene.background = new Color(0x0a0c0d);
	const camera = new OrthographicCamera(0, 1, 1, 0, -10, 10);
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	let videoEl: HTMLVideoElement | undefined;

	function setClearOpaque(opaque: boolean): void {
		if (opaque) {
			scene.background = new Color(0x0a0c0d);
			renderer.setClearColor(0x0a0c0d, 1);
		} else {
			scene.background = null;
			renderer.setClearColor(0x0a0c0d, 0);
		}
	}

	setClearOpaque(true);

	function attachVideo(video: HTMLVideoElement): void {
		videoEl = video;
		video.style.position = 'absolute';
		video.style.inset = '0';
		video.style.width = '100%';
		video.style.height = '100%';
		video.style.objectFit = 'cover';
		video.style.transform = 'scaleX(-1)';
		video.style.zIndex = '0';
		video.style.display = 'none';
		wrapper.insertBefore(video, canvas);
	}

	let width = 1;
	let height = 1;

	function layout(): void {
		const rect = mountEl.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio, 2);
		width = Math.max(1, Math.floor(rect.width));
		height = Math.max(1, Math.floor(rect.height));
		renderer.setPixelRatio(dpr);
		renderer.setSize(width, height, false);
		overlayCanvas.width = Math.floor(width * dpr);
		overlayCanvas.height = Math.floor(height * dpr);
		overlayCanvas.style.width = `${width}px`;
		overlayCanvas.style.height = `${height}px`;
	camera.left = 0;
	camera.right = width;
	camera.top = 0;
	camera.bottom = height;
	camera.position.set(0, 0, 1);
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();
	}

	layout();

	return {
		wrapper,
		scene,
		camera,
		renderer,
		canvas,
		overlayCanvas,

		get width() {
			return width;
		},
		get height() {
			return height;
		},

		setClearOpaque,
		mountVideoElement: attachVideo,

		resize() {
			layout();
		},

		render() {
			renderer.render(scene, camera);
		},

		destroy() {
			videoEl?.remove();
			renderer.dispose();
			wrapper.remove();
		}
	};
}
