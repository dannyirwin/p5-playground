import type p5 from 'p5';
import type { HandCapture } from '../hosts.ts';
import type { HandSnapshot } from '../hands.ts';

interface HandPose {
	detectStart: (
		video: p5.Element,
		callback: (results: HandSnapshot[]) => void
	) => void;
}

interface Ml5Api {
	handPose: (options: { maxHands: number }) => HandPose;
}

declare global {
	interface Window {
		ml5: Ml5Api;
	}
}

/** ml5 handPose over a p5 video capture element. */
export function createMl5HandCapture(p: p5): HandCapture {
	let video: p5.Element | undefined;
	let handPose: HandPose | undefined;
	let hands: HandSnapshot[] = [];
	let captureWidth = 640;
	let captureHeight = 480;
	let started = false;

	return {
		get captureWidth() {
			return captureWidth;
		},
		get captureHeight() {
			return captureHeight;
		},

		getHands() {
			return hands;
		},

		getVideoElement() {
			const elt = video?.elt;
			return elt instanceof HTMLVideoElement ? elt : null;
		},

		prepare() {
			if (handPose) return;
			handPose = window.ml5.handPose({ maxHands: 2 });
		},

		start() {
			if (started) return;
			started = true;
			if (!handPose) this.prepare?.();
			try {
				video = p.createCapture('video');
				video.size(captureWidth, captureHeight);
				video.hide();
				handPose?.detectStart(video, (results) => {
					hands = results;
				});
			} catch (err) {
				console.warn('No webcam found', err);
				video = undefined;
			}
		},

		stop() {
			hands = [];
			started = false;
		}
	};
}
