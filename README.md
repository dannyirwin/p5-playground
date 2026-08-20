# p5-playground

A TypeScript SvelteKit + p5.js webcam hand-tracking musical instrument.

ml5.js `handPose` reads two hands (scale degree + optional quality modifier).
`p5.sound` synthesizes the notes.
The sketch mounts client-only; SvelteKit does not SSR it.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open http://localhost:5173

## Check / build

```bash
npm run check
npm run build
```

## Playing

Use the **Key** (C-B) and **Mode** (major/minor) controls to set the tonic.
Natural triads are diatonic in that key and mode.

### Degree hand (1-7)

| Pose | Degree |
| --- | --- |
| Index up | 1 |
| Index + middle | 2 |
| Thumb-pinky touch; index/middle/ring up | 3 |
| Four fingers, thumb in | 4 |
| Open five | 5 |
| Index + pinky (no thumb) | 6 |
| Thumb out, other fingers down | 7 |
| Fist / unrecognized | release |

Inward or neutral tilt, or palm toward camera, keeps the natural diatonic triad.
Outward tilt or palm away flips major and minor; diminished (e.g. vii in major) becomes major.

### Modifier hand

When a pose is clear, it overrides degree tilt.

**Palm toward camera** (depends on current maj/min triad):

| Fingers | Major triad | Minor / dim triad |
| --- | --- | --- |
| 1 (index) | major7 | minor7 |
| 2 (index + middle) | dominant7 | half-diminished7 |
| 2 + thumb out | dominant7 | diminished7 |
| 3 | sus2 | sus2 |
| 4 | sus4 | sus4 |

**Palm away from camera:** 1 finger = augmented, 2 fingers = diminished.

Click the canvas to enable audio.
Toggle **Show video** to overlay the webcam feed.

## Cursor Cloud

Repo-scoped agent config lives in `.cursor/`, `.agents/`, and `AGENTS.md`.
Cloud VMs run `npm install` and restore skills via `.cursor/environment.json` `install`,
then serve with `npm run dev` on port 5173.
