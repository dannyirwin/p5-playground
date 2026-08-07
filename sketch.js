let video, handPose, hands = [];
let voices = [];
let filter;
let showVideo = false;
let strings = []; // fixed, evenly spaced, always visible

let currentChordId = null;
let chordStable = 0, chordLastRaw = 0;
let previousNotes = null; // the actual MIDI notes currently sounding

const majorScale = [0, 2, 4, 5, 7, 9, 11];
const rootMidi = 60; // C4

// ---------- Chord quality intervals ----------
const qualityIntervals = {
  major:            [0, 4, 7],
  minor:            [0, 3, 7],
  sus2:             [0, 2, 7],
  sus4:             [0, 5, 7],
  augmented:        [0, 4, 8],
  diminished:       [0, 3, 6],
  dominant7:        [0, 4, 7, 10],
  major7:           [0, 4, 7, 11],
  minor7:           [0, 3, 7, 10],
  augmented7:       [0, 4, 8, 10],
  halfDiminished7:  [0, 3, 6, 10],
  diminished7:      [0, 3, 6, 9],
};

let thumbWasExtended = false; // module-level, alongside your other state vars

function getModifierQuality(modHand) {
  const kp = modHand.keypoints;
  const wrist = kp[0];
  function d(a, b) { return dist(a.x, a.y, b.x, b.y); }
  function up(tip, pip) { return d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.1; }

  const indexUp = up(8, 6);
  const middleUp = up(12, 10);
  const ringUp = up(16, 14);
  const pinkyUp = up(20, 18);

  const thumbRatio = d(kp[4], kp[17]) / d(kp[2], kp[17]);
  const thumbExtended = thumbWasExtended ? thumbRatio > 1.15 : thumbRatio > 1.35;
  thumbWasExtended = thumbExtended;

  // ...rest of the function unchanged...
}

// ---------- Follower dot (velocity/acceleration based, no snapping) ----------
let followerX, followerY;
let followerVelX = 0, followerVelY = 0;
let lastHandTargetX, lastHandTargetY;

// Tune these to change how the point tracks the hand
const FOLLOWER_ACCEL = 0.05;    // pull strength toward target — higher = snappier
const FOLLOWER_DAMPING = 0.8;   // velocity kept each frame — lower = more drag/friction
const FOLLOWER_MAX_SPEED = 60;   // px/frame cap, prevents overshoot on fast hand moves

// How much a string keeps vibrating while its note is actively held,
// vs. fully decaying to 0 once released.
const SUSTAIN_LEVEL = 0.35;

function preload() {
  handPose = ml5.handPose({ maxHands: 2 });
}

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, results => hands = results);

  filter = new p5.Filter('lowpass');
  filter.freq(2000);

  setupStrings();
  followerX = lastHandTargetX = width / 2;
  followerY = lastHandTargetY = height / 2;

  createP('Click canvas to enable audio. Chord hand: ASL digits 1-8. Modifier hand: fingers/tilt/thumb set chord quality.')
    .position(10, height + 10)
    .style('width', width + 'px');

  let videoToggleBtn = createButton('Show video');
  videoToggleBtn.position(10, height + 130);
  videoToggleBtn.mousePressed(() => {
    showVideo = !showVideo;
    videoToggleBtn.html(showVideo ? 'Hide video' : 'Show video');
  });
}
function midiNumberToHz(m) { return 440 * pow(2, (m - 69) / 12); }
function mousePressed() {
  userStartAudio();
}

function draw() {
  background(10, 12, 13);

  if (showVideo) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();
  }

  for (let hand of hands) {
    noStroke();
    fill(94, 230, 168);
    for (let kp of hand.keypoints) circle(width - kp.x, kp.y, 6); // mirrored to match display
  }

  let chordHand = hands.find(h => h.handedness === 'Left') || hands[0] || null;
  let modHand = hands.find(h => h !== chordHand) || null;

  // Update the follower target continuously, independent of chord triggering
  if (chordHand) {
    lastHandTargetX = chordHand.keypoints[9].x; // middle-finger MCP: base of fingers, top of palm
    lastHandTargetY = chordHand.keypoints[9].y;
  }
  updateFollower(lastHandTargetX, lastHandTargetY);

  let quality = modHand ? getModifierQuality(modHand) : 'major';

  if (chordHand) {
    let chordId = classifyASLNumber(chordHand);
    if (chordId === chordLastRaw) chordStable++;
    else {
      chordStable = 0;
      chordLastRaw = chordId;
    }

if (chordStable === 5 && chordId !== currentChordId) {
  if (chordId === 0) {
    stopChord();
    previousNotes = null;
    for (let s of strings) s.active = false;
  } else {
    const targetPCs = chordPitchClassesForQuality(chordId, quality);
    const targetMidi = targetMidiFromHandY(followerY);

    let voicing = closestVoicingToDot(targetPCs, targetMidi);
    playVoicing(voicing, 0.5, followerX);
    previousNotes = voicing;
  }
  currentChordId = chordId;
}
  }

  updateStrings();
  drawStrings();

  // Follower dot on top of the strings
  noStroke();
  fill(94, 230, 168, 180);
  circle(width - followerX, followerY, 18);

  fill(255);
  noStroke();
  textSize(16);
  text('Chord: ' + (currentChordId ? currentChordId : '—'), 10, 24);
  text('Quality: ' + quality, 10, 44);
  text('Notes: ' + (previousNotes ? previousNotes.join(',') : '—'), 10, 64);
