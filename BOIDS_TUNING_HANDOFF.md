# Boids sim tuning — agent handoff

Use this doc to plan and implement **dynamic, murmuration-quality defaults** for the p5-playground boids instrument. Read this first; then skim the linked files.

## Product goal

Hand-tracked chord instrument. Two visual modes share the same music/session layer:

| Route | Sim | Count | Notes |
| --- | --- | --- | --- |
| `/boids` | CPU | ~900 | Reference / lighter |
| `/gpu/boids` | WebGPU + WebGL glow | **20_000** | Primary tuning target |

**Desired motion (in priority order for next pass):**

1. **Dead / blank boids** — spread-out, flowing murmurations (not jittery clumps, not grid-aligned blobs).
2. **Lit / colored boids** — faster, tighter same-note flocks; proximity infection should read clearly (not only spontaneous spawn).
3. **Overall** — less jitter, more “ribbon / cloud” flow. Vector field (wind + center) is **off** in current default; re-enable later as an optional profile.

Run dev server: `npm run dev` → `http://localhost:5173/gpu/boids` (webcam optional; mouse works for chord gestures after audio unlock).

---

## Architecture (hybrid GPU)

```
Hands → session → harmony → VoicingChange
         ↓
WebGPU flocking (20k)     ← forces, movement, spatial hash
         ↓ readback/frame
CPU packedBoidLife        ← lit/decay, assignTargets on voicing
CPU gpuBoidsEvents        ← proximity infection, exchange
WebGL instanced glow      ← render only
Overlay                   ← wind-field debug arrows (if enabled)
```

**Important:** Flocking runs on GPU; **lifecycle** (ignite, decay, infection, voicing assignment) runs on CPU after GPU readback. CPU and GPU flock math must stay in parity where they overlap.

### Key files

| Area | Path |
| --- | --- |
| **Active default params** | `src/lib/sketch/renderers/boidsProfiles.ts` → `ACTIVE_BOIDS_PROFILE_ID` |
| **Runtime tunables (UI)** | `src/lib/sketch/renderers/boidsParams.ts` |
| **Built-in profiles** | `src/lib/sketch/renderers/boidsProfiles.ts` |
| **Flock constants (CPU + partial GPU source)** | `src/lib/boids/flockSeparation.ts` |
| **CPU engine** | `src/lib/boids/engine.ts` |
| **GPU WGSL sim** | `src/lib/gpu/compute/flocking.wgsl.ts` |
| **GPU orchestration** | `src/lib/gpu/compute/webgpuBoidsEngine.ts` |
| **Infection (CPU)** | `src/lib/gpu/compute/gpuBoidsEvents.ts` |
| **Spatial hash / grid** | `src/lib/boids/spatialHash.ts`, `src/lib/gpu/compute/gpuGrid.ts` |
| **Field overlay math** | `src/lib/boids/fieldSample.ts` |
| **UI panel** | `src/lib/components/HandInstrument.svelte` |
| **Conversion ping rate limit** | `src/lib/instrument/player/adapters/p5/constants.ts`, `dronePlayer.ts` |

---

## Configuration system (current)

### 1. Code defaults (always on fresh load)

- `DEFAULT_BOIDS_PARAMS` = snapshot of `ACTIVE_BOIDS_PROFILE_ID` (`active-murmur-v1`) in `boidsProfiles.ts`.
- Profiles bundle **params + flock preset** (`FlockPreset` in `flockSeparation.ts`). Load built-in / Reset applies both.
- **Dynamic tuning** (`boidsDynamic.ts`) scales hunt/infect/radii from lit ratio and quota fill on threshold crossings.
- **No auto-restore of “last session” params** — removed intentionally. Every mount starts from code defaults.
- **Reset defaults** in UI reloads the active built-in profile.

### 2. Built-in profiles (hardcoded, versioned)

In `boidsProfiles.ts`:

