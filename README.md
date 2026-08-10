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
| Thumb + index + pinky | 6 |
| Thumb out, other fingers down | 7 |
| Fist / unrecognized | release |

Inward or neutral tilt keeps the natural diatonic triad.
Outward tilt flips major and minor; diminished stays diminished.

### Modifier hand

When a pose is clear, it overrides degree tilt:

| Pose | Quality |
| --- | --- |
| Index up | sus2 |
| Index + middle | sus4 |
| Index + pinky | augmented |
| Middle + ring | diminished |
| Thumb out, fist | dominant7 |
| Thumb + index | major7 |
| Thumb + index + middle | minor7 |
| Thumb + pinky | half-diminished7 |
| Thumb + index + pinky | diminished7 |

Click the canvas to enable audio.
Toggle **Show video** to overlay the webcam feed.

## Cursor Cloud

Repo-scoped agent config lives in `.cursor/`, `.agents/`, and `AGENTS.md`.
Cloud VMs run `npm install` and restore skills via `.cursor/environment.json` `install`,
then serve with `npm run dev` on port 5173.