text('Notes: ' + (previousNotes ? previousNotes.join(',') : '—'), 10, 64);
}

// ---------- Follower physics ----------
function updateFollower(targetX, targetY) {
  const dx = targetX - followerX;
  const dy = targetY - followerY;

  const accX = dx * FOLLOWER_ACCEL;
  const accY = dy * FOLLOWER_ACCEL;

  followerVelX = (followerVelX + accX) * FOLLOWER_DAMPING;
  followerVelY = (followerVelY + accY) * FOLLOWER_DAMPING;

  const speed = Math.hypot(followerVelX, followerVelY);
  if (speed > FOLLOWER_MAX_SPEED) {
    const scale = FOLLOWER_MAX_SPEED / speed;
    followerVelX *= scale;
    followerVelY *= scale;
  }

  followerX += followerVelX;
  followerY += followerVelY;
}

// ---------- Strings (waveform-style, pluck near hand + sustain while held) ----------
function setupStrings() {
  const lowMidi = 36, highMidi = 96;
  strings = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    strings.push({ midi: m, amplitude: 0, lastPluck: 0, active: false, originX: width / 2 });
  }
  strings.forEach((s, i) => {
    s.y = map(i, 0, strings.length - 1, height - 20, 20); // low note = bottom, high note = top
  });
}

function nearestString(midi) {
  return strings.reduce((best, s) =>
    Math.abs(s.midi - midi) < Math.abs(best.midi - midi) ? s : best
  );
}

function updateStrings() {
  for (let s of strings) {
    const floor = s.active ? SUSTAIN_LEVEL : 0;
    if (Math.abs(s.amplitude - floor) > 0.001) {
      const tau = map(s.midi, 36, 96, 900, 300); // higher notes settle faster
      s.amplitude = floor + (s.amplitude - floor) * exp(-deltaTime / tau);
    } else {
      s.amplitude = floor;
    }
  }
}

function drawStrings() {
  noFill();
  for (let s of strings) {
    const elapsed = millis() - s.lastPluck;
    const alpha = lerp(50, 255, constrain(s.amplitude, 0, 1));
    const weight = lerp(1, 2, constrain(s.amplitude, 0, 1));
    stroke(94, 230, 168, alpha);
    strokeWeight(weight);

    const originX = s.originX ?? width / 2;
    const spatialFreq = map(s.midi, 36, 96, 0.12, 0.22); // higher notes = tighter ripples
    const travelSpeed = map(s.midi, 36, 96, 0.015, 0.03);

    beginShape();
    for (let x = 0; x <= width; x += 4) {
      const distFromOrigin = abs(x - originX);
      const envelope = exp(-distFromOrigin / 90); // fades out with distance from the hand
      const wiggle = sin(distFromOrigin * spatialFreq - elapsed * travelSpeed);
      const displacement = s.amplitude * 7 * envelope * wiggle;
      vertex(x, s.y + displacement);
    }
    endShape();
  }
}

// ---------- Playback ----------
function noteToFreq(m) { return 440 * pow(2, (m - 69) / 12); }

function playVoicing(notes, x, handX) {
  stopChord();

  const activatedStrings = notes.map(note => nearestString(note));
  const activatedSet = new Set(activatedStrings);

  for (let s of strings) {
    if (activatedSet.has(s)) {
      if (!s.active) {
        s.amplitude = 1;      // fresh pluck
        s.lastPluck = millis();
      }
      s.originX = handX;
      s.active = true;         // keeps vibrating (sustain floor) while held
    } else {
      s.active = false;        // starts fading toward 0
    }
  }

  for (const note of notes) {
  let osc = new p5.Oscillator('sawtooth');
  osc.disconnect();
  osc.connect(filter);
  const hz = midiNumberToHz(note);
  osc.freq(hz);
  osc.amp(0);
  osc.start();
  osc.amp(0.15, 0.05);
  voices.push(osc);
}
  filter.freq(300 + x * 4000);
}

function stopChord() {
  for (const osc of voices) {
    osc.amp(0, 0.08);
    setTimeout(() => osc.stop(), 150);
  }
  voices = [];
}

// ---------- Chord math ----------
function scaleDegreeMidi(idx) {
  const oct = Math.floor(idx / majorScale.length);
  const deg = ((idx % majorScale.length) + majorScale.length) % majorScale.length;
  return rootMidi + oct * 12 + majorScale[deg];
}

function chordPitchClassesForQuality(chordDigit, qualityName) {
  const rootIdx = chordDigit - 1;

  if (qualityName === 'natural') {
    return [0, 2, 4].map(off => ((scaleDegreeMidi(rootIdx + off) % 12) + 12) % 12);
  }

  const rootPc = ((scaleDegreeMidi(rootIdx) % 12) + 12) % 12;
  const intervals = qualityIntervals[qualityName];
  return intervals.map(iv => (rootPc + iv) % 12);
}

