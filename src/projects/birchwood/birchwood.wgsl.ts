import { SHARED_UNIFORMS_WGSL } from "../../runtime/backend/shared-uniforms.ts";

/**
 * Birchwood — a dark stand of tall birches in rows that recede down an aisle.
 *
 * The owner's ask: a dark forest, birches tall and lined up in depth, with the sound on the
 * SHADOWS and the HIGHLIGHTS of the trees and on the BACKGROUND. So the shader exposes
 * exactly those three as gains the document drives, and holds everything else still:
 *
 *   highlight  the moonlight on the lit flank of each trunk, its rim and its sheen
 *   shadow     the cold fill on the dark flank and in the cast shadows (0 is pure black)
 *   glow       the mist glowing at the far end of the aisle, behind the silhouettes
 *   pulse      a band of light that runs from the eye down the rows into the dark; it sits
 *              at `pulseReach` with zero amplitude at rest, so a decaying envelope on it
 *              IS the travel (1 at the eye, 0 at the far end)
 *
 * GEOMETRY. One trunk per cell of an XZ grid (`laneSpacing` across, `rowSpacing` deep), the
 * camera walking down the cleared aisle at x = 0. A trunk is an infinite vertical cylinder,
 * so a hit is one quadratic — no sphere trace anywhere — and the ray walks the grid cell by
 * cell (Amanatides-Woo). A trunk is clamped to fit inside its own cell, so cell order IS hit
 * order and the first hit is the nearest. The camera is rebased onto its own row every frame
 * (the hash reads the absolute row, the arithmetic runs near the origin), so the walk never
 * loses precision. Cast shadows are a second, short grid walk toward the moon with a
 * penumbra that widens with distance.
 *
 * BARK. Birch is a white column with dark horizontal lenticels, dark blotches and a black,
 * fissured foot. All three are functions of the trunk's own surface coordinates (arc length
 * around it, height up it) and its hash, so they ride with the tree and never swim.
 *
 * Deterministic (§V44): `frameU.absTime` is the only clock; the grain is a hash of the
 * pixel and the frame index.
 */
