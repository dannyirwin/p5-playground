<script lang="ts">
	import { onMount } from 'svelte';
	import type p5 from 'p5';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { createSketch } from '$lib/sketch/createSketch';
	import type { RenderModeId } from '$lib/instrument/modes/ids';
	import { isBoidsRenderMode, isGpuRenderMode } from '$lib/instrument/modes/ids';
	import type { InstrumentHudState } from '$lib/instrument/hud';
	import {
		DEFAULT_RENDER_MODE,
		RENDER_MODES,
		coerceRenderModeId
	} from '$lib/sketch/renderers';
	import {
		DEFAULT_BOIDS_PARAMS,
		applyActiveDefaultProfile,
		applyBoidsProfile,
		listSavedBoidsPresets,
		saveBoidsPreset,
		loadBoidsPresetBundle,
		deleteBoidsPreset,
		DEFAULT_GPU_BOID_COUNT,
		MAX_BOID_COUNT,
		MIN_BOID_COUNT,
		type BoidsParams
	} from '$lib/sketch/renderers/boidsParams';
	import {
		BOIDS_PROFILES,
		ACTIVE_BOIDS_PROFILE_ID,
		type BoidsProfileId
	} from '$lib/sketch/renderers/boidsProfiles';
	import type { BoidsParamsBridge } from '$lib/sketch/renderers/boids';
	import {
		DEFAULT_FLOCK_PRESET,
		snapshotFlockPreset,
		type FlockPreset
	} from '$lib/boids/flockSeparation';
	import { loadBrowserSketchDeps } from '$lib/sketch/loadDeps';
	import { attachKeyboardChordInput } from '$lib/instrument/input/keyboardChordInput';
	import {
		PITCH_CLASS_NAMES,
		SCALE_DEFS,
		isScaleMode,
		type PitchClass,
		type ScaleMode
	} from '$lib/sketch/harmony';

	let { renderMode = DEFAULT_RENDER_MODE }: { renderMode?: RenderModeId } = $props();

	const isGpuHost = $derived(isGpuRenderMode(renderMode));
	const isBoidsMode = $derived(isBoidsRenderMode(renderMode));

	const KEY_STORAGE = 'p5-playground:rootPc';
	const MODE_STORAGE = 'p5-playground:mode';
	const SHOW_HANDS_STORAGE = 'p5-playground:showHands';

	function loadRootPc(): PitchClass {
		try {
			const raw = localStorage.getItem(KEY_STORAGE);
			if (raw === null) return 0;
			const value = Number(raw);
			if (Number.isInteger(value) && value >= 0 && value <= 11) {
				return value as PitchClass;
			}
		} catch {
			/* private mode / unavailable */
		}
		return 0;
	}

	function loadMode(): ScaleMode {
		try {
			const raw = localStorage.getItem(MODE_STORAGE);
			if (isScaleMode(raw)) return raw;
		} catch {
			/* private mode / unavailable */
		}
		return 'major';
	}

	function persistKeyMode(nextRoot: PitchClass, nextMode: ScaleMode): void {
		try {
			localStorage.setItem(KEY_STORAGE, String(nextRoot));
			localStorage.setItem(MODE_STORAGE, nextMode);
		} catch {
			/* private mode / unavailable */
		}
	}

	/** Hand overlay is on by default; only an explicit opt-out turns it off. */
	function loadShowHands(): boolean {
		try {
			return localStorage.getItem(SHOW_HANDS_STORAGE) !== 'false';
		} catch {
			/* private mode / unavailable */
		}
		return true;
	}

	function persistShowHands(next: boolean): void {
		try {
			localStorage.setItem(SHOW_HANDS_STORAGE, String(next));
		} catch {
			/* private mode / unavailable */
		}
	}

	let mountEl: HTMLDivElement | undefined = $state();
	let hiddenEl: HTMLDivElement | undefined = $state();
	let showVideo = $state(false);
	let showHands = $state(true);
	let loadError = $state('');
	let audioReady = $state(false);
	let rootPc = $state<PitchClass>(0);
	let mode = $state<ScaleMode>('major');
	let unlockAudio: (() => void) | undefined = $state();
	let showBoidsPanel = $state(false);
	let boidsBridge = $state<BoidsParamsBridge | null>(null);
	/** Local mirror so slider bindings refresh the UI while writing through to the sim. */
	let bp = $state<BoidsParams>({ ...DEFAULT_BOIDS_PARAMS });
	/** Flock steering — dead↔dead, lit↔same, lit↔diff lanes. */
	let bf = $state<FlockPreset>(snapshotFlockPreset(DEFAULT_FLOCK_PRESET));
	let boidsPresetName = $state('');
	let boidsPresetList = $state<string[]>([]);
	let boidsPresetSelected = $state('');
	let boidsPresetStatus = $state('');
	let boidsBuiltInSelected = $state<BoidsProfileId | ''>(ACTIVE_BOIDS_PROFILE_ID);

	function applyBoidsParamsToSim(next: BoidsParams, status: string): void {
		if (boidsBridge) {
			boidsBridge.applyParams(next);
		}
		bp = { ...next };
		pullBoidsUiFromSim();
		boidsPresetStatus = status;
	}

	function onLoadBuiltInProfile(): void {
		if (!boidsBuiltInSelected) {
			boidsPresetStatus = 'Pick a built-in profile';
			return;
		}
		const profile = BOIDS_PROFILES.find((p) => p.id === boidsBuiltInSelected);
		if (!profile) {
			boidsPresetStatus = 'Unknown built-in profile';
			return;
		}
		if (boidsBridge) {
			applyBoidsProfile(boidsBridge, profile.id);
		}
		pullBoidsUiFromSim();
		boidsPresetStatus = `Loaded ${profile.label}`;
	}

	function refreshBoidsPresetList(): void {
		boidsPresetList = listSavedBoidsPresets();
		if (boidsPresetSelected && !boidsPresetList.includes(boidsPresetSelected)) {
			boidsPresetSelected = '';
		}
	}

	function pullBoidsUiFromSim(): void {
		bp = boidsBridge ? boidsBridge.snapshotParams() : { ...bp };
		bf = boidsBridge?.getFlockPreset?.() ?? bf;
	}

	function syncFlockPreset(next: FlockPreset): void {
		bf = snapshotFlockPreset(next);
		boidsBridge?.applyFlockPreset?.(bf);
	}

	function onFlockRange(
		mutate: (f: FlockPreset, value: number) => void,
		event: Event
	): void {
		const raw = parseFloat((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(raw)) return;
		const next = snapshotFlockPreset(bf);
		mutate(next, raw);
		syncFlockPreset(next);
	}

	function syncBoidsParam<K extends keyof BoidsParams>(key: K, value: BoidsParams[K]): void {
		bp[key] = value;
		if (!boidsBridge) return;
		if (key === 'boidCount' && typeof value === 'number') {
			boidsBridge.setBoidCount?.(value);
			pullBoidsUiFromSim();
			return;
		}
		const base = boidsBridge.snapshotBaseline?.().params ?? boidsBridge.snapshotParams();
		boidsBridge.applyParams({ ...base, [key]: value });
	}

	function onBoidsNumber(key: keyof BoidsParams, event: Event): void {
		const raw = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(raw)) return;
		const value =
			key === 'boidCount' ? Math.round(raw) : (raw as BoidsParams[typeof key]);
		syncBoidsParam(key, value as BoidsParams[typeof key]);
	}

	function onBoidsToggle(key: keyof BoidsParams): void {
		const next = !bp[key];
		syncBoidsParam(key, next as BoidsParams[typeof key]);
	}

	function onBoidsFalloffMode(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'linear' || value === 'quadratic') {
			syncBoidsParam('centerBiasFalloffMode', value);
		}
	}

	function onResetBoidsParams(): void {
		if (boidsBridge) {
			applyActiveDefaultProfile(boidsBridge);
		} else {
			bp = { ...DEFAULT_BOIDS_PARAMS };
		}
		pullBoidsUiFromSim();
		boidsBuiltInSelected = ACTIVE_BOIDS_PROFILE_ID;
		boidsPresetStatus = 'Reset to active default profile';
	}

	function onSaveBoidsPreset(): void {
		const name = boidsPresetName.trim();
		if (!name) {
			boidsPresetStatus = 'Enter a name to save';
			return;
		}
		const baseline = boidsBridge?.snapshotBaseline?.() ?? {
			params: boidsBridge?.snapshotParams() ?? bp,
			flock: boidsBridge?.getFlockPreset?.() ?? bf
		};
		if (saveBoidsPreset(name, baseline.params, baseline.flock)) {
			refreshBoidsPresetList();
			boidsPresetSelected = name;
			boidsPresetStatus = `Saved “${name}”`;
		} else {
			boidsPresetStatus = 'Could not save preset';
		}
	}

	function onLoadBoidsPreset(): void {
		const name = boidsPresetSelected || boidsPresetName.trim();
		if (!name) {
			boidsPresetStatus = 'Pick a saved preset';
			return;
		}
		const loaded = loadBoidsPresetBundle(name);
		if (!loaded) {
			boidsPresetStatus = `No preset named “${name}”`;
			return;
		}
		if (boidsBridge?.applyUserPreset) {
			boidsBridge.applyUserPreset(loaded.params, loaded.flock);
		} else {
			boidsBridge?.applyParams(loaded.params);
			if (loaded.flock) boidsBridge?.applyFlockPreset?.(loaded.flock);
		}
		bp = { ...loaded.params };
		if (loaded.flock) {
			bf = snapshotFlockPreset(loaded.flock);
		}
		pullBoidsUiFromSim();
		boidsPresetName = name;
		boidsPresetStatus = `Loaded “${name}” (dynamic tuning off)`;
	}

	function onDeleteBoidsPreset(): void {
		const name = boidsPresetSelected || boidsPresetName.trim();
		if (!name) {
			boidsPresetStatus = 'Pick a preset to delete';
			return;
		}
		if (deleteBoidsPreset(name)) {
			refreshBoidsPresetList();
			if (boidsPresetSelected === name) boidsPresetSelected = '';
			if (boidsPresetName.trim() === name) boidsPresetName = '';
			boidsPresetStatus = `Deleted “${name}”`;
		} else {
			boidsPresetStatus = `Could not delete “${name}”`;
		}
	}

	let hud = $state<InstrumentHudState>({
		keyLabel: 'C major',
		degree: null,
		tilt: 'neutral',
		degreeFacing: null,
		quality: null,
		qualitySource: 'none',
		modFacing: null,
		bassMode: false,
		bassActive: false,
		notes: null,
		followerX: 0,
		followerY: 0,
		handsDetected: 0,
		previewDegree: null,
		previewQuality: null,
		isSettling: false,
		settleProgress: 0
	});

	onMount(() => {
		rootPc = loadRootPc();
		mode = loadMode();
		showHands = loadShowHands();
		bp = { ...DEFAULT_BOIDS_PARAMS };
		if (isGpuRenderMode(renderMode)) {
			bp.boidCount = DEFAULT_GPU_BOID_COUNT;
		}
		refreshBoidsPresetList();

		const detachKeyboard = attachKeyboardChordInput();

		let instance: p5 | undefined;
		let stopGpu: (() => void) | undefined;
		let cancelled = false;

		void (async () => {
			try {
				await loadBrowserSketchDeps();
				if (cancelled || !mountEl) return;

				if (isGpuHost) {
					if (!hiddenEl) return;
					const { startGpuInstrument } = await import('$lib/gpu/createGpuInstrument');
					stopGpu = await startGpuInstrument(mountEl, hiddenEl, {
						getShowVideo: () => showVideo,
						getShowHands: () => showHands,
						getRootPc: () => rootPc,
						getMode: () => mode,
						initialBoidsParams: {
							...DEFAULT_BOIDS_PARAMS,
							boidCount: DEFAULT_GPU_BOID_COUNT
						},
						onBoidsParamsBridge: (bridge) => {
							boidsBridge = bridge;
							if (bridge) pullBoidsUiFromSim();
						},
						onHudUpdate: (state) => {
							hud = state;
						},
						onAudioControls: (controls) => {
							unlockAudio = () => controls.unlock();
						},
						onAudioReadyChange: (ready) => {
							audioReady = ready;
						}
					});
					return;
				}

				const { default: P5 } = await import('p5');
				if (cancelled || !mountEl) return;

				instance = new P5(
					createSketch({
						getShowVideo: () => showVideo,
						getShowHands: () => showHands,
						getRenderMode: () => renderMode,
						getRootPc: () => rootPc,
						getMode: () => mode,
						initialBoidsParams: { ...DEFAULT_BOIDS_PARAMS },
						onBoidsParamsBridge: (bridge) => {
							boidsBridge = bridge;
							if (bridge) pullBoidsUiFromSim();
						},
						onHudUpdate: (state) => {
							hud = state;
						},
						onAudioControls: (controls) => {
							unlockAudio = () => controls.unlock();
						},
						onAudioReadyChange: (ready) => {
							audioReady = ready;
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
			detachKeyboard();
			unlockAudio = undefined;
			boidsBridge = null;
			stopGpu?.();
			instance?.remove();
			mountEl?.replaceChildren();
			hiddenEl?.replaceChildren();
		};
	});

	function onRootChange(event: Event): void {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (value >= 0 && value <= 11) {
			rootPc = value as PitchClass;
			persistKeyMode(rootPc, mode);
		}
	}

	function onModeChange(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (isScaleMode(value)) {
			mode = value;
			persistKeyMode(rootPc, mode);
		}
	}

	function renderModePath(id: RenderModeId): string {
		if (id === 'boids-gpu') return `${base}/gpu/boids`;
		if (id === DEFAULT_RENDER_MODE) return `${base}/`;
		return `${base}/${id}`;
	}

	function onRenderModeChange(event: Event): void {
		const next = coerceRenderModeId(
			(event.currentTarget as HTMLSelectElement).value
		);
		if (next === renderMode) return;
		void goto(renderModePath(next));
	}

	function onToggleHands(): void {
		showHands = !showHands;
		persistShowHands(showHands);
	}

	function onEnableSound(): void {
		unlockAudio?.();
	}
</script>

<div class="instrument">
	<div class="canvas-host" bind:this={mountEl}></div>
	<div class="hidden-host" bind:this={hiddenEl} aria-hidden="true"></div>

	<div class="overlay">
		<div class="hud">
			<details class="how-to">
				<summary>How to play</summary>
				<div class="how-to-body">
					<p>
						<span class="label">Chord hand</span>
						Finger poses pick the scale degree: <strong>1–5</strong> = I–V (one finger up through open hand),
						<strong>6</strong> = index + pinky (horns),
						<strong>7</strong> = fist with thumb out.
						Fist / unclear releases.
					</p>
					<p>
						<span class="label">Natural / invert</span>
						Palm toward you keeps the triad natural to the mode (e.g. major stays major).
						Palm away — or tilting the hand outward — flips it (major ↔ minor).
					</p>
					<p>
						<span class="label">Modifier hand</span>
						Other hand adds color. Palm toward camera: 1–4 fingers = 7ths / sus.
						Palm away: 1 = aug, 2 = dim.
					</p>
					<p>
						<span class="label">Octave &amp; inversions</span>
						Hand height sets the register; move up/down to re-voice (inversions).
						Tap your hands together twice to toggle octave bass mode.
					</p>
					<p>
						<span class="label">Strings</span>
						Switch Render to <strong>Strings</strong> to see each pitch as a string —
						handy for learning how height and quality map to sound.
					</p>
				</div>
			</details>

			<p><span class="label">Key</span> {hud.keyLabel}</p>
			<p>
				<span class="label">Degree</span>
				{#if hud.isSettling && hud.previewDegree !== null}
					<span class="preview" title="Hold pose to commit">{hud.previewDegree}</span>
					<span class="preview-arrow">→</span>
				{/if}
				{hud.degree ?? '-'}
				<span class="label">Tilt</span> {hud.tilt}
				<span class="label">Palm</span>
				{hud.degreeFacing ?? '-'}
			</p>
			<p class="keyboard-hint"><span class="label">Keys</span> A–H / 1–8 = degrees (hold)</p>
			<p>
				<span class="label">Quality</span>
				{#if hud.isSettling && hud.previewQuality && hud.previewQuality !== hud.quality}
					<span class="preview" title="Hold pose to commit">{hud.previewQuality}</span>
					<span class="preview-arrow">→</span>
				{/if}
				{hud.quality ?? '-'}
				{#if hud.qualitySource === 'mod'}
					(mod{#if hud.modFacing === 'cam'}, palm cam{/if}{#if hud.modFacing === 'away'}, palm away{/if})
				{:else if hud.qualitySource === 'triad'}
					(triad)
				{/if}
			</p>
			<p>
				<span class="label">Bass</span>
				{#if hud.bassMode && hud.bassActive && hud.notes}
					on (−8ve)
				{:else if hud.bassActive && !hud.bassMode}
					on (−8ve, off next chord)
				{:else if hud.bassMode}
					on (ready)
				{:else}
					off
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
				{#if hud.isSettling}
					<span class="settle-bar" title="Pose settling…">
						<span class="settle-fill" style:width="{Math.round(hud.settleProgress * 100)}%"></span>
					</span>
				{/if}
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
					{#each SCALE_DEFS as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</label>

			<label>
				Render
				<select value={renderMode} onchange={onRenderModeChange}>
					{#each RENDER_MODES as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</label>

			<button type="button" onclick={() => (showVideo = !showVideo)}>
				{showVideo ? 'Hide video' : 'Show video'}
			</button>

			<button type="button" onclick={onToggleHands}>
				{showHands ? 'Hide hands' : 'Show hands'}
			</button>

			{#if isBoidsMode}
				<button type="button" onclick={() => (showBoidsPanel = !showBoidsPanel)}>
					{showBoidsPanel ? 'Hide boids' : 'Boids controls'}
				</button>
			{/if}

			{#if !audioReady}
				<button type="button" class="sound-btn" onclick={onEnableSound}>
					Enable sound
				</button>
			{:else}
				<span class="sound-ok" title="Audio is ready">Sound on</span>
			{/if}
		</div>

		{#if isBoidsMode && showBoidsPanel}
			<div class="boids-panel">
				<div class="boids-panel-head">
					<strong>Boids</strong>
					<button type="button" onclick={onResetBoidsParams}>Reset defaults</button>
				</div>

				<details class="boids-acc" open>
					<summary>Presets</summary>
					<label class="select-row">
						Built-in
						<select
							value={boidsBuiltInSelected}
							onchange={(e) => {
								boidsBuiltInSelected = (e.currentTarget as HTMLSelectElement)
									.value as BoidsProfileId | '';
							}}
						>
							{#each BOIDS_PROFILES as profile (profile.id)}
								<option value={profile.id}>{profile.label}</option>
							{/each}
						</select>
					</label>
					<button type="button" class="full-btn" onclick={onLoadBuiltInProfile}>
						Load built-in
					</button>
					{#if boidsBuiltInSelected}
						{@const note = BOIDS_PROFILES.find((p) => p.id === boidsBuiltInSelected)?.note}
						{#if note}
							<p class="preset-status">{note}</p>
						{/if}
					{/if}
					<label class="select-row">
						Saved
						<select
							value={boidsPresetSelected}
							onchange={(e) => {
								boidsPresetSelected = (e.currentTarget as HTMLSelectElement).value;
								if (boidsPresetSelected) boidsPresetName = boidsPresetSelected;
							}}
						>
							<option value="">— select —</option>
							{#each boidsPresetList as name (name)}
								<option value={name}>{name}</option>
							{/each}
						</select>
					</label>
					<label class="name-row">
						Name
						<input
							type="text"
							placeholder="my preset"
							value={boidsPresetName}
							oninput={(e) => {
								boidsPresetName = (e.currentTarget as HTMLInputElement).value;
							}}
						/>
					</label>
					<div class="preset-actions">
						<button type="button" onclick={onSaveBoidsPreset}>Save</button>
						<button type="button" onclick={onLoadBoidsPreset}>Load</button>
						<button type="button" onclick={onDeleteBoidsPreset}>Delete</button>
					</div>
					{#if boidsPresetStatus}
						<p class="preset-status">{boidsPresetStatus}</p>
					{/if}
				</details>

				<details class="boids-acc">
					<summary>Debug</summary>
					<label>
						Boid count
						<input
							type="range"
							min={MIN_BOID_COUNT}
							max={MAX_BOID_COUNT}
							step={isGpuHost ? 500 : 100}
							value={bp.boidCount}
							oninput={(e) => onBoidsNumber('boidCount', e)}
						/>
						<span>{bp.boidCount.toLocaleString()}</span>
					</label>
					<p class="section-note">Changing count re-seeds the flock.</p>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.showCounts}
							onchange={() => onBoidsToggle('showCounts')}
						/>
						Show color counts
					</label>
				</details>

				<details class="boids-acc">
					<summary>Wind</summary>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.windEnabled}
							onchange={() => onBoidsToggle('windEnabled')}
						/>
						Enable wind
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.showWindField}
							onchange={() => onBoidsToggle('showWindField')}
						/>
						Show wind field
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.windAffectsLit}
							onchange={() => onBoidsToggle('windAffectsLit')}
						/>
						Affects lit boids
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.windAffectsDead}
							onchange={() => onBoidsToggle('windAffectsDead')}
						/>
						Affects dead boids
					</label>
					<label>
						Force
						<input
							type="range"
							min="0"
							max="5"
							step="0.05"
							value={bp.windForce}
							oninput={(e) => onBoidsNumber('windForce', e)}
						/>
						<span>{bp.windForce.toFixed(2)}</span>
					</label>
					<label>
						Idle force
						<input
							type="range"
							min="0"
							max="5"
							step="0.05"
							value={bp.windForceIdle}
							oninput={(e) => onBoidsNumber('windForceIdle', e)}
						/>
						<span>{bp.windForceIdle.toFixed(2)}</span>
					</label>
					<label>
						Spatial
						<input
							type="range"
							min="0.4"
							max="8"
							step="0.1"
							value={bp.windSpatial}
							oninput={(e) => onBoidsNumber('windSpatial', e)}
						/>
						<span>{bp.windSpatial.toFixed(1)}</span>
					</label>
					<label>
						Time
						<input
							type="range"
							min="0"
							max="0.0008"
							step="0.00001"
							value={bp.windTime}
							oninput={(e) => onBoidsNumber('windTime', e)}
						/>
						<span>{bp.windTime.toFixed(5)}</span>
					</label>
					<label>
						Angle turns
						<input
							type="range"
							min="0.5"
							max="4"
							step="0.1"
							value={bp.windAngleTurns}
							oninput={(e) => onBoidsNumber('windAngleTurns', e)}
						/>
						<span>{bp.windAngleTurns.toFixed(1)}</span>
					</label>
					<label>
						Field step
						<input
							type="range"
							min="24"
							max="96"
							step="4"
							value={bp.windFieldStep}
							oninput={(e) => onBoidsNumber('windFieldStep', e)}
						/>
						<span>{bp.windFieldStep}</span>
					</label>
					<label>
						Arrow size
						<input
							type="range"
							min="8"
							max="40"
							step="1"
							value={bp.windFieldScale}
							oninput={(e) => onBoidsNumber('windFieldScale', e)}
						/>
						<span>{bp.windFieldScale}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Center bias</summary>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.centerBiasEnabled}
							onchange={() => onBoidsToggle('centerBiasEnabled')}
						/>
						Pull toward center
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.centerBiasAffectsLit}
							onchange={() => onBoidsToggle('centerBiasAffectsLit')}
						/>
						Affects lit boids
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={bp.centerBiasAffectsDead}
							onchange={() => onBoidsToggle('centerBiasAffectsDead')}
						/>
						Affects dead boids
					</label>
					<label>
						Strength
						<input
							type="range"
							min="0"
							max="1.5"
							step="0.01"
							value={bp.centerBiasStrength}
							oninput={(e) => onBoidsNumber('centerBiasStrength', e)}
						/>
						<span>{bp.centerBiasStrength.toFixed(2)}</span>
					</label>
					<label class="select-row">
						Falloff
						<select
							value={bp.centerBiasFalloffMode}
							onchange={onBoidsFalloffMode}
						>
							<option value="linear">Linear</option>
							<option value="quadratic">Quadratic</option>
						</select>
					</label>
					<label>
						Falloff exp
						<input
							type="range"
							min="0.4"
							max="3"
							step="0.05"
							value={bp.centerBiasFalloff}
							oninput={(e) => onBoidsNumber('centerBiasFalloff', e)}
						/>
						<span>{bp.centerBiasFalloff.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc" open>
					<summary>Dead ↔ dead</summary>
					<p class="section-note">Unlit pairs: repel, flock, and blank steering/speed.</p>
					<h4 class="subsection">Repulsion</h4>
					<label>
						Repel force
						<input
							type="range"
							min="0"
							max="0.8"
							step="0.01"
							value={bp.blankRepel}
							oninput={(e) => onBoidsNumber('blankRepel', e)}
						/>
						<span>{bp.blankRepel.toFixed(2)}</span>
					</label>
					<label>
						Repel radius
						<input
							type="range"
							min="24"
							max="180"
							step="2"
							value={bp.blankRepelRadius}
							oninput={(e) => onBoidsNumber('blankRepelRadius', e)}
						/>
						<span>{bp.blankRepelRadius}</span>
					</label>
					<label>
						Dead↔dead weight
						<input
							type="range"
							min="0.5"
							max="12"
							step="0.25"
							value={bp.blankBlankRepelWeight}
							oninput={(e) => onBoidsNumber('blankBlankRepelWeight', e)}
						/>
						<span>{bp.blankBlankRepelWeight.toFixed(1)}</span>
					</label>
					<label>
						Near-quota boost
						<input
							type="range"
							min="1"
							max="3"
							step="0.05"
							value={bp.blankRepelNearMaxBoost}
							oninput={(e) => onBoidsNumber('blankRepelNearMaxBoost', e)}
						/>
						<span>{bp.blankRepelNearMaxBoost.toFixed(2)}</span>
					</label>
					<h4 class="subsection">Flocking</h4>
					<label>
						Alignment mul
						<input
							type="range"
							min="0"
							max="1.5"
							step="0.02"
							value={bf.blank.blankBlankAliMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.blank.blankBlankAliMul = v;
								}, e)}
						/>
						<span>{bf.blank.blankBlankAliMul.toFixed(2)}</span>
					</label>
					<label>
						Cohesion mul
						<input
							type="range"
							min="0"
							max="0.5"
							step="0.01"
							value={bf.blank.blankBlankCohMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.blank.blankBlankCohMul = v;
								}, e)}
						/>
						<span>{bf.blank.blankBlankCohMul.toFixed(2)}</span>
					</label>
					<label>
						Separation mul
						<input
							type="range"
							min="0.2"
							max="2"
							step="0.02"
							value={bf.blank.sepIdleMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.blank.sepIdleMul = v;
								}, e)}
						/>
						<span>{bf.blank.sepIdleMul.toFixed(2)}</span>
					</label>
					<label>
						Base separation
						<input
							type="range"
							min="0.5"
							max="4"
							step="0.05"
							value={bf.separation.idle}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.idle = v;
								}, e)}
						/>
						<span>{bf.separation.idle.toFixed(2)}</span>
					</label>
					<label>
						Sep radius
						<input
							type="range"
							min="20"
							max="120"
							step="2"
							value={bf.separation.radiusIdle}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.radiusIdle = v;
								}, e)}
						/>
						<span>{bf.separation.radiusIdle}</span>
					</label>
					<h4 class="subsection">Steering &amp; speed</h4>
					<label>
						Force budget mul
						<input
							type="range"
							min="0.1"
							max="0.8"
							step="0.02"
							value={bf.blank.forceMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.blank.forceMul = v;
								}, e)}
						/>
						<span>{bf.blank.forceMul.toFixed(2)}</span>
					</label>
					<label>
						Max force
						<input
							type="range"
							min="0.08"
							max="0.6"
							step="0.01"
							value={bf.maxForceIdle}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.maxForceIdle = v;
								}, e)}
						/>
						<span>{bf.maxForceIdle.toFixed(2)}</span>
					</label>
					<label>
						Global force cap
						<input
							type="range"
							min="0.3"
							max="1.5"
							step="0.02"
							value={bf.steering.globalForceCapBlank}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.steering.globalForceCapBlank = v;
								}, e)}
						/>
						<span>{bf.steering.globalForceCapBlank.toFixed(2)}</span>
					</label>
					<label>
						Steering smooth
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							value={bf.steering.steeringSmoothBlank}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.steering.steeringSmoothBlank = v;
								}, e)}
						/>
						<span>{bf.steering.steeringSmoothBlank.toFixed(2)}</span>
					</label>
					<label>
						Max speed
						<input
							type="range"
							min="0"
							max="4"
							step="0.05"
							value={bp.maxSpeedIdle}
							oninput={(e) => onBoidsNumber('maxSpeedIdle', e)}
						/>
						<span>{bp.maxSpeedIdle.toFixed(2)}</span>
					</label>
					<label>
						Speed drag
						<input
							type="range"
							min="0"
							max="3"
							step="0.05"
							value={bp.speedDrag}
							oninput={(e) => onBoidsNumber('speedDrag', e)}
						/>
						<span>{bp.speedDrag.toFixed(2)}</span>
					</label>
					<label>
						Min speed
						<input
							type="range"
							min="0"
							max="2"
							step="0.05"
							value={bp.minSpeedIdle}
							oninput={(e) => onBoidsNumber('minSpeedIdle', e)}
						/>
						<span>{bp.minSpeedIdle.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Dead ↔ lit</summary>
					<p class="section-note">
						Hunt / seek across lanes. Dead→lit separation is off so blanks aren't shoved to the edges.
					</p>
					<label>
						Hunt radius
						<input
							type="range"
							min="40"
							max="260"
							step="2"
							value={bp.huntRadius}
							oninput={(e) => onBoidsNumber('huntRadius', e)}
						/>
						<span>{bp.huntRadius}</span>
					</label>
					<label>
						Hunt blanks
						<input
							type="range"
							min="0"
							max="1.5"
							step="0.01"
							value={bp.huntBlankAttract}
							oninput={(e) => onBoidsNumber('huntBlankAttract', e)}
						/>
						<span>{bp.huntBlankAttract.toFixed(2)}</span>
					</label>
					<label>
						Hunt colors
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={bp.huntColorAttract}
							oninput={(e) => onBoidsNumber('huntColorAttract', e)}
						/>
						<span>{bp.huntColorAttract.toFixed(2)}</span>
					</label>
					<label>
						Blank seek
						<input
							type="range"
							min="0"
							max="1.2"
							step="0.01"
							value={bp.blankSeekAttract}
							oninput={(e) => onBoidsNumber('blankSeekAttract', e)}
						/>
						<span>{bp.blankSeekAttract.toFixed(2)}</span>
					</label>
					<label>
						Hunt below
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							value={bp.huntBelowFrac}
							oninput={(e) => onBoidsNumber('huntBelowFrac', e)}
						/>
						<span>{bp.huntBelowFrac.toFixed(2)}</span>
					</label>
					<label>
						Prey above
						<input
							type="range"
							min="0.1"
							max="1"
							step="0.01"
							value={bp.preyAboveFrac}
							oninput={(e) => onBoidsNumber('preyAboveFrac', e)}
						/>
						<span>{bp.preyAboveFrac.toFixed(2)}</span>
					</label>
					<label>
						Lit←blank sep mul
						<input
							type="range"
							min="0"
							max="1.5"
							step="0.02"
							value={bf.separation.assignedIdleMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.assignedIdleMul = v;
								}, e)}
						/>
						<span>{bf.separation.assignedIdleMul.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc" open>
					<summary>Lit ↔ same</summary>
					<p class="section-note">Same-note ribbons: alignment, cohesion, spacing, lit steering/speed.</p>
					<h4 class="subsection">Shared base</h4>
					<label>
						Base alignment
						<input
							type="range"
							min="0.5"
							max="4"
							step="0.05"
							value={bf.alignment}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.alignment = v;
								}, e)}
						/>
						<span>{bf.alignment.toFixed(2)}</span>
					</label>
					<label>
						Base cohesion
						<input
							type="range"
							min="0"
							max="2"
							step="0.02"
							value={bf.cohesion}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.cohesion = v;
								}, e)}
						/>
						<span>{bf.cohesion.toFixed(2)}</span>
					</label>
					<label>
						Align radius
						<input
							type="range"
							min="20"
							max="150"
							step="2"
							value={bf.aliRadius}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.aliRadius = v;
								}, e)}
						/>
						<span>{bf.aliRadius}</span>
					</label>
					<label>
						Cohesion radius
						<input
							type="range"
							min="20"
							max="120"
							step="2"
							value={bf.cohRadius}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.cohRadius = v;
								}, e)}
						/>
						<span>{bf.cohRadius}</span>
					</label>
					<h4 class="subsection">Lit flocking</h4>
					<label>
						Alignment mul
						<input
							type="range"
							min="0.4"
							max="3"
							step="0.02"
							value={bf.assigned.aliMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.assigned.aliMul = v;
								}, e)}
						/>
						<span>{bf.assigned.aliMul.toFixed(2)}</span>
					</label>
					<label>
						Cohesion mul
						<input
							type="range"
							min="0.2"
							max="2.5"
							step="0.02"
							value={bf.assigned.cohMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.assigned.cohMul = v;
								}, e)}
						/>
						<span>{bf.assigned.cohMul.toFixed(2)}</span>
					</label>
					<label>
						Same sep weight
						<input
							type="range"
							min="0.1"
							max="2"
							step="0.02"
							value={bf.separation.same}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.same = v;
								}, e)}
						/>
						<span>{bf.separation.same.toFixed(2)}</span>
					</label>
					<label>
						Same sep mul
						<input
							type="range"
							min="0.2"
							max="2"
							step="0.02"
							value={bf.separation.assignedSameMul}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.assignedSameMul = v;
								}, e)}
						/>
						<span>{bf.separation.assignedSameMul.toFixed(2)}</span>
					</label>
					<label>
						Same sep radius
						<input
							type="range"
							min="10"
							max="80"
							step="1"
							value={bf.separation.radiusSame}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.radiusSame = v;
								}, e)}
						/>
						<span>{bf.separation.radiusSame}</span>
					</label>
					<h4 class="subsection">Steering &amp; speed</h4>
					<label>
						Max force
						<input
							type="range"
							min="0.05"
							max="0.6"
							step="0.01"
							value={bf.assigned.maxForce}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.assigned.maxForce = v;
								}, e)}
						/>
						<span>{bf.assigned.maxForce.toFixed(2)}</span>
					</label>
					<label>
						Global force cap
						<input
							type="range"
							min="0.3"
							max="2"
							step="0.02"
							value={bf.steering.globalForceCapLit}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.steering.globalForceCapLit = v;
								}, e)}
						/>
						<span>{bf.steering.globalForceCapLit.toFixed(2)}</span>
					</label>
					<label>
						Steering smooth
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							value={bf.steering.steeringSmoothPlaying}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.steering.steeringSmoothPlaying = v;
								}, e)}
						/>
						<span>{bf.steering.steeringSmoothPlaying.toFixed(2)}</span>
					</label>
					<label>
						Max speed
						<input
							type="range"
							min="0.1"
							max="10"
							step="0.05"
							value={bp.maxSpeedAssigned}
							oninput={(e) => onBoidsNumber('maxSpeedAssigned', e)}
						/>
						<span>{bp.maxSpeedAssigned.toFixed(2)}</span>
					</label>
					<label>
						Speed drag
						<input
							type="range"
							min="0"
							max="3"
							step="0.05"
							value={bp.speedDrag}
							oninput={(e) => onBoidsNumber('speedDrag', e)}
						/>
						<span>{bp.speedDrag.toFixed(2)}</span>
					</label>
					<label>
						Min speed
						<input
							type="range"
							min="0"
							max="3"
							step="0.05"
							value={bf.assigned.minSpeed}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.assigned.minSpeed = v;
								}, e)}
						/>
						<span>{bf.assigned.minSpeed.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Lit ↔ different</summary>
					<p class="section-note">
						Cross-color barriers apply after wind/center so colors won't collapse together.
					</p>
					<label>
						Diff sep weight
						<input
							type="range"
							min="0.5"
							max="8"
							step="0.05"
							value={bf.separation.diff}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.diff = v;
								}, e)}
						/>
						<span>{bf.separation.diff.toFixed(2)}</span>
					</label>
					<label>
						Lane keep (angle)
						<input
							type="range"
							min="0"
							max="2.5"
							step="0.05"
							value={bf.separation.diffLateral}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.diffLateral = v;
								}, e)}
						/>
						<span>{bf.separation.diffLateral.toFixed(2)}</span>
					</label>
					<label>
						Diff sep radius
						<input
							type="range"
							min="20"
							max="120"
							step="1"
							value={bf.separation.radiusDiff}
							oninput={(e) =>
								onFlockRange((f, v) => {
									f.separation.radiusDiff = v;
								}, e)}
						/>
						<span>{bf.separation.radiusDiff}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Infection</summary>
					<label>
						Interval
						<input
							type="range"
							min="1"
							max="30"
							step="1"
							value={bp.infectIntervalFrames}
							oninput={(e) => onBoidsNumber('infectIntervalFrames', e)}
						/>
						<span>{bp.infectIntervalFrames}</span>
					</label>
					<label>
						Radius
						<input
							type="range"
							min="8"
							max="80"
							step="1"
							value={bp.infectRadius}
							oninput={(e) => onBoidsNumber('infectRadius', e)}
						/>
						<span>{bp.infectRadius}</span>
					</label>
					<label>
						Max / color / tick
						<input
							type="range"
							min="1"
							max="24"
							step="1"
							value={bp.infectMaxPerColor}
							oninput={(e) => onBoidsNumber('infectMaxPerColor', e)}
						/>
						<span>{bp.infectMaxPerColor}</span>
					</label>
					<label>
						Spontaneous below
						<input
							type="range"
							min="0.05"
							max="0.8"
							step="0.01"
							value={bp.spontaneousInfectThreshold}
							oninput={(e) => onBoidsNumber('spontaneousInfectThreshold', e)}
						/>
						<span>{(bp.spontaneousInfectThreshold * 100).toFixed(0)}% quota</span>
					</label>
					<label>
						Spontaneous chance
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={bp.spontaneousInfectChance}
							oninput={(e) => onBoidsNumber('spontaneousInfectChance', e)}
						/>
						<span>{bp.spontaneousInfectChance.toFixed(2)}</span>
					</label>
					<label>
						Steal below
						<input
							type="range"
							min="0.1"
							max="1"
							step="0.01"
							value={bp.stealBelowFrac}
							oninput={(e) => onBoidsNumber('stealBelowFrac', e)}
						/>
						<span>{bp.stealBelowFrac.toFixed(2)}</span>
					</label>
					<label>
						Near max
						<input
							type="range"
							min="0"
							max="0.25"
							step="0.01"
							value={bp.nearMaxFrac}
							oninput={(e) => onBoidsNumber('nearMaxFrac', e)}
						/>
						<span>{bp.nearMaxFrac.toFixed(2)}</span>
					</label>
					<label>
						Min hold
						<input
							type="range"
							min="0.05"
							max="0.5"
							step="0.01"
							value={bp.minHoldFrac}
							oninput={(e) => onBoidsNumber('minHoldFrac', e)}
						/>
						<span>{bp.minHoldFrac.toFixed(2)}</span>
					</label>
					<label>
						Exchange every
						<input
							type="range"
							min="10"
							max="120"
							step="1"
							value={bp.exchangeIntervalFrames}
							oninput={(e) => onBoidsNumber('exchangeIntervalFrames', e)}
						/>
						<span>{bp.exchangeIntervalFrames}</span>
					</label>
					<label>
						Exchange chance
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={bp.exchangeChance}
							oninput={(e) => onBoidsNumber('exchangeChance', e)}
						/>
						<span>{bp.exchangeChance.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Chord pulse</summary>
					<label>
						Duration ms
						<input
							type="range"
							min="0"
							max="1200"
							step="20"
							value={bp.chordRepelMs}
							oninput={(e) => onBoidsNumber('chordRepelMs', e)}
						/>
						<span>{bp.chordRepelMs}</span>
					</label>
					<label>
						Center force
						<input
							type="range"
							min="0"
							max="3"
							step="0.05"
							value={bp.chordRepelForce}
							oninput={(e) => onBoidsNumber('chordRepelForce', e)}
						/>
						<span>{bp.chordRepelForce.toFixed(2)}</span>
					</label>
					<label>
						Sep force
						<input
							type="range"
							min="0"
							max="2"
							step="0.05"
							value={bp.chordRepelSep}
							oninput={(e) => onBoidsNumber('chordRepelSep', e)}
						/>
						<span>{bp.chordRepelSep.toFixed(2)}</span>
					</label>
					<label>
						Sep radius
						<input
							type="range"
							min="10"
							max="120"
							step="1"
							value={bp.chordRepelSepRadius}
							oninput={(e) => onBoidsNumber('chordRepelSepRadius', e)}
						/>
						<span>{bp.chordRepelSepRadius}</span>
					</label>
					<label>
						Speed boost
						<input
							type="range"
							min="1"
							max="2.5"
							step="0.05"
							value={bp.chordRepelSpeedBoost}
							oninput={(e) => onBoidsNumber('chordRepelSpeedBoost', e)}
						/>
						<span>{bp.chordRepelSpeedBoost.toFixed(2)}</span>
					</label>
				</details>

				<details class="boids-acc">
					<summary>Glow</summary>
					<label>
						Point size
						<input
							type="range"
							min="0.3"
							max="4"
							step="0.05"
							value={bp.glowPointSize}
							oninput={(e) => onBoidsNumber('glowPointSize', e)}
						/>
						<span>{bp.glowPointSize.toFixed(2)}</span>
					</label>
					<label>
						Speed → size
						<input
							type="range"
							min="0"
							max="1"
							step="0.02"
							value={bp.glowSpeedSize}
							oninput={(e) => onBoidsNumber('glowSpeedSize', e)}
						/>
						<span>{bp.glowSpeedSize.toFixed(2)}</span>
					</label>
					<label>
						Fade rate
						<input
							type="range"
							min="0.005"
							max="0.06"
							step="0.001"
							value={bp.litFadeRate}
							oninput={(e) => onBoidsNumber('litFadeRate', e)}
						/>
						<span>{bp.litFadeRate.toFixed(3)}</span>
					</label>
					<label>
						Rise rate
						<input
							type="range"
							min="0.01"
							max="0.12"
							step="0.001"
							value={bp.litRiseRate}
							oninput={(e) => onBoidsNumber('litRiseRate', e)}
						/>
						<span>{bp.litRiseRate.toFixed(3)}</span>
					</label>
					<label>
						Idle alpha
						<input
							type="range"
							min="0.04"
							max="0.4"
							step="0.01"
							value={bp.idleAlphaBase}
							oninput={(e) => onBoidsNumber('idleAlphaBase', e)}
						/>
						<span>{bp.idleAlphaBase.toFixed(2)}</span>
					</label>
					<label>
						Idle pulse
						<input
							type="range"
							min="0"
							max="0.4"
							step="0.01"
							value={bp.idleAlphaPulse}
							oninput={(e) => onBoidsNumber('idleAlphaPulse', e)}
						/>
						<span>{bp.idleAlphaPulse.toFixed(2)}</span>
					</label>
				</details>

			</div>
		{/if}

		{#if !audioReady && !loadError}
			<button type="button" class="audio-prompt" onclick={onEnableSound}>
				<span class="audio-prompt-dot" aria-hidden="true"></span>
				Tap to enable sound
			</button>
		{/if}

		{#if loadError}
			<p class="error">{loadError}</p>
		{/if}
	</div>
</div>

<style>
	.instrument {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #0a0c0d;
		color: #e8ecef;
		font-family: system-ui, sans-serif;
		isolation: isolate;
	}

	.canvas-host {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.canvas-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
	}

	.hidden-host {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 1;
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
		pointer-events: auto;
	}

	.hud p {
		margin: 0 0 6px;
	}

	.hud p:last-child {
		margin-bottom: 0;
	}

	.how-to {
		margin: 0 0 10px;
		padding-bottom: 8px;
		border-bottom: 1px solid rgb(255 255 255 / 10%);
	}

	.how-to > summary {
		cursor: pointer;
		color: #c5ced4;
		font-weight: 600;
		list-style: none;
		user-select: none;
	}

	.how-to > summary::-webkit-details-marker {
		display: none;
	}

	.how-to > summary::before {
		content: '▸';
		display: inline-block;
		margin-right: 6px;
		color: #8a9399;
		transition: transform 0.12s ease;
	}

	.how-to[open] > summary::before {
		transform: rotate(90deg);
	}

	.how-to-body {
		margin-top: 8px;
		font-size: 13px;
		color: #b8c0c6;
	}

	.how-to-body p {
		margin: 0 0 8px;
	}

	.how-to-body p:last-child {
		margin-bottom: 0;
	}

	.how-to-body strong {
		color: #e8eef2;
		font-weight: 600;
	}

	.label {
		color: #8a9399;
		margin-right: 6px;
	}

	.label + .label {
		margin-left: 12px;
	}

	.preview {
		color: #94d0a8;
		font-weight: 600;
	}

	.preview-arrow {
		color: #6a757c;
		margin: 0 4px;
	}

	.settle-bar {
		display: inline-block;
		vertical-align: middle;
		width: 48px;
		height: 4px;
		margin-left: 8px;
		background: rgb(255 255 255 / 12%);
		border-radius: 999px;
		overflow: hidden;
	}

	.settle-fill {
		display: block;
		height: 100%;
		background: #94d0a8;
		border-radius: 999px;
		transition: width 0.05s linear;
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

	.boids-panel {
		position: absolute;
		top: 72px;
		right: 16px;
		width: min(320px, calc(100vw - 32px));
		max-height: calc(100vh - 96px);
		overflow: auto;
		padding: 12px 14px 16px;
		background: rgb(10 12 13 / 88%);
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 8px;
		backdrop-filter: blur(8px);
		pointer-events: auto;
		font-size: 13px;
		line-height: 1.4;
	}

	.boids-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		gap: 8px;
	}

	.boids-panel .preset-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 8px;
	}

	.boids-panel .full-btn {
		width: 100%;
		margin: 6px 0 4px;
	}

	.boids-panel .preset-status {
		margin: 6px 0 0;
		font-size: 12px;
		color: #94d0a8;
	}

	.boids-panel label.name-row {
		grid-template-columns: 88px 1fr;
	}

	.boids-panel input[type='text'] {
		background: #15191c;
		color: #e8ecef;
		border: 1px solid #2a3238;
		padding: 4px 8px;
		border-radius: 4px;
		font: inherit;
		width: 100%;
	}

	.boids-panel details.boids-acc {
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid rgb(255 255 255 / 8%);
	}

	.boids-panel details.boids-acc > summary {
		cursor: pointer;
		list-style: none;
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #8a9399;
		user-select: none;
	}

	.boids-panel details.boids-acc > summary::-webkit-details-marker {
		display: none;
	}

	.boids-panel details.boids-acc > summary::before {
		content: '▸';
		display: inline-block;
		width: 1em;
		margin-right: 4px;
		color: #6e7a80;
		transition: transform 0.12s ease;
	}

	.boids-panel details.boids-acc[open] > summary::before {
		transform: rotate(90deg);
	}

	.boids-panel h4.subsection {
		margin: 10px 0 4px;
		grid-column: 1 / -1;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #6e7a80;
	}

	.boids-panel .section-note {
		grid-column: 1 / -1;
		margin: 0 0 6px;
		font-size: 11px;
		line-height: 1.35;
		color: #6e7a80;
	}

	.boids-panel label {
		display: grid;
		grid-template-columns: 88px 1fr 40px;
		gap: 8px;
		align-items: center;
		margin: 0 0 6px;
	}

	.boids-panel label.check {
		display: flex;
		gap: 8px;
		grid-template-columns: none;
	}

	.boids-panel label.select-row {
		grid-template-columns: 88px 1fr;
	}

	.boids-panel select {
		background: #15191c;
		color: #e8ecef;
		border: 1px solid #2a3238;
		padding: 4px 8px;
		border-radius: 4px;
		font: inherit;
	}

	.boids-panel label span {
		font-variant-numeric: tabular-nums;
		color: #a8b0b6;
		text-align: right;
	}

	.boids-panel input[type='range'] {
		width: 100%;
	}

	.boids-panel button {
		background: #15191c;
		color: #e8ecef;
		border: 1px solid #2a3238;
		padding: 3px 8px;
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
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

	.sound-btn {
		border-color: #f0a848 !important;
		color: #f0a848 !important;
	}

	.sound-ok {
		font-size: 13px;
		color: #94d0a8;
	}

	.audio-prompt {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		background: rgb(10 12 13 / 90%);
		border: 1px solid rgb(240 168 72 / 55%);
		border-radius: 999px;
		backdrop-filter: blur(6px);
		font-size: 15px;
		color: #e8ecef;
		white-space: nowrap;
		pointer-events: auto;
		cursor: pointer;
		font: inherit;
	}

	.audio-prompt-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #f0a848;
		box-shadow: 0 0 0 0 rgb(240 168 72 / 60%);
		animation: audio-prompt-pulse 1.6s ease-out infinite;
	}

	@keyframes audio-prompt-pulse {
		0% {
			box-shadow: 0 0 0 0 rgb(240 168 72 / 55%);
		}
		70% {
			box-shadow: 0 0 0 9px rgb(240 168 72 / 0%);
		}
		100% {
			box-shadow: 0 0 0 0 rgb(240 168 72 / 0%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.audio-prompt-dot {
			animation: none;
		}
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
