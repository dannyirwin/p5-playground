/** Instanced fuzzy spark — matches `glowDraw.ts` radial gradient. */

export const BOID_GLOW_VERT = /* glsl */ `
precision highp float;

/* pos.xy | vel.xy */
attribute vec4 iPack0;
/* lit | targetMidi | ghostMidi | glowSize */
attribute vec4 iPack1;
/* glowBright | glowPhase | glowRate | speedTrait */
attribute vec4 iPack2;

uniform float uMillis;
uniform float uMaxSpeedAssigned;
uniform float uMaxSpeedIdle;
uniform float uIdleAlphaBase;
uniform float uIdleAlphaPulse;
uniform float uGlowPointSize;
uniform float uGlowSpeedSize;
uniform int uNoteCount;
uniform float uNotes[8];
uniform float uBassActive;
uniform vec3 uNoteColors[12];
uniform vec3 uBassColor;

varying vec3 vColor;
varying float vAlpha;
varying float vSpeedHeat;
varying vec2 vUv;

const float GLOW_BASE_RADIUS = 3.6;
const float LIT_ACTIVE = 0.18;
const float FIREFLY_OMEGA = 1.25;
const float VOICING_LOW_MIDI = 48.0;

float fireflyPulse(float phase, float rate) {
  float t = uMillis * 0.001;
  float wave = sin(t * FIREFLY_OMEGA * rate + phase);
  float u = 0.5 + 0.5 * wave;
  return u * u * (3.0 - 2.0 * u);
}

vec3 colorForMidi(float midi) {
  if (midi < 0.0) {
    return vec3(0.33, 0.65, 0.58);
  }
  if (uBassActive > 0.5 && uNoteCount > 0) {
    float minNote = uNotes[0];
    for (int i = 1; i < 8; i++) {
      if (i >= uNoteCount) break;
      minNote = min(minNote, uNotes[i]);
    }
    if (midi < VOICING_LOW_MIDI && abs(midi - minNote) < 0.5) {
      return uBassColor;
    }
  }
  int pc = int(mod(midi, 12.0));
  if (pc < 0) pc += 12;
  return uNoteColors[pc];
}

void main() {
  vec2 iPos = iPack0.xy;
  vec2 iVel = iPack0.zw;
  float iLit = iPack1.x;
  float iTargetMidi = iPack1.y;
  float iGhostMidi = iPack1.z;
  float iGlowSize = iPack1.w;
  float iGlowBright = iPack2.x;
  float iGlowPhase = iPack2.y;
  float iGlowRate = iPack2.z;
  float iSpeedTrait = iPack2.w;

  float pulse = fireflyPulse(iGlowPhase, iGlowRate);
  float speed = length(iVel);
  float speedRef = max(uMaxSpeedAssigned * iSpeedTrait, 0.001);
  vSpeedHeat = clamp(speed / speedRef, 0.0, 1.0);
  float speedSizeAmt = clamp(uGlowSpeedSize, 0.0, 1.0);
  float sizeFromSpeed = mix(1.0, mix(1.18, 0.68, vSpeedHeat), speedSizeAmt);
  float brightFromSpeed = mix(1.0, 1.55, vSpeedHeat * speedSizeAmt);

  float colorMidi = iTargetMidi >= 0.0 ? iTargetMidi : (iGhostMidi >= 0.0 && iLit > 0.0 ? iGhostMidi : -1.0);
  bool showingColor = colorMidi >= 0.0 && iLit > 0.02;

  float radius;
  if (showingColor) {
    bool live = iTargetMidi >= 0.0 && iLit >= LIT_ACTIVE;
    float baseA = live ? 0.42 : 0.22;
    float pulseAmt = live ? 0.58 : 0.38;
    vAlpha = (baseA + pulseAmt * pulse) * iGlowBright * iLit * brightFromSpeed;
    radius = GLOW_BASE_RADIUS * uGlowPointSize * iGlowSize * (0.88 + 0.2 * pulse) * (0.55 + 0.45 * iLit) * sizeFromSpeed;
    vColor = colorForMidi(colorMidi);
  } else {
    float heat = clamp(speed / uMaxSpeedIdle, 0.0, 1.0);
    vColor = mix(vec3(0.33, 0.65, 0.57), vec3(0.51, 0.86, 0.75), heat);
    vAlpha = (uIdleAlphaBase + uIdleAlphaPulse * pulse) * iGlowBright * brightFromSpeed;
    radius = GLOW_BASE_RADIUS * uGlowPointSize * iGlowSize * (0.88 + 0.14 * pulse) * sizeFromSpeed;
  }

  vUv = position.xy;
  vec2 worldPos = iPos + position.xy * radius;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 0.0, 1.0);
}
`;

export const BOID_GLOW_FRAG = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vSpeedHeat;
varying vec2 vUv;

void main() {
  float d = length(vUv);
  if (d > 1.0) discard;

  float coreMix = 0.48 + 0.42 * vSpeedHeat;
  vec3 coreRgb = mix(vColor, vec3(1.0), coreMix);
  float midStop = max(0.04, 0.18 - 0.1 * vSpeedHeat);
  float fallStop = max(midStop + 0.05, 0.52 - 0.18 * vSpeedHeat);

  float coreAlpha = min(1.0, vAlpha * (1.05 + 0.35 * vSpeedHeat));
  float midAlpha = vAlpha * (0.88 + 0.1 * vSpeedHeat);
  float rimAlpha = vAlpha * (0.34 - 0.12 * vSpeedHeat);

  vec3 rgb;
  float a;
  if (d < midStop) {
    rgb = coreRgb;
    a = mix(coreAlpha, midAlpha, d / midStop);
  } else if (d < fallStop) {
    rgb = vColor;
    a = mix(midAlpha, rimAlpha, (d - midStop) / (fallStop - midStop));
  } else {
    rgb = vColor;
    a = mix(rimAlpha, 0.0, (d - fallStop) / (1.0 - fallStop));
  }

  gl_FragColor = vec4(rgb * a, a);
}
`;
