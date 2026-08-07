<script lang="ts">
	import { onMount } from 'svelte';
	import type p5 from 'p5';
	import { createHandInstrument } from '$lib/sketch/handInstrument';
	import { loadBrowserSketchDeps } from '$lib/sketch/loadDeps';

	let mountEl: HTMLDivElement | undefined = $state();
	let showVideo = $state(false);
	let loadError = $state('');

	onMount(() => {
		let instance: p5 | undefined;
		let cancelled = false;

		void (async () => {
			try {
				await loadBrowserSketchDeps();
				if (cancelled || !mountEl) return;

				const { default: P5 } = await import('p5');
				if (cancelled || !mountEl) return;

				instance = new P5(
					createHandInstrument({
						getShowVideo: () => showVideo
					}),
					mountEl
				);

				if (cancelled) {
					instance.remove();
					instance = undefined;
				}
			} catch (err) {
				loadError = err instanceof Error ? err.message : 'Failed to start sketch';
				console.error(err);
			}
		})();

		return () => {
			cancelled = true;
			instance?.remove();
		};
	});
</script>

<div class="instrument">
	<div class="canvas-host" bind:this={mountEl}></div>

	{#if loadError}
		<p class="error">{loadError}</p>
	{/if}

	<p class="hint">
		Click canvas to enable audio. Chord hand: ASL digits 1-8. Modifier hand:
		fingers/tilt/thumb set chord quality.
	</p>

	<button type="button" onclick={() => (showVideo = !showVideo)}>
		{showVideo ? 'Hide video' : 'Show video'}
	</button>
</div>

<style>
	.instrument {
		padding: 10px;
		color: #e8ecef;
		background: #0a0c0d;
		min-height: 100vh;
		box-sizing: border-box;
		font-family: system-ui, sans-serif;
	}

	.canvas-host :global(canvas) {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.hint {
		max-width: 640px;
		margin: 12px 0;
		line-height: 1.4;
	}

	.error {
		color: #f07178;
	}

	button {
		cursor: pointer;
	}
</style>
