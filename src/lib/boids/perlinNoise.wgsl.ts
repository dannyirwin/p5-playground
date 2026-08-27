import { BOIDS_PERM_BASE } from './perlinPerm.ts';

function formatPermTable(): string {
	const doubled = [...BOIDS_PERM_BASE, ...BOIDS_PERM_BASE];
	const lines: string[] = [];
	for (let i = 0; i < doubled.length; i += 16) {
		const chunk = doubled.slice(i, i + 16).map((n) => `${n}u`).join(', ');
		lines.push(`  ${chunk},`);
	}
	return lines.join('\n');
}

/** WGSL Perlin noise — generated from `perlinPerm.ts` (keep in sync). */
export const PERLIN_NOISE_WGSL = /* wgsl */ `
const BOIDS_PERM: array<u32, 512> = array<u32, 512>(
${formatPermTable().replace(/,\s*$/, '')}
);

fn boidsFade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn boidsGrad3(h: u32, x: f32, y: f32, z: f32) -> f32 {
  let hh = h & 15u;
  var u: f32;
  var v: f32;
  if (hh < 8u) { u = x; } else { u = y; }
  if (hh < 4u) {
    v = y;
  } else if (hh == 12u || hh == 14u) {
    v = x;
  } else {
    v = z;
  }
  var res = u;
  if ((hh & 1u) != 0u) { res = -res; }
  var vv = v;
  if ((hh & 2u) != 0u) { vv = -vv; }
  return res + vv;
}

fn boidsPerm(i: u32) -> u32 {
  return BOIDS_PERM[i & 511u];
}

fn perlin3(x: f32, y: f32, z: f32) -> f32 {
  let xi = u32(i32(floor(x))) & 255u;
  let yi = u32(i32(floor(y))) & 255u;
  let zi = u32(i32(floor(z))) & 255u;
  let xf = x - floor(x);
  let yf = y - floor(y);
  let zf = z - floor(z);
  let u = boidsFade(xf);
  let v = boidsFade(yf);
  let w = boidsFade(zf);

  let a = boidsPerm(xi) + yi;
  let aa = boidsPerm(a) + zi;
  let ab = boidsPerm(a + 1u) + zi;
  let b = boidsPerm(xi + 1u) + yi;
  let ba = boidsPerm(b) + zi;
  let bb = boidsPerm(b + 1u) + zi;

  let x1 = mix(boidsGrad3(boidsPerm(aa), xf, yf, zf), boidsGrad3(boidsPerm(ba), xf - 1.0, yf, zf), u);
  let x2 = mix(boidsGrad3(boidsPerm(ab), xf, yf - 1.0, zf), boidsGrad3(boidsPerm(bb), xf - 1.0, yf - 1.0, zf), u);
  let y1 = mix(x1, x2, v);
  let x3 = mix(boidsGrad3(boidsPerm(aa + 1u), xf, yf, zf - 1.0), boidsGrad3(boidsPerm(ba + 1u), xf - 1.0, yf, zf - 1.0), u);
  let x4 = mix(boidsGrad3(boidsPerm(ab + 1u), xf, yf - 1.0, zf - 1.0), boidsGrad3(boidsPerm(bb + 1u), xf - 1.0, yf - 1.0, zf - 1.0), u);
  let y2 = mix(x3, x4, v);
  let value = mix(y1, y2, w);
  return (value + 1.0) * 0.5;
}
`;
