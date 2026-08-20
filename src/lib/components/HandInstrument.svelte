<script lang="ts">
	import { onMount } from 'svelte';
	import type p5 from 'p5';
	import {
		createHandInstrument,
		type InstrumentHudState
	} from '$lib/sketch/handInstrument';
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

	let hud = $state<InstrumentHudState>({
		keyLabel: 'C major',
		degree: null,
		tilt: 'neutral',
		degreeFacing: null,
		quality: null,
		qualitySource: 'none',
		modFacing: null,
		notes: null,
		followerX: 0,
		followerY: 0,
		handsDetected: 0
	});

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
						getMode: () => mode,
						onHudUpdate: (state) => {
							hud = state;
						}
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
	<div class="canvas-host" bind:this={mountEl}></div>

	<div class="overlay">
		<div class="hud">
			<p><span class="label">Key</span> {hud.keyLabel}</p>
			<p>
				<span class="label">Degree</span>
				{hud.degree ?? '-'}
				<span class="label">Tilt</span> {hud.tilt}
				<span class="label">Palm</span>
				{hud.degreeFacing ?? '-'}
			</p>
			<p>
				<span class="label">Quality</span>
				{hud.quality ?? '-'}
				{#if hud.qualitySource === 'mod'}
					(mod{#if hud.modFacing === 'cam'}, palm cam{/if}{#if hud.modFacing === 'away'}, palm away{/if})
				{:else if hud.qualitySource === 'triad'}
					(triad)
				{/if}
			</p>
			<p>
				<span class="label">Notes</span>
				{hud.notes?.join(', ') ?? '-'}
			</p>
			<p>
				<span class="label">Center</span>
				{Math.round(hud.followerX)}, {Math.round(hud.followerY)}
			</p>
			<p>
				<span class="label">Hands</span> {hud.handsDetected}
			</p>
		</div>

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

			<button type="button" onclick={() => (showVideo = !showVideo)}>
				{showVideo ? 'Hide video' : 'Show video'}
			</button>
		</div>

		{#if loadError}
			<p class="error">{loadError}</p>
		{/if}
	</div>
</div>

<!--
<p class="hint">
	Click the canvas to enable audio. Choose Key (C-B) and Mode (major/minor)
	above; natural triads follow that scale.
</p>
<p class="hint">
	Degree hand (1-7): 1 index; 2 index+middle; 3 thumb-pinky touch with
	index/middle/ring up; 4 four fingers thumb in; 5 open hand; 6
	index+pinky (no thumb); 7 thumb out fist. Fist / unclear releases. Inward tilt
	keeps the diatonic triad; outward flips maj/min (diminished becomes major).
</p>
<p class="hint">
	Modifier hand (overrides tilt when clear). Palm toward camera: 1 finger =
	maj7 if major triad / min7 if minor; 2 fingers = dom7 if major /
	half-dim7 if minor (add thumb out for full dim7); 3 = sus2; 4 = sus4.
	Palm away: 1 = aug, 2 = dim. Outward tilt on a diminished degree (e.g. 7
	in major) becomes a major triad on that root.
</p>
-->

<style>
	.instrument {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #0a0c0d;
		color: #e8ecef;
		font-family: system-ui, sans-serif;
	}

	.canvas-host {
		position: absolute;
		inset: 0;
	}

	.canvas-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
	}

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.hud {
		position: absolute;
		top: 16px;
		left: 16px;
		max-width: min(420px, calc(100vw - 32px));
		padding: 12px 14px;
		background: rgb(10 12 13 / 72%);
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 8px;
		backdrop-filter: blur(6px);
		font-size: 14px;
		line-height: 1.55;
	}

	.hud p {
		margin: 0 0 6px;
	}

	.hud p:last-child {
		margin-bottom: 0;
	}

	.label {
		color: #8a9399;
		margin-right: 6px;
	}

	.label + .label {
		margin-left: 12px;
	}

	.controls {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
		padding: 10px 12px;
		background: rgb(10 12 13 / 72%);
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 8px;
		backdrop-filter: blur(6px);
		pointer-events: auto;
	}

	.controls label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}

	.controls select,
	.controls button {
		background: #15191c;
		color: #e8ecef;
		border: 1px solid #2a3238;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}

	.error {
		position: absolute;
		bottom: 16px;
		left: 16px;
		margin: 0;
		padding: 10px 12px;
		color: #f07178;
		background: rgb(10 12 13 / 85%);
		border-radius: 8px;
		pointer-events: auto;
	}
</style>
