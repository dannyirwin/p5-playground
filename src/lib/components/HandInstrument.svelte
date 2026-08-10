<script lang="ts">
	import { onMount } from 'svelte';
	import type p5 from 'p5';
	import { createHandInstrument } from '$lib/sketch/handInstrument';
	import { loadBrowserSketchDeps } from '$lib/sketch/loadDeps';
	import {
		PITCH_CLASS_NAMES,
		type PitchClass,
		type ScaleMode
	} from '$lib/sketch/harmony';

	let mountEl: HTMLDivElement | undefined = $state();
	let showVideo = $state(false);
	let loadError = $state('');
	let rootPc = $state<PitchClass>(0);
	let mode = $state<ScaleMode>('major');

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
						getShowVideo: () => showVideo,
						getRootPc: () => rootPc,
						getMode: () => mode
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

	function onRootChange(event: Event): void {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (value >= 0 && value <= 11) {
			rootPc = value as PitchClass;
		}
	}

	function onModeChange(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'major' || value === 'minor') {
			mode = value;
		}
	}
</script>

<div class="instrument">
	<div class="controls">
		<label>
			Key
			<select value={rootPc} onchange={onRootChange}>
				{#each PITCH_CLASS_NAMES as name, pc}
					<option value={pc}>{name}</option>
				{/each}
			</select>
		</label>

		<label>
			Mode
			<select value={mode} onchange={onModeChange}>
				<option value="major">major</option>
				<option value="minor">minor</option>
			</select>
		</label>
	</div>

	<div class="canvas-host" bind:this={mountEl}></div>

	{#if loadError}
		<p class="error">{loadError}</p>
	{/if}

	<p class="hint">
		Click canvas to enable audio. Chord hand: ASL digits 1-8. Modifier hand:
		fingers/tilt/thumb set chord quality. Use Key/Mode to set the diatonic tonic.
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

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-bottom: 10px;
		max-width: 640px;
	}

	.controls label {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.controls select {
		background: #15191c;
		color: #e8ecef;
		border: 1px solid #2a3238;
		padding: 4px 8px;
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