| ID | Label | Purpose |
| --- | --- | --- |
| `active-murmur-v1` | Active murmur v1 | **Active default.** Combined dead + lit ribbon tuning; global force cap; carrier-aligned infection boost. |
| `lit-murmur-v1` | Lit murmur v1 | Experiment: tighter same-note flocks, higher alignment. |
| `dead-murmur-v1` | Dead murmur v1 | Archive: dead-first pass before lit ribbon tuning. |
| `field-chase-v1` | Field chase v1 | Archive: wind + center on, fast infect, prior default. |

UI: Boids panel → **Built-in** dropdown → **Load built-in**.

**Gap:** Profile snapshots only cover `BoidsParams`. Flock behavior also depends on **`flockSeparation.ts` constants** and **duplicated literals in `flocking.wgsl.ts`**. Restoring `field-chase-v1` fully may require matching WGSL/TS flock constants — see “Technical debt” below.

### 3. User presets (localStorage)

- Save / Load / Delete named presets still work (`p5-playground:boidsParams:saved`).
- Useful for capturing good tunings during experiments; not loaded automatically on startup.

---

## Current default snapshot (`dead-murmur-v1`)

**Params highlights:**

- `windEnabled: false`, `centerBiasEnabled: false`
- Idle speed band: `minSpeedIdle: 1.35`, `maxSpeedIdle: 2.2` (narrow → less thrash)
- Soft blank spacing: lower `blankRepel`, wider `blankRepelRadius`, low `blankBlankRepelWeight`
- Lit still fast: `maxSpeedAssigned: 6.8`
- Infection aggressive: every frame, radius 78, max 16/color/tick

**Flock constants (`FLOCK_BLANK` for dead↔dead):**

- `blankBlankAliMul: 0.72`, `blankBlankCohMul: 0.28`
- `forceMul: 0.32`, `sepIdleMul: 0.55`

Lit boids: same-note only alignment/cohesion; blanks flock with each other but not with lit.

---

## Known issues & recent fixes

1. **Jitter / chaos** — User reports boids still too jittery globally. Likely causes: high forces, min-speed floors, chord repel pulses, infection velocity boosts, spatial-hash artifacts (partially addressed).
2. **Grid clumping** — Fixed via dynamic GPU cell size, random slot replacement when cells overflow, rotated neighbor sampling (`gpuGrid.ts`, `flocking.wgsl.ts`).
3. **Proximity infection broken** — Fixed infection grid query using wrong cell size (hardcoded 64 vs build size). Spontaneous spawn was masking the bug.
4. **WGSL `let` immutability** — Several shader bugs from reassigning `let`; use separate bindings or `select()`.
5. **Wind/field for dead boids** — Field force cap was too low when field was enabled; separate field force budget added. Currently field disabled in default profile anyway.
6. **Audio spam** — Conversion pings capped: 3/frame, 7/sec rolling window.

---

## Technical debt (planning targets)

### A. Unify flock tuning

Today:

- `BoidsParams` — UI/runtime (speeds, repel, infect, wind, …)
- `flockSeparation.ts` — alignment/cohesion/separation constants
- `flocking.wgsl.ts` — **duplicate** numeric constants + `GROUP_PARAMS` arrays

**Recommendation:** Single source of truth exported to WGSL (codegen or shared JSON), or uniforms for all flock multipliers. Profiles should bundle **params + flock constants** together.

### B. Dynamic defaults

User wants **dynamic defaults** — e.g. defaults that respond to:

- Canvas size / boid count
- Number of sounding notes (quota per color)
- Dead vs lit population ratio
- Optional: performance tier

Sketch approach:

1. Define `computeDynamicBoidsParams(base: BoidsParams, ctx: SimContext): BoidsParams`.
2. `SimContext`: `{ width, height, boidCount, noteCount, blankCount, quota, … }`.
3. Apply after voicing change and on resize — not every frame unless needed.
4. Keep built-in profiles as baselines; dynamic layer scales from active profile.

### C. Dead vs lit tuning lanes

Separate tuning tracks:

