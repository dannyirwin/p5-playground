/**
 * Robust Web Audio unlock for iOS / iPadOS Safari.
 *
 * Safari starts every AudioContext `suspended` until a user gesture resumes it.
 * iPad is stricter than desktop:
 *
 * 1. Prefer a real button `click` / `touchend` - canvas `mousePressed` (often
 *    mapped from `touchstart` / `pointerdown`) is frequently rejected.
 * 2. `resume()` alone is unreliable; playing a short silent buffer in the same
 *    gesture kicks the hardware output awake.
 * 3. After backgrounding or a camera permission sheet the context may become
 *    `interrupted` and needs another gesture to resume.
 */

type ContextGetter = () => AudioContext | undefined;

export interface AudioUnlockHandle {
	destroy: () => void;
	isRunning: () => boolean;
	/**
	 * Call from a button click / touchend handler. Creates the p5.sound
	 * context if needed, resumes it, and kicks a silent buffer.
	 */
	unlockFromGesture: () => void;
}

const UNLOCK_EVENTS = ['touchend', 'mouseup', 'pointerup', 'click', 'keydown'] as const;

function kickSilentBuffer(ctx: AudioContext): void {
	try {
		const buffer = ctx.createBuffer(1, 1, 22050);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		source.start(0);
	} catch {
		// Best effort - never let the unlock kick throw into a gesture handler.
	}
}

export function installAudioUnlock(
	getContext: ContextGetter,
	onRunningChange?: (running: boolean) => void,
	/** Optional: create / warm the p5.sound AudioContext (e.g. userStartAudio). */
	ensureAudio?: () => void
): AudioUnlockHandle {
	const controller = new AbortController();
	let running = false;
	let boundContext: AudioContext | undefined;

	function setRunning(next: boolean): void {
		if (next === running) return;
		running = next;
		onRunningChange?.(running);
	}

	function bindStateChange(ctx: AudioContext): void {
		if (boundContext === ctx) return;
		boundContext = ctx;
		ctx.addEventListener('statechange', () => setRunning(ctx.state === 'running'), {
			signal: controller.signal
		});
	}

	function attemptUnlock(): void {
		// Must stay synchronous in the gesture chain - no await before resume.
		try {
			ensureAudio?.();
		} catch {
			/* ignore */
		}

		const ctx = getContext();
		if (!ctx) return;
		bindStateChange(ctx);

		if (ctx.state === 'running') {
			setRunning(true);
			return;
		}

		kickSilentBuffer(ctx);
		void ctx.resume().then(
			() => setRunning(ctx.state === 'running'),
			() => {
				/* rejected: leave running false so the next gesture retries */
			}
		);
	}

	for (const event of UNLOCK_EVENTS) {
		window.addEventListener(event, attemptUnlock, {
			signal: controller.signal,
			passive: true
		});
	}

	document.addEventListener(
		'visibilitychange',
		() => {
			if (!document.hidden) attemptUnlock();
		},
		{ signal: controller.signal }
	);

	const startedAt = Date.now();
	const poll = window.setInterval(() => {
		const ctx = getContext();
		if (ctx) {
			bindStateChange(ctx);
			setRunning(ctx.state === 'running');
		}
		if ((ctx && running) || Date.now() - startedAt > 10_000) {
			window.clearInterval(poll);
		}
	}, 250);

	return {
		destroy: () => {
			window.clearInterval(poll);
			controller.abort();
		},
		isRunning: () => running,
		unlockFromGesture: attemptUnlock
	};
}
