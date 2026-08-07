# p5-playground

A TypeScript SvelteKit + p5.js webcam hand-tracking musical instrument.

ml5.js `handPose` reads two hands (chord + quality).
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

## Cursor Cloud

Repo-scoped agent config lives in `.cursor/`, `.agents/`, and `AGENTS.md`.
Cloud VMs run `npm install` and restore skills via `.cursor/environment.json` `install`,
then serve with `npm run dev` on port 5173.
