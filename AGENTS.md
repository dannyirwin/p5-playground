# p5-playground

A [p5.js](https://p5js.org/) creative-coding sketch: a webcam hand-tracking musical
instrument. Two hands are read via [ml5.js](https://ml5js.org/) `handPose` — one hand
selects a chord (ASL digits 1-8), the other sets chord quality (finger/tilt/thumb pose) —
and the notes are synthesized with `p5.sound` oscillators and drawn as vibrating "strings".

## Cursor Cloud specific instructions

- This is a **static site with no build step, no package manager, no tests, and no linter**.
  The entry point is `index.html`, which loads the sketch from `sketch.js`.
- `index.html` loads `p5.js`, `p5.sound.min.js`, and `ml5.js` **from CDN at runtime**, so the
  browser needs outbound internet access. Local vendored copies (`p5.js`, `p5.sound.min.js`,
  `ml5.js`) are committed in the repo but are **not** referenced by `index.html`.
- Run it with any static file server from the repo root, e.g. `python3 -m http.server 8000`,
  then open `http://localhost:8000/index.html`. There is no hot-reload; refresh the browser
  after edits.
- The core feature (hand tracking) needs a **webcam**. The cloud VM has no camera, so
  `createCapture(VIDEO)` and `ml5.handPose` cannot track hands — this is expected. The canvas,
  the "strings" visualization, the mouse-following dot, the text overlays, and the interactive
  controls (clicking the canvas enables audio; the "Show video" button toggles the webcam
  overlay) still render and work without a camera.
- Expected console noise in the headless VM: `No webcam found` / `Requested device not found`,
  `AudioContext was not allowed to start` (until the canvas is clicked), a `favicon.ico` 404,
  and WebGL/WebGPU backend warnings from ml5/TensorFlow.js. None of these block rendering.
