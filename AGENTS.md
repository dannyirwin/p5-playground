<!-- dotfiles:shared-agents -->

# Agent instructions

These are common instructions for Danny's agents across all scenarios.

## General Guidelines

- Never use the em dash (—).
  Use a plain hyphen (-) instead.
- When writing commit messages, never auto-add your agent name as co-author.
- Never manually modify CHANGELOG.md files or any files that are marked as
  auto-generated.
- When writing or substantially editing long Markdown files, put each full
  sentence on its own line.
  Preserve normal Markdown structure, but avoid wrapping multiple sentences
  onto one physical line.
- When making technical decisions, do not give much weight to development cost.
  Instead, prefer quality, simplicity, robustness, scalability, and long-term
  maintainability.
- When doing bug fixes, always start by reproducing the bug in an E2E setting
  that matches how an end user would interact.
  This makes sure you find the real problem so your fix will actually solve it.
- When end-to-end testing a product, be picky about the UI you see and be
  obsessed with pixel perfection.
  If something clearly looks off, even if it is not directly related to what you
  are doing, try to get it fixed along the way.
- Apply the same high standard to engineering excellence: lint, test failures,
  and test flakiness.
  If you see one, even if it is not caused by what you are working on right now,
  still get it fixed.

## Danny's Opinions

When work would benefit from Danny's taste or beliefs, read `.agents/OPINIONS.md`.
Start with the engineering and tooling sections; treat empty sections as unsettled.

## Project

A [p5.js](https://p5js.org/) creative-coding sketch: a webcam hand-tracking musical
instrument.
Two hands are read via [ml5.js](https://ml5js.org/) `handPose`.
One hand selects a scale degree (poses 1-7) and can tilt inward/outward to keep or
flip the diatonic triad quality; the other hand can override quality with explicit
modifier poses (sus, aug/dim, sevenths).
Key (C-B) and mode (major/minor) are chosen in the UI so natural triads follow that
scale.
Notes are synthesized with `p5.sound` oscillators and drawn as vibrating "strings".

This is a **TypeScript [SvelteKit](https://svelte.dev/docs/kit) SPA** (`@sveltejs/adapter-static`,
`ssr = false`).
The sketch runs **client-only**: `HandInstrument.svelte` mounts a p5 instance-mode
module (`src/lib/sketch/handInstrument.ts`) in `onMount`.
Core `p5` comes from npm; `p5.sound` and `ml5` load from CDN inside the browser only.

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev | `npm run dev` |
| Open | http://localhost:5173 |
| Typecheck | `npm run check` |
| Build | `npm run build` |

Definition of done for sketch/app changes: `npm run check` and `npm run build` both pass.
There is no separate test suite or linter beyond `svelte-check`.

### Gesture cheat sheet

**Degree hand** (camera-facing, fingers up):

| Pose | Degree |
| --- | --- |
| Index up | 1 |
| Index + middle | 2 |
| Thumb-pinky touch; index/middle/ring up | 3 |
| Four fingers, thumb in | 4 |
| Open five | 5 |
| Thumb + index + pinky | 6 |
| Thumb out, other fingers down | 7 |
| Fist / unrecognized | release (0) |

Inward (or neutral) tilt: natural diatonic triad in the selected key and mode.
Outward tilt: maj/min flip when the natural quality is major or minor; diminished is unchanged.

**Modifier hand** (overrides degree tilt when a pose is clear):

| Pose | Quality |
| --- | --- |
| No clear pose / hand absent | Degree + tilt triad |
| Index up | sus2 |
| Index + middle | sus4 |
| Index + pinky | augmented |
| Middle + ring | diminished |
| Thumb out, fist | dominant7 |
| Thumb + index | major7 |
| Thumb + index + middle | minor7 |
| Thumb + pinky | half-diminished7 |
| Thumb + index + pinky | diminished7 |

UI **Key** and **Mode** controls set the tonic pitch class and major/natural-minor scale.

## Cursor Cloud

- Agent bundle lives in committed `.cursor/` (implement-plan, code-review, subagents, plan-sync hook).
- Shared opinions: committed `.agents/OPINIONS.md` - do **not** rely on a `~/.agents` symlink in cloud VMs.
- Environment is Dockerfile-based (`.cursor/Dockerfile` + `.cursor/environment.json`).
- `install` runs `npm install` and restores skills from `skills-lock.json`.
- Dev server starts via the `terminals` entry: `npm run dev` on port 5173.
- The core feature (hand tracking) needs a **webcam**.
  The cloud VM has no camera, so `createCapture(VIDEO)` and `ml5.handPose` cannot track hands - this is expected.
  The canvas, the "strings" visualization, the mouse-following dot, the text overlays, and the interactive
  controls (clicking the canvas enables audio; the "Show video" button toggles the webcam
  overlay) still render and work without a camera.
- Expected console noise in the headless VM: `No webcam found` / `Requested device not found`,
  `AudioContext was not allowed to start` (until the canvas is clicked),
  and WebGL/WebGPU backend warnings from ml5/TensorFlow.js.
  None of these block rendering.
- Re-apply or refresh the agent bundle from [dannyirwin/dotfiles](https://github.com/dannyirwin/dotfiles):

```bash
bash ~/dotfiles/scripts/apply-project.sh /workspace
```