function targetMidiFromHandY(y) {
  const lowMidi = 36, highMidi = 96; // matches the string range in setupStrings
  return constrain(map(y, height - 20, 20, lowMidi, highMidi), lowMidi, highMidi);
}

function nearestNote(pitchClass, reference) {
  let candidate = Math.round((reference - pitchClass) / 12) * 12 + pitchClass;
  return [candidate - 12, candidate, candidate + 12]
    .reduce((best, c) => Math.abs(c - reference) < Math.abs(best - reference) ? c : best);
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  let result = [];
  for (let i = 0; i < arr.length; i++) {
    let rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (let p of permutations(rest)) result.push([arr[i], ...p]);
  }
  return result;
}

// Finds the voicing closest to the previous chord (best voice-leading),
// then shifts the whole result by whole octaves to stay near the hand.
function closestVoicingHybrid(prevNotes, targetPitchClasses, targetMidi) {
  let notes;

  if (prevNotes && prevNotes.length === targetPitchClasses.length) {
    let bestNotes = null, bestCost = Infinity;
    for (let perm of permutations(targetPitchClasses)) {
      let candidate = perm.map((pc, i) => nearestNote(pc, prevNotes[i]));
      let cost = candidate.reduce((sum, n, i) => sum + Math.abs(n - prevNotes[i]), 0);
      if (cost < bestCost) { bestCost = cost; bestNotes = candidate; }
    }
    notes = bestNotes;
  } else {
    notes = targetPitchClasses.map(pc => nearestNote(pc, targetMidi));
  }

  const center = notes.reduce((a, b) => a + b, 0) / notes.length;
  const octaveShift = Math.round((targetMidi - center) / 12) * 12;
  return notes.map(n => n + octaveShift);
}

// ---------- Hand reading ----------
function classifyASLNumber(hand) {
  const kp = hand.keypoints;
  const wrist = kp[0];
  const scale = dist(wrist.x, wrist.y, kp[9].x, kp[9].y);
  function d(a, b) { return dist(a.x, a.y, b.x, b.y); }
  function up(tip, pip) { return d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.1; }
  function touching(tipIdx) { return d(kp[4], kp[tipIdx]) < scale * 0.5; }

  const indexUp = up(8, 6), middleUp = up(12, 10), ringUp = up(16, 14), pinkyUp = up(20, 18);
  const thumbOut = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.05;
  const upCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  if (upCount === 1 && indexUp) return 1;
  if (upCount === 2 && indexUp && middleUp) return thumbOut ? 3 : 2;
  if (upCount === 4) return thumbOut ? 5 : 4;
  if (upCount === 3) {
    if (!pinkyUp && touching(20)) return 6;
    if (!ringUp && touching(16)) return 7;
    if (!middleUp && touching(12)) return 8;
  }
  return 0;
}

function getModifierQuality(modHand) {
  const kp = modHand.keypoints;
  const wrist = kp[0];
  function d(a, b) { return dist(a.x, a.y, b.x, b.y); }
  function up(tip, pip) { return d(wrist, kp[tip]) > d(wrist, kp[pip]) * 1.1; }

  const indexUp = up(8, 6);
  const middleUp = up(12, 10);
  const ringUp = up(16, 14);
  const pinkyUp = up(20, 18);
const thumbExtended = d(kp[4], kp[17]) > d(kp[2], kp[17]) * 1.3;
  // Sus chords: bottom fingers only (no index, no thumb)
  if (!thumbExtended && !indexUp && ringUp && pinkyUp) {
    return middleUp ? 'sus4' : 'sus2';
  }

  // Tilt only matters when the index finger is actually pointing.
  let tilt = 'neutral';
  if (indexUp) {
    const indexMcp = kp[5], indexTip = kp[8];
    const dx = indexTip.x - indexMcp.x;
    const dy = indexTip.y - indexMcp.y;
    const angle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
    const THRESH = 40;
    if (angle <= -THRESH) tilt = 'up';
    else if (angle >= THRESH) tilt = 'down';
  }

  // topCount: 0 = fist, 1 = index only, 2 = index + middle
  let topCount = 0;
  if (indexUp) topCount = middleUp ? 2 : 1;

  if (thumbExtended) {
    if (topCount === 0) return 'dominant7';
    if (topCount === 1) {
      if (tilt === 'up') return 'augmented7';
      if (tilt === 'down') return 'halfDiminished7';
      return 'major7';
    }
    return tilt === 'down' ? 'diminished7' : 'minor7'; // topCount === 2
  }

  if (topCount === 0) return 'natural'; // closed fist — plain diatonic chord
  if (topCount === 1) return tilt === 'up' ? 'augmented' : 'major';
  return tilt === 'down' ? 'diminished' : 'minor'; // topCount === 2
}

function closestVoicingToDot(targetPitchClasses, targetMidi) {
  return targetPitchClasses.map(pc => nearestNote(pc, targetMidi));
}