export const BIRCHWOOD_WGSL = `${SHARED_UNIFORMS_WGSL}
struct Params {
  walkSpeed: f32,     // @default 0.35  metres a second the eye drifts down the aisle
  eyeHeight: f32,     // @default 1.6  the eye above the ground, metres
  pitch: f32,         // @default 6  degrees the view tilts up, toward the tall trunks
  lens: f32,          // @default 1.5  focal length: higher stacks the rows tighter
  laneSpacing: f32,   // @default 3.2  metres between the lines of trees, across the aisle
  rowSpacing: f32,    // @default 3.4  metres between trees along a line, into the depth
  aisle: f32,         // @default 1.4  half-width of the cleared path the eye walks down
  jitter: f32,        // @default 0.18  how far a tree strays from its line, 0 is a plantation
  density: f32,       // @default 0.82  share of grid positions that carry a tree
  trunkWidth: f32,    // @default 0.17  mean trunk radius, metres
  widthVary: f32,     // @default 0.5  how much radii differ tree to tree
  barkColor: vec4f,   // @default [0.86, 0.84, 0.78, 1]  the white bark
  markColor: vec4f,   // @default [0.035, 0.03, 0.028, 1]  the lenticels, blotches and the foot
  lenticels: f32,     // @default 1  how many dark horizontal dashes ring the bark
  blotches: f32,      // @default 0.55  how much of the bark carries dark patches
  groundColor: vec4f, // @default [0.16, 0.15, 0.13, 1]  the forest floor
  moonColor: vec4f,   // @default [0.6, 0.72, 1.0, 1]  the key light and every highlight
  moonAzimuth: f32,   // @default 105  degrees from the walk direction; past 90 the moon is BEHIND the rows and rims them
  moonHeight: f32,    // @default 24  the key light's elevation, degrees — lower is longer shadows
  highlight: f32,     // @default 1  AUDIO: the lit flank, rim and sheen of every trunk
  shadow: f32,        // @default 0.1  AUDIO: the fill in the shadows — 0 is black, 0.4 reads the bark in the dark
  shadowColor: vec4f, // @default [0.2, 0.25, 0.38, 1]  the colour the shadows open up into
  glow: f32,          // @default 0.6  AUDIO: the mist glowing at the end of the aisle
  glowColor: vec4f,   // @default [0.32, 0.42, 0.55, 1]  that mist
  glowHeight: f32,    // @default 0.08  where the glow sits above the horizon, as a direction slope
  pulse: f32,         // @default 0  AUDIO: 1 puts a band of light at the eye, 0 at pulseReach with no amplitude
  pulseReach: f32,    // @default 34  metres down the rows the pulse travels before it is gone
  pulseWidth: f32,    // @default 3.5  depth of the band, metres
  fog: f32,           // @default 0.055  haze density — distance into the dark
  mist: f32,          // @default 0.3  ground mist, over and above the haze
  mistHeight: f32,    // @default 0.9  metres over which the ground mist thins
  fogColor: vec4f,    // @default [0.012, 0.016, 0.026, 1]  the dark everything recedes into
  canopy: f32,        // @default 0.09  how fast the trunks and the sky go dark overhead, per metre
  veil: f32,          // @default 0.5  how much the input texture drifts through the glow
  grain: f32,         // @default 0.02  film grain
  vignette: f32,      // @default 0.6  corner falloff
  exposure: f32,      // @default 1  master gain
};

@group(0) @binding(0) var inputSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> frameU: SharedFrame;
@group(0) @binding(3) var<uniform> params: Params;

const PI: f32 = 3.14159265;
const MAX_CELLS: i32 = 48;
const SHADOW_CELLS: i32 = 10;
const BIG: f32 = 1.0e9;

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}
fn hash24(p: vec2f) -> vec4f {
  return vec4f(hash21(p), hash21(p + 17.17), hash21(p + 39.71), hash21(p + 71.03));
}
fn vnoise(x: vec2f) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
             mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(x: vec2f) -> f32 {
  return 0.55 * vnoise(x) + 0.3 * vnoise(x * 2.07 + 3.1) + 0.15 * vnoise(x * 4.13 + 7.7);
}

fn cellSize() -> vec2f {
  return vec2f(max(params.laneSpacing, 0.6), max(params.rowSpacing, 0.6));
}

/* The tree in a cell, in the eye's local frame: xy = centre (x, z), z = radius, w = seed.
   A radius below zero is no tree. 'rowBase' is the eye's absolute row; x is never rebased,
   because the eye only sways a little either side of the aisle. */
fn treeIn(cell: vec2i, rowBase: f32) -> vec4f {
  let s = cellSize();
  let cellAbs = vec2f(f32(cell.x), f32(cell.y) + rowBase);
  let h = hash24(cellAbs);
  let laneX = (cellAbs.x + 0.5) * s.x;
  if (abs(laneX) < params.aisle || h.x > clamp(params.density, 0.0, 1.0)) {
    return vec4f(0.0, 0.0, -1.0, 0.0);
  }
  let room = 0.5 * min(s.x, s.y) - 0.02;
  let r = min(max(params.trunkWidth, 0.02) * (1.0 + params.widthVary * (h.y - 0.5)), room * 0.8);
  let free = max(room - r, 0.0);
  let j = clamp(params.jitter, 0.0, 1.0);
  let off = vec2f((h.z - 0.5) * 2.0 * min(j, free), (h.w - 0.5) * 2.0 * min(j * 2.2, free));
  return vec4f((f32(cell.x) + 0.5) * s.x + off.x, (f32(cell.y) + 0.5) * s.y + off.y, r, hash21(cellAbs + 5.5));
}

/* Nearest root of the ray against an infinite vertical cylinder, in the ray's own t. */
fn cylinderT(o: vec2f, d: vec2f, c: vec2f, r: f32) -> f32 {
  let oc = o - c;
  let a = dot(d, d);
  if (a < 1.0e-8) { return -1.0; }
  let b = dot(oc, d);
  let k = dot(oc, oc) - r * r;
  let disc = b * b - a * k;
  if (disc < 0.0) { return -1.0; }
  return (-b - sqrt(disc)) / a;
}

struct Hit {
  t: f32,
  tree: vec4f,
};

fn marchTrees(o: vec3f, d: vec3f, rowBase: f32, maxT: f32) -> Hit {
  var hit: Hit;
  hit.t = BIG;
  hit.tree = vec4f(0.0, 0.0, -1.0, 0.0);
  let s = cellSize();
  let o2 = o.xz;
  let d2 = d.xz;
  var cell = vec2i(floor(o2 / s));
  let stepI = vec2i(select(-1, 1, d2.x > 0.0), select(-1, 1, d2.y > 0.0));
  let tDelta = vec2f(select(BIG, abs(s.x / d2.x), abs(d2.x) > 1.0e-6),
                     select(BIG, abs(s.y / d2.y), abs(d2.y) > 1.0e-6));
  let nextX = (f32(cell.x) + select(0.0, 1.0, d2.x > 0.0)) * s.x;
  let nextZ = (f32(cell.y) + select(0.0, 1.0, d2.y > 0.0)) * s.y;
  var tMax = vec2f(select(BIG, (nextX - o2.x) / d2.x, abs(d2.x) > 1.0e-6),
                   select(BIG, (nextZ - o2.y) / d2.y, abs(d2.y) > 1.0e-6));
  for (var i = 0; i < MAX_CELLS; i = i + 1) {
    let tree = treeIn(cell, rowBase);
    if (tree.z > 0.0) {
      let t = cylinderT(o2, d2, tree.xy, tree.z);
      if (t > 1.0e-3 && t < maxT) {
        hit.t = t;
        hit.tree = tree;
        return hit;
      }
    }
    if (min(tMax.x, tMax.y) > maxT) { break; }
    if (tMax.x < tMax.y) {
      tMax.x = tMax.x + tDelta.x;
      cell.x = cell.x + stepI.x;
    } else {
      tMax.y = tMax.y + tDelta.y;
      cell.y = cell.y + stepI.y;
    }
  }
  return hit;
}

/* Soft shadow toward the moon: every trunk the shadow ray passes near darkens the point by
   how close the ray came to its surface, over a penumbra that widens with distance. */
fn moonShadow(p: vec3f, l: vec3f, rowBase: f32) -> f32 {
  let s = cellSize();
  let o2 = p.xz;
  let d2 = l.xz;
  var cell = vec2i(floor(o2 / s));
  let stepI = vec2i(select(-1, 1, d2.x > 0.0), select(-1, 1, d2.y > 0.0));
  let tDelta = vec2f(select(BIG, abs(s.x / d2.x), abs(d2.x) > 1.0e-6),
                     select(BIG, abs(s.y / d2.y), abs(d2.y) > 1.0e-6));
  let nextX = (f32(cell.x) + select(0.0, 1.0, d2.x > 0.0)) * s.x;
  let nextZ = (f32(cell.y) + select(0.0, 1.0, d2.y > 0.0)) * s.y;
  var tMax = vec2f(select(BIG, (nextX - o2.x) / d2.x, abs(d2.x) > 1.0e-6),
                   select(BIG, (nextZ - o2.y) / d2.y, abs(d2.y) > 1.0e-6));
  let dd = max(dot(d2, d2), 1.0e-6);
  var lit = 1.0;
  for (var i = 0; i < SHADOW_CELLS; i = i + 1) {
    // The 3x3 around the walk, because a penumbra can reach a trunk one cell off the ray.
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let tree = treeIn(cell + vec2i(dx, 0), rowBase);
      if (tree.z > 0.0) {
        let oc = tree.xy - o2;
        let along = dot(oc, d2) / dd;
        if (along > 0.02) {
          let miss = length(oc - d2 * along);
          let pen = 0.02 + 0.05 * along * sqrt(dd);
          lit = min(lit, smoothstep(tree.z - pen, tree.z + pen, miss));
        }
      }
    }
    if (tMax.x < tMax.y) {
      tMax.x = tMax.x + tDelta.x;
      cell.x = cell.x + stepI.x;
    } else {
      tMax.y = tMax.y + tDelta.y;
      cell.y = cell.y + stepI.y;
    }
  }
  return lit;
}

/* The backdrop in a direction: dark overhead, the fog colour at the horizon, and the glow
   sitting low at the end of the aisle. Distant trunks fade INTO this, so they stand as
   silhouettes against the glow. */
fn backdrop(d: vec3f, veil: f32) -> vec3f {
  let up = d.y;
  var bg = params.fogColor.rgb * exp(-max(up, 0.0) * 3.0);
  let g = normalize(vec3f(0.0, params.glowHeight, 1.0));
  let core = pow(max(dot(d, g), 0.0), 18.0);
  let band = exp(-abs(up - params.glowHeight) * 9.0) * exp(-abs(d.x) * 2.2);
  let mistTex = mix(1.0, 0.35 + 1.3 * veil, clamp(params.veil, 0.0, 1.0));
  bg = bg + params.glowColor.rgb * max(params.glow, 0.0) * (0.9 * core + 0.35 * band) * mistTex;
  return bg;
}

/* Optical depth of an exponential layer of density k and scale height h along the ray. */
fn layerDepth(oy: f32, dy: f32, t: f32, k: f32, h: f32) -> f32 {
  let a = k * exp(-oy / h);
  if (abs(dy) < 1.0e-4) { return a * t; }
  return a * h * (1.0 - exp(-dy * t / h)) / dy;
}

fn barkMarks(u: f32, v: f32, seed: f32) -> f32 {
  // Lenticels: thin horizontal dashes on wavering rows, each a random length.
  let rowF = v * 11.0 + seed * 37.0 + (vnoise(vec2f(u * 1.3, v * 0.7 + seed * 9.0)) - 0.5) * 0.9;
  let row = floor(rowF);
  let fr = fract(rowF);
  let seg = floor(u * (2.5 + 2.0 * hash21(vec2f(row, seed))) + hash21(vec2f(seed, row)) * 9.0);
  let pick = hash21(vec2f(row * 1.7 + seed, seg));
  let thick = 0.04 + 0.1 * hash21(vec2f(seg, row + 3.0));
  let on = select(0.0, 1.0, pick < 0.42 * clamp(params.lenticels, 0.0, 2.0));
  let dash = on * (1.0 - smoothstep(thick * 0.5, thick, abs(fr - 0.5)));
  // Blotches: larger dark patches, stretched around the trunk.
  let b = fbm(vec2f(u * 0.9 + seed * 13.0, v * 3.2 - seed * 5.0));
  let blot = smoothstep(0.78 - 0.32 * clamp(params.blotches, 0.0, 1.0), 0.86 - 0.3 * clamp(params.blotches, 0.0, 1.0), b);
  // The foot: black, fissured bark creeping up the first metre or so.
  let footLine = 0.55 + 0.9 * vnoise(vec2f(u * 3.0, seed * 7.0));
  let fissure = vnoise(vec2f(u * 9.0, v * 1.8 + seed));
  let foot = smoothstep(footLine, footLine - 0.45, v) * (0.55 + 0.45 * fissure);
  return clamp(max(max(dash, blot), foot), 0.0, 1.0);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let veil = textureSample(inputTexture, inputSampler, uv).r;
  let aspect = frameU.resolution.x / max(frameU.resolution.y, 1.0);
  let q = (uv - vec2f(0.5)) * vec2f(aspect, -1.0) * 2.0;
  let time = frameU.absTime;

  // The walk, rebased onto the eye's own row.
  let s = cellSize();
  let walk = time * params.walkSpeed;
  let rowBase = floor(walk / s.y);
  let eyeX = 0.12 * sin(time * 0.071) + 0.05 * sin(time * 0.29);
  let o = vec3f(eyeX, params.eyeHeight + 0.02 * sin(time * 0.6), walk - rowBase * s.y);

  let pitch = params.pitch * PI / 180.0;
  let fwd = vec3f(0.0, sin(pitch), cos(pitch));
  // Looking down +z with +y up, screen right is -x.
  let right = vec3f(-1.0, 0.0, 0.0);
  let up = vec3f(0.0, cos(pitch), -sin(pitch));
  let d = normalize(fwd * max(params.lens, 0.2) + right * q.x + up * q.y);

  let az = params.moonAzimuth * PI / 180.0;
  let el = params.moonHeight * PI / 180.0;
  let l = normalize(vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el)));

  // Reach: where the haze has swallowed nearly everything.
  let reach = min(3.2 / max(params.fog, 0.01), 160.0);
  let tGround = select(BIG, -o.y / d.y, d.y < -1.0e-4);
  let maxT = min(tGround, reach);
  let hit = marchTrees(o, d, rowBase, maxT);

  let hl = max(params.highlight, 0.0);
  let fill = params.shadowColor.rgb * max(params.shadow, 0.0);
  var col = vec3f(0.0);
  var tHit = BIG;

  if (hit.t < BIG) {
    tHit = hit.t;
    let p = o + d * hit.t;
    let n = normalize(vec3f(p.x - hit.tree.x, 0.0, p.z - hit.tree.y));
    let ang = atan2(n.z, n.x);
    let u = ang * hit.tree.z * 6.0;
    let marks = barkMarks(u, p.y, hit.tree.w);
    let tone = 0.82 + 0.18 * vnoise(vec2f(u * 0.8, p.y * 0.4 + hit.tree.w * 20.0));
    let albedo = mix(params.barkColor.rgb * tone, params.markColor.rgb, marks);

    let ndl = dot(n, l);
    let sh = moonShadow(p, l, rowBase);
    let key = max(ndl, 0.0) * sh;
    // The rim: the edge of the trunk against a moon that is behind it.
    let facing = abs(dot(n, -d));
    let behind = clamp(-dot(d.xz, l.xz) * 0.5 + 0.5, 0.0, 1.0);
    let rim = pow(1.0 - facing, 3.0) * (0.35 + 0.65 * behind) * (0.4 + 0.6 * sh);
    let sheen = pow(max(dot(reflect(d, n), l), 0.0), 14.0) * sh * (1.0 - marks);
    let light = params.moonColor.rgb * hl * (pow(key, 0.7) * 1.6 + rim * 2.2 + sheen * 0.9);
    // The shadow flank opens up into the fill; the lit flank keeps a little of it too.
    let shade = fill * (0.35 + 0.65 * (1.0 - max(ndl, 0.0) * sh));
    col = albedo * (light + shade);
    // Contact: the foot sits in the litter, out of the light.
    col = col * mix(0.3, 1.0, smoothstep(0.0, 1.4, p.y));
    // Tall: the trunks run up into the dark of the canopy.
    col = col * exp(-max(p.y - 2.5, 0.0) * max(params.canopy, 0.0));
    // The pulse: a band of moonlight running down the rows.
    let bandAt = (1.0 - clamp(params.pulse, 0.0, 1.0)) * params.pulseReach;
    let band = exp(-pow((hit.t - bandAt) / max(params.pulseWidth, 0.1), 2.0)) * clamp(params.pulse, 0.0, 1.0);
    col = col + albedo * params.moonColor.rgb * band * (0.6 + 0.8 * max(ndl, 0.0) + rim);
  } else if (tGround < reach) {
    tHit = tGround;
    let p = o + d * tGround;
    let wz = p.z + rowBase * s.y;
    let litter = fbm(vec2f(p.x * 1.7, wz * 1.7)) * 0.7 + 0.3 * vnoise(vec2f(p.x * 9.0, wz * 9.0));
    let albedo = params.groundColor.rgb * (0.55 + 0.9 * litter);
    let sh = moonShadow(p, l, rowBase);
    let key = max(l.y, 0.0) * sh;
    // Contact: the ground darkens toward the foot of the nearest trunk.
    let near = treeIn(vec2i(floor(p.xz / s)), rowBase);
    let ao = select(1.0, mix(0.25, 1.0, smoothstep(near.z, near.z + 0.7, length(p.xz - near.xy))), near.z > 0.0);
    col = albedo * (params.moonColor.rgb * hl * key * 1.6 + fill * 0.5) * ao;
    let bandAt = (1.0 - clamp(params.pulse, 0.0, 1.0)) * params.pulseReach;
    let band = exp(-pow((tGround - bandAt) / max(params.pulseWidth, 0.1), 2.0)) * clamp(params.pulse, 0.0, 1.0);
    col = col + albedo * params.moonColor.rgb * band * 0.5;
  }

  // The air: plain haze plus mist pooled on the ground; both fade into the backdrop.
  let bg = backdrop(d, veil);
  // Every ray crosses the haze, sky rays included, so the horizon has no seam; what lies past
  // the reach (col is still zero there) is simply all mist.
  let tAir = min(min(tHit, tGround), reach * 3.0);
  let od = max(params.fog, 0.0) * tAir + layerDepth(o.y, d.y, tAir, max(params.mist, 0.0), max(params.mistHeight, 0.1));
  let trans = exp(-od);
  // The mist catches the moon and the fill, so it carries the highlight and shadow drives too.
  // It thins upward into the dark of the canopy.
  let haze = exp(-max(d.y, 0.0) * 5.0);
  let mistLit = bg + (params.moonColor.rgb * hl * 0.035 + fill * 0.18) * haze;
  col = col * trans + mistLit * (1.0 - trans);

  let vig = 1.0 - clamp(params.vignette, 0.0, 1.0) * pow(length(q / vec2f(aspect, 1.0)) * 0.72, 2.2);
  let grain = (hash21(uv * frameU.resolution + vec2f(frameU.frameIndex * 7.13, frameU.frameIndex * 3.71)) - 0.5) * params.grain;
  col = max(col * params.exposure * vig + vec3f(grain), vec3f(0.0));
  return vec4f(col, 1.0);
}
`;
