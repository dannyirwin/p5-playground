/**
 * Robust Web Audio unlock for iOS / iPadOS Safari.
 *
 * Safari (and Chrome) start every AudioContext `suspended` until a user
 * gesture resumes it. iOS is stricter than desktop in three ways that this
 * helper works around:
 *
 * 1. The gesture must be a "committed" event - `touchend`, `mouseup`, `click`,
 *    or `keydown`. Early events like `touchstart` / `pointerdown` (which p5's
 *    `mousePressed` maps to) are frequently rejected, so audio never unlocks.
 * 2. `resume()` alone is unreliable; playing a short silent buffer inside the
 *    same gesture reliably "kicks" the hardware output awake.
 * 3. After the tab is backgrounded (or a camera permission prompt appears) the
 *    context transitions to `interrupted` and must be resumed again on the next
 *    gesture / when the page becomes visible.
 */

type ContextGetter = () => AudioContext | undefined;

export interface AudioUnlockHandle {
	/** Detach all listeners. Safe to call more than once. */
	destroy: () => void;
	/** Whether the audio context is currently running. */
	isRunning: () => boolean;
}

/**
 * Committed gesture events only. iOS ignores `touchstart` / `pointerdown` /
 * `mousedown` for audio unlock on many versions, so they are deliberately
 * excluded.
 */
const UNLOCK_EVENTS = ['touchend', 'mouseup', 'pointerup', 'click', 'keydown'] as const;

/** Play a 1-sample silent buffer to force iOS to start real audio output. */
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
	onRunningChange?: (running: boolean) => void
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
		const ctx = getContext();
		if (!ctx) return;
		bindStateChange(ctx);

		if (ctx.state === 'running') {
			setRunning(true);
			return;
		}

		// Both calls must happen synchronously inside the gesture handler; any
		// prior `await` would break the gesture chain and iOS would stay muted.
		// The `statechange` listener and the resume() callback flip `running`
		// once the context actually starts.
		kickSilentBuffer(ctx);
		void ctx.resume().then(
			() => setRunning(ctx.state === 'running'),
			() => {
				/* rejected: leave `running` false so the next gesture retries */
			}
		);
	}

	for (const event of UNLOCK_EVENTS) {
		window.addEventListener(event, attemptUnlock, {
			signal: controller.signal,
			passive: true
		});
	}

	// Coming back from the background leaves the context `interrupted` on iOS.
	document.addEventListener(
		'visibilitychange',
		() => {
			if (!document.hidden) attemptUnlock();
		},
		{ signal: controller.signal }
	);

	// The audio context is created lazily (p5.sound builds it with the first
	// sound node), so it may not exist yet. Poll briefly until it appears, then
	// bind `statechange` and reflect the real state - this keeps the prompt
	// accurate even if the context starts running without our gesture (e.g.
	// relaxed autoplay policies).
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
		isRunning: () => running
	};
}