| Lane | Levers |
| --- | --- |
| **Dead** | `FLOCK_BLANK.*`, `maxSpeedIdle`, `minSpeedIdle`, blank repel, field (when on) |
| **Lit** | `FLOCK_ASSIGNED.*`, `FLOCK_SEPARATION.same*`, `maxSpeedAssigned`, infect_* |
| **Shared** | spatial hash, chord repel, integration caps |

### D. Murmuration quality checklist

When evaluating a profile:

- [ ] Dead clouds drift as loose ribbons, not square grids
- [ ] No high-frequency velocity flipping (check speed histogram / visual)
- [ ] Lit same-color groups hold together while moving fast
- [ ] Infection visibly propagates from lit carriers to nearby dead
- [ ] Conversion pings audible but not overwhelming
- [ ] Chord-change repel doesn’t dominate steady-state motion

---

## Suggested planning phases for next agent

### Phase 1 — Audit & measure (read-only)

1. Read `engine.ts` force accumulation for playing vs blank paths.
2. Diff CPU vs GPU flock behavior (constants in `flockSeparation.ts` vs `flocking.wgsl.ts`).
3. List every force applied to blank boids per frame (order + typical magnitude).
4. Document which UI sliders actually affect GPU path (some only CPU).

### Phase 2 — Profile + constant bundling

1. Extend `BoidsProfile` to include flock constants (or profile id → flock preset map).
2. Add `dead-murmur-v2`, `lit-murmur-v1` as experiments.
3. Wire **Load built-in** to apply both params and flock constants.

### Phase 3 — Dead murmuration pass

1. Reduce jitter: lower max force, velocity damping or steering smoothing, widen idle speed band tuning.
2. Tune blank ali/coh vs sep/repel balance for “spread out but coordinated”.
3. Re-test at 20k with spatial hash settings in `gpuGrid.ts`.

### Phase 4 — Lit murmuration + infection pass

1. Tighten lit cohesion/alignment without reintroducing chaos.
2. Validate proximity infection at scale (carrier density, radius, maxPerColor).
3. Tune conversion ping limits alongside visual infect rate.

### Phase 5 — Dynamic defaults

1. Implement `computeDynamicBoidsParams` with conservative scaling rules.
2. Document formulas (e.g. infect radius ∝ sqrt(quota), idle max speed ∝ note count).
3. Optional UI toggle: “Dynamic tuning” on/off.

### Phase 6 — Vector field (optional profile)

1. Re-enable wind/center in a new profile only after murmuration baseline is solid.
2. Unify GPU `windAt()` with CPU `fieldSample.ts` (Perlin parity).

---

## Commands

```bash
npm run dev          # dev server
npm run check        # svelte-check + TS
npm run build        # production build
```

Branch context: `feat/boids-visualizer` (GPU boids, 20k, hybrid lifecycle).

---

## What not to do (unless asked)

- Don’t auto-load localStorage “recent” params (removed).
- Don’t clear all localStorage on mount.
- Don’t commit large unrelated refactors while tuning.
- Don’t re-enable vector field in active default until dead/lit murmurations are approved.

---

## Open questions for product owner

1. Should **dynamic defaults** apply on every voicing change, or only at chord settle?
2. Target aesthetic: more **Reynolds boids** (classic) vs **particle cloud** (soft, glowy)?
3. Is CPU route (`/boids`) still maintained at parity, or GPU-only tuning OK?
4. Should built-in profiles eventually replace user localStorage presets entirely?

---

## Quick start prompt for clean agent

Copy into a new session:

```
Read BOIDS_TUNING_HANDOFF.md in the p5-playground repo. Plan (do not implement yet) 
how to improve boid sim defaults for:
1) dead boids — spread-out murmurations, minimal jitter, vector field off
2) lit boids — faster tight flocks + reliable proximity infection
3) dynamic defaults scaled by canvas, boid count, and note quota

Deliver: phased plan, file touch list, proposed new built-in profiles, 
and a strategy to unify BoidsParams + flockSeparation + WGSL constants.
Primary route: /gpu/boids at 20k boids.
```
