import { PERLIN_NOISE_WGSL } from '../../boids/perlinNoise.wgsl.ts';

export const FLOCKING_WGSL = /* wgsl */ `
const LIT_ACTIVE: f32 = 0.18;
const FIELD_FORCE_IDLE_CAP: f32 = 0.7;
const FIELD_FORCE_PLAYING_CAP_MUL: f32 = 1.35;
const ALI_IDLE_MUL: f32 = 0.2;
const COH_IDLE_MUL: f32 = 0.08;
const BLANK_SPEED_LIT: f32 = 0.22;
const BLANK_SPEED_LIT_RANGE: f32 = 0.35;
const FRAME_MS: f32 = 16.6667;

struct SimUniforms {
  width: f32,
  height: f32,
  deltaTime: f32,
  millis: f32,
  gridCols: u32,
  gridRows: u32,
  cellSize: f32,
  boidCount: u32,
  maxPerCell: u32,
  noteCount: u32,
  bassActive: u32,
  quota: f32,
  repelPhase: f32,
  sepRadiusIdle: f32,
  sepRadiusSame: f32,
  aliRadius: f32,
  cohRadius: f32,
  blankRepelRadius: f32,
  huntRadius: f32,
  chordSepRadius: f32,
  sepIdle: f32,
  sepSame: f32,
  aliWeight: f32,
  cohWeight: f32,
  blankRepel: f32,
  huntBlankAttract: f32,
  huntColorAttract: f32,
  blankSeekAttract: f32,
  chordRepelSep: f32,
  chordRepelForce: f32,
  huntBelowFrac: f32,
  preyAboveFrac: f32,
  nearMaxFrac: f32,
  stealBelowFrac: f32,
  minHoldFrac: f32,
  minSpeedIdle: f32,
  maxForceAssigned: f32,
  maxForceIdle: f32,
  chordRepelSpeedBoost: f32,
  windForce: f32,
  windForceIdle: f32,
  windEnabled: f32,
  centerStrength: f32,
  centerFalloff: f32,
  centerQuadratic: f32,
  centerEnabled: f32,
  litFadeRate: f32,
  litRiseRate: f32,
  maxSpeedAssigned: f32,
  maxSpeedIdle: f32,
  blankBlankRepelWeight: f32,
  blankRepelNearMaxBoost: f32,
  blankBlankAliMul: f32,
  blankBlankCohMul: f32,
  blankForceMul: f32,
  blankSepIdleMul: f32,
  aliAssignedMul: f32,
  cohAssignedMul: f32,
  sepAssignedIdleMul: f32,
  sepAssignedSameMul: f32,
  minSpeedPlaying: f32,
  globalForceCapLit: f32,
  globalForceCapBlank: f32,
  steeringSmoothPlaying: f32,
  steeringSmoothBlank: f32,
  windSpatial: f32,
  windTime: f32,
  windAngleTurns: f32,
  notes0: f32,
  notes1: f32,
  notes2: f32,
  notes3: f32,
  notes4: f32,
  notes5: f32,
  notes6: f32,
  notes7: f32,
  windAffectsLit: f32,
  windAffectsDead: f32,
  centerAffectsLit: f32,
  centerAffectsDead: f32,
  sepDiff: f32,
  sepRadiusDiff: f32,
  sepDiffLateral: f32,
  speedDrag: f32,
};

struct Boid {
  pos: vec2f,
  vel: vec2f,
  lit: f32,
  targetMidi: f32,
  ghostMidi: f32,
  glowSize: f32,
  glowBright: f32,
  glowPhase: f32,
  glowRate: f32,
  speedTrait: f32,
};

struct SimStats {
  midiCounts: array<atomic<u32>, 128>,
  blankCount: atomic<u32>,
};

@group(0) @binding(0) var<uniform> u: SimUniforms;
@group(0) @binding(1) var<storage, read_write> boids: array<Boid>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> stats: SimStats;

// Per pitch-class personality (matches engine.ts GROUP_PARAMS).
const G_SEP: array<f32, 12> = array<f32, 12>(
  0.94, 0.99, 1.03, 1.04, 1.03, 0.99, 0.94, 0.89, 0.85, 0.84, 0.85, 0.89
);
const G_ALI: array<f32, 12> = array<f32, 12>(
  1.00, 0.95, 0.90, 0.86, 0.84, 0.85, 0.88, 0.93, 0.98, 1.02, 1.04, 1.03
);
const G_COH: array<f32, 12> = array<f32, 12>(
  1.00, 0.97, 0.89, 0.84, 0.87, 0.95, 1.00, 0.97, 0.89, 0.84, 0.87, 0.95
);
const G_MAXSP: array<f32, 12> = array<f32, 12>(
  1.04, 0.99, 0.91, 0.85, 0.84, 0.89, 0.97, 1.03, 1.04, 0.99, 0.91, 0.85
);
const G_MAXF: array<f32, 12> = array<f32, 12>(
  1.02, 0.89, 0.80, 0.89, 1.02, 1.00, 0.86, 0.80, 0.92, 1.04, 0.98, 0.83
);

fn noteAt(i: u32) -> f32 {
  switch i {
    case 0u: { return u.notes0; }
    case 1u: { return u.notes1; }
    case 2u: { return u.notes2; }
    case 3u: { return u.notes3; }
    case 4u: { return u.notes4; }
    case 5u: { return u.notes5; }
    case 6u: { return u.notes6; }
    default: { return u.notes7; }
  }
}

fn wrapDelta(delta: f32, size: f32) -> f32 {
  let half = size * 0.5;
  if (delta > half) { return delta - size; }
  if (delta < -half) { return delta + size; }
  return delta;
}

fn radialFalloff(distSq: f32, radiusSq: f32) -> f32 {
  if (distSq >= radiusSq || radiusSq <= 0.0) { return 0.0; }
  let u = 1.0 - distSq / radiusSq;
  return u * u * (3.0 - 2.0 * u);
}

fn maxNeighborRadius() -> f32 {
  return max(
    u.huntRadius,
    max(
      u.sepRadiusDiff,
      max(
        u.sepRadiusSame,
        max(
          u.sepRadiusIdle,
          max(u.cohRadius, max(u.aliRadius, max(u.blankRepelRadius, u.chordSepRadius)))
        )
      )
    )
  );
}

fn cellMayIntersectDisc(cellCx: i32, cellCy: i32, px: f32, py: f32, radius: f32) -> bool {
  // Unwrapped lattice centers — wrapDelta picks the correct periodic image.
  let centerX = (f32(cellCx) + 0.5) * u.cellSize;
  let centerY = (f32(cellCy) + 0.5) * u.cellSize;
  let ddx = wrapDelta(centerX - px, u.width);
  let ddy = wrapDelta(centerY - py, u.height);
  let reach = radius + u.cellSize * 0.70710678;
  return dot(vec2f(ddx, ddy), vec2f(ddx, ddy)) <= reach * reach;
}

fn wrapPos(v: f32, size: f32) -> f32 {
  if (size <= 0.0) { return v; }
  return v - floor(v / size) * size;
}

fn wrapCellCol(cx: i32) -> u32 {
  let cols = i32(u.gridCols);
  var x = cx % cols;
  if (x < 0) { x += cols; }
  return u32(x);
}

fn wrapCellRow(cy: i32) -> u32 {
  let rows = i32(u.gridRows);
  var y = cy % rows;
  if (y < 0) { y += rows; }
  return u32(y);
}

fn cellIndexWrapped(cx: i32, cy: i32) -> u32 {
  return wrapCellRow(cy) * u.gridCols + wrapCellCol(cx);
}

fn cellId(p: vec2f) -> u32 {
  let cx = i32(clamp(floor(p.x / u.cellSize), 0.0, f32(u.gridCols - 1u)));
  let cy = i32(clamp(floor(p.y / u.cellSize), 0.0, f32(u.gridRows - 1u)));
  return cellIndexWrapped(cx, cy);
}

fn insertIntoCell(cell: u32, cellCx: i32, cellCy: i32, boidIndex: u32) {
  let slot = atomicAdd(&cellCounts[cell], 1u);
  if (slot < u.maxPerCell) {
    cellIndices[cell * u.maxPerCell + slot] = boidIndex;
    return;
  }
  // Primary bucket full — spill into a neighbor cell so dense clumps aren't
  // truncated to a square aligned with this cell (reduces grid artifacts).
  let h = hash21(vec2f(f32(boidIndex) * 0.619, f32(cell) * 0.371));
  var sdx = i32(floor(h * 3.0)) - 1;
  let h2 = hash21(vec2f(f32(boidIndex) * 0.133, f32(cell) * 0.887));
  var sdy = i32(floor(h2 * 3.0)) - 1;
  if (sdx == 0 && sdy == 0) { sdx = 1; }
  let spill = cellIndexWrapped(cellCx + sdx, cellCy + sdy);
  let slot2 = atomicAdd(&cellCounts[spill], 1u);
  if (slot2 < u.maxPerCell) {
    cellIndices[spill * u.maxPerCell + slot2] = boidIndex;
  } else {
    let replaceSlot = min(
      u32(hash21(vec2f(f32(boidIndex), f32(spill))) * f32(u.maxPerCell)),
      u.maxPerCell - 1u
    );
    cellIndices[spill * u.maxPerCell + replaceSlot] = boidIndex;
  }
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

${PERLIN_NOISE_WGSL}

fn windAt(p: vec2f) -> vec2f {
  let t = u.millis * u.windTime;
  // Both torus angles in each sample (not separable f(x)+g(y)).
  let sx = u.windSpatial * 0.5;
  let ux = (wrapPos(p.x, u.width) / max(1.0, u.width)) * 6.2831853;
  let uy = (wrapPos(p.y, u.height) / max(1.0, u.height)) * 6.2831853;
  let cu = cos(ux);
  let su = sin(ux);
  let cv = cos(uy);
  let sv = sin(uy);
  let n = perlin3(cu * sx + cv * sx * 0.7, su * sx + sv * sx * 0.7, t);
  let angle = n * 6.2831853 * u.windAngleTurns;
  let m = perlin3(cu * sx + sv * sx * 0.7 + 19.1, su * sx + cv * sx * 0.7 - 7.4, t + 3.7);
  let mag = 0.45 + m * 0.55;
  return vec2f(cos(angle), sin(angle)) * mag;
}

fn centerBias(p: vec2f) -> vec2f {
  if (u.centerEnabled < 0.5) { return vec2f(0.0); }
  let px = wrapPos(p.x, u.width);
  let py = wrapPos(p.y, u.height);
  // Harmonic per-axis bowl — ~0 on wrap seam so corners aren't sinks.
  let dx = wrapDelta(px - u.width * 0.5, u.width);
  let dy = wrapDelta(py - u.height * 0.5, u.height);
  let expo = max(0.25, u.centerFalloff);
  let sx = sin((dx / max(1.0, u.width)) * 6.2831853);
  let sy = sin((dy / max(1.0, u.height)) * 6.2831853);
  var shapedX = select(sx, sign(sx) * sx * sx, u.centerQuadratic > 0.5);
  var shapedY = select(sy, sign(sy) * sy * sy, u.centerQuadratic > 0.5);
  shapedX = sign(shapedX) * pow(abs(shapedX), expo);
  shapedY = sign(shapedY) * pow(abs(shapedY), expo);
  return vec2f(-shapedX, -shapedY) * u.centerStrength;
}

fn limitForce(fx: f32, fy: f32, maxF: f32) -> vec2f {
  let m = length(vec2f(fx, fy));
  if (m <= maxF || m == 0.0) { return vec2f(fx, fy); }
  let s = maxF / m;
  return vec2f(fx * s, fy * s);
}

fn steer(desiredX: f32, desiredY: f32, vel: vec2f, weight: f32, maxF: f32, maxSp: f32) -> vec2f {
  let mag = length(vec2f(desiredX, desiredY));
  if (mag < 0.0001) { return vec2f(0.0); }
  let scale = maxSp / mag;
  // Weight before force cap — each behavior stays bounded; stronger weights
  // still win priority without blowing past maxF * N.
  return limitForce(
    (desiredX * scale - vel.x) * weight,
    (desiredY * scale - vel.y) * weight,
    maxF
  );
}

fn isPlayingBoid(targetMidi: f32, lit: f32) -> bool {
  return targetMidi >= 0.0 && lit >= LIT_ACTIVE;
}

fn pitchClass(midi: f32) -> u32 {
  return u32(i32(floor(midi)) % 12 + 12) % 12u;
}

fn groupFor(midi: f32, isBass: bool) -> vec4f {
  if (midi < 0.0) { return vec4f(1.0, 1.0, 1.0, 1.0); }
  let pc = pitchClass(midi);
  var sep = G_SEP[pc];
  var ali = G_ALI[pc];
  var coh = G_COH[pc];
  var maxSp = G_MAXSP[pc];
  var maxF = G_MAXF[pc];
  if (isBass) {
    sep *= 1.08;
    coh *= 1.12;
    maxSp *= 0.9;
  }
  return vec4f(sep, ali, coh, maxSp * maxF);
}

fn midiCount(midi: f32) -> u32 {
  if (midi < 0.0) { return 0u; }
  let idx = u32(clamp(floor(midi), 0.0, 127.0));
  return atomicLoad(&stats.midiCounts[idx]);
}

fn isBassMidi(midi: f32) -> bool {
  if (u.bassActive == 0u || u.noteCount == 0u) { return false; }
  var minNote = noteAt(0u);
  for (var i = 1u; i < u.noteCount; i++) {
    minNote = min(minNote, noteAt(i));
  }
  return midi < 48.0 && abs(midi - minNote) < 0.5;
}

fn colorNearMax() -> bool {
  if (u.quota <= 0.0) { return false; }
  let nearFloor = u.quota * (1.0 - u.nearMaxFrac);
  for (var i = 0u; i < u.noteCount; i++) {
    let c = midiCount(noteAt(i));
    if (f32(c) >= nearFloor) { return true; }
  }
  return false;
}

fn blankScarcity() -> f32 {
  let blanks = atomicLoad(&stats.blankCount);
  return 1.0 - f32(blanks) / max(1.0, f32(u.boidCount));
}

fn canStealFrom(carrierMidi: f32, victimMidi: f32, carrierCount: u32, victimCount: u32) -> bool {
  if (victimMidi < 0.0) { return true; }
  if (abs(carrierMidi - victimMidi) < 0.5) { return false; }
  let minHold = max(1u, u32(floor(u.quota * u.minHoldFrac)));
  if (victimCount <= minHold) { return false; }
  let carrierFrac = f32(carrierCount) / max(1.0, u.quota);
  if (carrierFrac < u.stealBelowFrac) { return true; }
  let nearFloor = u.quota * (1.0 - u.nearMaxFrac);
  if (f32(carrierCount) >= nearFloor && f32(victimCount) >= nearFloor) { return true; }
  return false;
}

@compute @workgroup_size(256)
fn resetStats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i < 128u) {
    atomicStore(&stats.midiCounts[i], 0u);
  } else if (i == 128u) {
    atomicStore(&stats.blankCount, 0u);
  }
}

@compute @workgroup_size(256)
fn countBoids(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.boidCount) { return; }
  let b = boids[i];
  if (isPlayingBoid(b.targetMidi, b.lit)) {
    let idx = u32(clamp(floor(b.targetMidi), 0.0, 127.0));
    atomicAdd(&stats.midiCounts[idx], 1u);
  } else {
    atomicAdd(&stats.blankCount, 1u);
  }
}

@compute @workgroup_size(256)
fn resetGrid(@builtin(global_invocation_id) gid: vec3u) {
  let cellCount = u.gridCols * u.gridRows;
  let i = gid.x;
  if (i >= cellCount) { return; }
  atomicStore(&cellCounts[i], 0u);
}

@compute @workgroup_size(256)
fn insertBoids(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.boidCount) { return; }
  let b = boids[i];
  let cx = i32(clamp(floor(b.pos.x / u.cellSize), 0.0, f32(u.gridCols - 1u)));
  let cy = i32(clamp(floor(b.pos.y / u.cellSize), 0.0, f32(u.gridRows - 1u)));

  insertIntoCell(cellIndexWrapped(cx, cy), cx, cy, i);
}

@compute @workgroup_size(256)
fn flock(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.boidCount) { return; }
  var b = boids[i];
  let playing = isPlayingBoid(b.targetMidi, b.lit);
  let isBass = playing && isBassMidi(b.targetMidi);
  let grp = groupFor(b.targetMidi, isBass);
  let gSep = grp.x;
  let gAli = grp.y;
  let gCoh = grp.z;
  let gSpeed = grp.w;

  let maxForce = select(u.maxForceIdle * u.blankForceMul, u.maxForceAssigned * gSpeed, playing);
  let playSpeed = u.maxSpeedAssigned * gSpeed * b.speedTrait;
  let idleSpeed = u.maxSpeedIdle * b.speedTrait;
  var maxSp = select(idleSpeed * (BLANK_SPEED_LIT + BLANK_SPEED_LIT_RANGE * b.lit), playSpeed, playing);
  if (u.repelPhase > 0.0) {
    maxSp *= 1.0 + (u.chordRepelSpeedBoost - 1.0) * u.repelPhase;
  }
  let minSp = select(u.minSpeedIdle, u.minSpeedPlaying, playing);

  let myMidi = select(-1.0, b.targetMidi, playing);
  let myCount = midiCount(myMidi);
  let myFrac = select(1.0, f32(myCount) / max(1.0, u.quota), u.quota > 0.0);
  let hunting = playing && myFrac < u.huntBelowFrac;
  let urgency = select(0.0, (u.huntBelowFrac - myFrac) / max(0.0001, u.huntBelowFrac), hunting);
  let scarcity = blankScarcity();
  let nearMax = colorNearMax();
  let nearFloor = u.quota * (1.0 - u.nearMaxFrac);
  let phase = u.repelPhase;

  var sepSameX = 0.0; var sepSameY = 0.0; var sameN = 0u;
  var sepIdleX = 0.0; var sepIdleY = 0.0; var idleN = 0u;
  var sepDiffRadX = 0.0; var sepDiffRadY = 0.0;
  var sepDiffLatX = 0.0; var sepDiffLatY = 0.0; var diffN = 0u;
  var aliX = 0.0; var aliY = 0.0; var aliN = 0u;
  var cohX = 0.0; var cohY = 0.0; var cohN = 0u;
  var blankRepelX = 0.0; var blankRepelY = 0.0; var blankRepelN = 0u;
  var huntBlankX = 0.0; var huntBlankY = 0.0; var huntBlankN = 0u;
  var huntPreyX = 0.0; var huntPreyY = 0.0; var huntPreyN = 0u;
  var blankSeekX = 0.0; var blankSeekY = 0.0; var blankSeekW = 0.0;
  var chordSepX = 0.0; var chordSepY = 0.0; var chordSepN = 0u;

  let cx = i32(clamp(floor(b.pos.x / u.cellSize), 0.0, f32(u.gridCols - 1u)));
  let cy = i32(clamp(floor(b.pos.y / u.cellSize), 0.0, f32(u.gridRows - 1u)));
  let sepIdleSq = u.sepRadiusIdle * u.sepRadiusIdle;
  let sepSameSq = u.sepRadiusSame * u.sepRadiusSame;
  let sepDiffSq = u.sepRadiusDiff * u.sepRadiusDiff;
  let aliSq = u.aliRadius * u.aliRadius;
  let cohSq = u.cohRadius * u.cohRadius;
  let blankRepelSq = u.blankRepelRadius * u.blankRepelRadius;
  let huntSq = u.huntRadius * u.huntRadius;
  let chordSepSq = u.chordSepRadius * u.chordSepRadius;

  let maxNeighborR = maxNeighborRadius();
  let neighborSpan = i32(ceil(maxNeighborR / u.cellSize));

  for (var dy: i32 = -neighborSpan; dy <= neighborSpan; dy++) {
    for (var dx: i32 = -neighborSpan; dx <= neighborSpan; dx++) {
      if (!cellMayIntersectDisc(cx + dx, cy + dy, b.pos.x, b.pos.y, maxNeighborR)) {
        continue;
      }
      let cell = cellIndexWrapped(cx + dx, cy + dy);
      let nCount = min(atomicLoad(&cellCounts[cell]), u.maxPerCell);
      let slotOffset = u32(
        select(0.0, hash21(b.pos * 0.037) * f32(nCount), nCount > 0u)
      );
      for (var k: u32 = 0u; k < nCount; k++) {
        let slot = (k + slotOffset) % nCount;
        let j = cellIndices[cell * u.maxPerCell + slot];
        if (j == i) { continue; }
        let o = boids[j];
        let ddx = wrapDelta(o.pos.x - b.pos.x, u.width);
        let ddy = wrapDelta(o.pos.y - b.pos.y, u.height);
        let distSq = ddx * ddx + ddy * ddy;
        if (distSq == 0.0) { continue; }

        let otherPlaying = isPlayingBoid(o.targetMidi, o.lit);
        let otherBlank = !otherPlaying;
        let bothOn = playing && otherPlaying;
        let sameNote = bothOn && abs(o.targetMidi - myMidi) < 0.5;
        let diffColor = bothOn && abs(o.targetMidi - myMidi) >= 0.5;

        if (otherBlank && distSq < blankRepelSq) {
          let falloff = radialFalloff(distSq, blankRepelSq);
          var w = 1.15;
          if (!playing && otherBlank) {
            w = u.blankBlankRepelWeight;
          }
          if (!playing && nearMax) { w *= u.blankRepelNearMaxBoost; }
          blankRepelX -= (ddx / distSq) * w * falloff;
          blankRepelY -= (ddy / distSq) * w * falloff;
          blankRepelN++;
        }

        if (phase > 0.0 && distSq < chordSepSq) {
          let falloff = radialFalloff(distSq, chordSepSq);
          chordSepX -= (ddx / distSq) * falloff;
          chordSepY -= (ddy / distSq) * falloff;
          chordSepN++;
        }

        if (hunting && urgency > 0.0 && distSq < huntSq) {
          let falloff = radialFalloff(distSq, huntSq);
          if (otherBlank) {
            huntBlankX += ddx * falloff;
            huntBlankY += ddy * falloff;
            huntBlankN++;
          } else if (diffColor) {
            let preyCount = midiCount(o.targetMidi);
            let preyFrac = f32(preyCount) / max(1.0, u.quota);
            if (preyFrac >= u.preyAboveFrac && canStealFrom(myMidi, o.targetMidi, myCount, preyCount)) {
              huntPreyX += ddx * falloff;
              huntPreyY += ddy * falloff;
              huntPreyN++;
            }
          }
        }

        if (!playing && otherPlaying && o.targetMidi >= 0.0 && u.quota > 0.0 && distSq < huntSq) {
          let falloff = radialFalloff(distSq, huntSq);
          let groupCount = midiCount(o.targetMidi);
          if (f32(groupCount) < nearFloor) {
            let headroom = (u.quota - f32(groupCount)) / u.quota;
            let w = headroom * (0.15 + 0.85 * scarcity) * falloff;
            blankSeekX += ddx * w;
            blankSeekY += ddy * w;
            blankSeekW += w;
          }
        }

        if (diffColor) {
          let falloff = radialFalloff(distSq, sepDiffSq);
          if (falloff > 0.0) {
            let dist = sqrt(distSq);
            let minDist = u.sepRadiusDiff * 0.22;
            let softDist = max(dist, minDist);
            let invDist = 1.0 / softDist;
            let nx = ddx * invDist;
            let ny = ddy * invDist;
            let closeEase = dist / u.sepRadiusDiff;
            let radialW = falloff * (0.42 + 0.58 * closeEase);
            sepDiffRadX -= nx * radialW * invDist;
            sepDiffRadY -= ny * radialW * invDist;
            let latAmt = u.sepDiffLateral;
            if (latAmt > 0.0) {
              var lx: f32;
              var ly: f32;
              let spd = length(b.vel);
              if (spd > 0.05) {
                let side = b.vel.x * ddy - b.vel.y * ddx;
                let s = select(-1.0, 1.0, side >= 0.0);
                lx = -b.vel.y / spd * s;
                ly = b.vel.x / spd * s;
              } else {
                lx = -ny;
                ly = nx;
              }
              sepDiffLatX += lx * falloff * latAmt / softDist;
              sepDiffLatY += ly * falloff * latAmt / softDist;
            }
            diffN++;
          }
          continue;
        }

        if (sameNote) {
          let falloff = radialFalloff(distSq, sepSameSq);
          if (falloff > 0.0) {
            sepSameX -= (ddx / distSq) * falloff;
            sepSameY -= (ddy / distSq) * falloff;
            sameN++;
          }
        } else if (!(!playing && otherPlaying)) {
          // Dead boids do not repel lit — avoids ring pile-up at canvas edges.
          let falloff = radialFalloff(distSq, sepIdleSq);
          if (falloff > 0.0) {
            sepIdleX -= (ddx / distSq) * falloff;
            sepIdleY -= (ddy / distSq) * falloff;
            idleN++;
          }
        }

        // Lit same-note ribbons + loose dead-dead drift (repel-led, not tight clumps).
        let flockWith = (playing && sameNote) || (!playing && otherBlank);
        if (flockWith) {
          // Dead boids: no velocity-matching when already close — repel/separation only (prevents overlap ribbons).
          let deadMediumRange = playing || distSq >= sepIdleSq;
          if (deadMediumRange) {
            let aliFalloff = radialFalloff(distSq, aliSq);
            if (aliFalloff > 0.0) {
              aliX += o.vel.x * aliFalloff;
              aliY += o.vel.y * aliFalloff;
              aliN++;
            }
            let cohFalloff = radialFalloff(distSq, cohSq);
            if (cohFalloff > 0.0) {
              cohX += ddx * cohFalloff;
              cohY += ddy * cohFalloff;
              cohN++;
            }
          }
        }
      }
    }
  }

  var fx = 0.0;
  var fy = 0.0;

  if (sameN > 0u && !playing) {
    let sepMul = u.sepSame * gSep;
    let s = steer(sepSameX, sepSameY, b.vel, sepMul, maxForce, maxSp);
    fx += s.x; fy += s.y;
  }
  if (idleN > 0u) {
    let sepMul = u.sepIdle * gSep * select(u.blankSepIdleMul, u.sepAssignedIdleMul, playing);
    let s = steer(sepIdleX, sepIdleY, b.vel, sepMul, maxForce * select(0.45, 1.05, playing), maxSp);
    fx += s.x; fy += s.y;
  }
  if (aliN > 0u) {
    var aliMul = select(u.aliWeight * gAli * u.blankBlankAliMul, u.aliWeight * gAli * u.aliAssignedMul, playing);
    if (playing && diffN > 1u) {
      aliMul *= 1.0 - min(0.42, f32(diffN - 1u) * 0.11);
    }
    let s = steer(aliX, aliY, b.vel, aliMul, maxForce, maxSp);
    fx += s.x; fy += s.y;
  }
  if (cohN > 0u) {
    var cohMul = select(u.cohWeight * gCoh * u.blankBlankCohMul, u.cohWeight * gCoh * u.cohAssignedMul, playing);
    if (playing && diffN > 1u) {
      cohMul *= 1.0 - min(0.28, f32(diffN - 1u) * 0.07);
    }
    let s = steer(cohX, cohY, b.vel, cohMul, maxForce, maxSp);
    fx += s.x; fy += s.y;
  }
  if (blankRepelN > 0u) {
    let repelW = u.blankRepel * select(0.42, 1.05, playing);
    let s = steer(blankRepelX, blankRepelY, b.vel, repelW, maxForce * select(0.45, 1.25, playing), maxSp);
    fx += s.x; fy += s.y;
  }
  if (huntBlankN > 0u) {
    let s = steer(huntBlankX, huntBlankY, b.vel, u.huntBlankAttract * (0.35 + 0.65 * urgency), maxForce, maxSp);
    fx += s.x; fy += s.y;
  }
  if (huntPreyN > 0u) {
    let s = steer(huntPreyX, huntPreyY, b.vel, u.huntColorAttract * urgency, maxForce * 0.7, maxSp);
    fx += s.x; fy += s.y;
  }
  if (blankSeekW > 0.0) {
    let s = steer(blankSeekX, blankSeekY, b.vel, u.blankSeekAttract * (0.35 + 0.65 * scarcity) * 0.55, maxForce * 0.75, maxSp);
    fx += s.x; fy += s.y;
  }

  let needsSpacing = !playing && (blankRepelN > 0u || idleN > 0u);
  let blankCap = u.globalForceCapBlank * select(1.0, 1.45, needsSpacing);
  let globalCap = select(blankCap, u.globalForceCapLit, playing);
  let capped = limitForce(fx, fy, maxForce * globalCap);
  fx = capped.x;
  fy = capped.y;

  // Soft environment — guides motion but must not overpower color spacing.
  var windMaxF = 0.0;
  let windLane = select(u.windAffectsDead, u.windAffectsLit, playing);
  if (u.windEnabled > 0.5 && windLane > 0.5) {
    let ww = select(u.windForceIdle, u.windForce, playing);
    let w = windAt(b.pos);
    windMaxF = select(
      max(FIELD_FORCE_IDLE_CAP, u.windForceIdle * 1.05),
      min(u.windForce * 1.05, max(maxForce * 0.65, u.windForce * 0.55)),
      playing
    );
    let windPush = limitForce(w.x * ww, w.y * ww, windMaxF);
    fx += windPush.x; fy += windPush.y;
  }
  var centerMaxF = 0.0;
  let centerLane = select(u.centerAffectsDead, u.centerAffectsLit, playing);
  if (u.centerEnabled > 0.5 && centerLane > 0.5) {
    let bias = centerBias(b.pos);
    centerMaxF = select(
      u.centerStrength * 1.05,
      min(u.centerStrength * 1.05, maxForce * 0.7),
      playing
    );
    let centerPush = limitForce(bias.x, bias.y, centerMaxF);
    fx += centerPush.x; fy += centerPush.y;
  }

  // Color / spacing barriers AFTER wind+center so collisions beat environment.
  if (playing && diffN > 0u) {
    let crowd = min(1.0, f32(diffN - 1u) / 3.0);
    let radialScale = 1.0 - crowd * 0.58;
    let lateralScale = 1.0 + crowd * 1.05;
    let sepDiffX = sepDiffRadX * radialScale + sepDiffLatX * lateralScale;
    let sepDiffY = sepDiffRadY * radialScale + sepDiffLatY * lateralScale;
    let barrierBudget = max(max(maxForce * (1.75 + crowd * 0.35), windMaxF * 1.45), max(centerMaxF * 1.3, 0.24));
    let s = steer(sepDiffX, sepDiffY, b.vel, u.sepDiff * gSep * (1.0 + crowd * 0.12), barrierBudget, maxSp);
    fx += s.x; fy += s.y;
  }
  if (playing && sameN > 0u) {
    let sepMul = u.sepSame * gSep * u.sepAssignedSameMul;
    let s = steer(sepSameX, sepSameY, b.vel, sepMul, max(maxForce * 1.05, windMaxF * 0.85), maxSp);
    fx += s.x; fy += s.y;
  }

  // Chord pulse — applied last so global cap / wind cannot mute it.
  if (phase > 0.0) {
    let pulseBudget = maxForce * (2.4 + phase * 0.6);
    if (chordSepN > 0u) {
      let s = steer(chordSepX, chordSepY, b.vel, u.chordRepelSep * phase, pulseBudget, maxSp);
      fx += s.x; fy += s.y;
    }
    let ox = wrapDelta(b.pos.x - u.width * 0.5, u.width);
    let oy = wrapDelta(b.pos.y - u.height * 0.5, u.height);
    let dist = length(vec2f(ox, oy));
    if (dist > 0.5) {
      let s = steer(ox, oy, b.vel, u.chordRepelForce * phase, pulseBudget * 0.92, maxSp);
      fx += s.x; fy += s.y;
    }
  }

  let steps = u.deltaTime / FRAME_MS;
  var vx = b.vel.x + fx * steps;
  var vy = b.vel.y + fy * steps;
  let velBlend = select(u.steeringSmoothBlank, u.steeringSmoothPlaying, playing);
  vx = mix(b.vel.x, vx, velBlend);
  vy = mix(b.vel.y, vy, velBlend);
  var spd = length(vec2f(vx, vy));
  // Quadratic drag — soft asymptote at maxSp (more force needed to go faster).
  if (u.speedDrag > 0.0 && spd > 1e-6 && maxSp > 1e-6) {
    let ratio = spd / maxSp;
    let decay = 1.0 / (1.0 + u.speedDrag * ratio * ratio * steps);
    vx *= decay;
    vy *= decay;
    spd = length(vec2f(vx, vy));
    let softCap = maxSp * 1.6;
    if (spd > softCap) {
      vx = vx / spd * softCap;
      vy = vy / spd * softCap;
      spd = softCap;
    }
  } else if (spd > maxSp) {
    vx = vx / spd * maxSp;
    vy = vy / spd * maxSp;
    spd = maxSp;
  }
  if (spd > 0.0 && spd < minSp) {
    vx = vx / spd * minSp;
    vy = vy / spd * minSp;
  }

  b.pos.x = wrapPos(b.pos.x + vx * steps, u.width);
  b.pos.y = wrapPos(b.pos.y + vy * steps, u.height);
  b.vel = vec2f(vx, vy);

  boids[i] = b;
}
`;
