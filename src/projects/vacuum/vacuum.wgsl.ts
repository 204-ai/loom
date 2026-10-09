import { SHARED_UNIFORMS_WGSL } from "../../runtime/backend/shared-uniforms.ts";

/**
 * Vacuum — a small patch of quantum vacuum, in 3D, with spacetime warped by vector fields
 * and virtual particle pairs borrowing energy from it.
 *
 * One ray march. The eye moves INSIDE the patch on a camera rig (dolly, truck, pan, tilt,
 * orbit, roll, zoom, shake — see the camera block in fs and VACUUM_CAMERA_WGSL); haze (`fog`, `maxDist`) closes the view
 * down to a few lattice cells, which is the zoom.
 *
 * THE VECTOR FIELD. Six transverse plane waves: each one's direction of oscillation is
 * perpendicular to its wavevector, so the sum is exactly divergence-free — the shape of an
 * electromagnetic or gravitational wave, not a fluid's. The dispersion is Klein-Gordon,
 * ω = sqrt(k² + m²). Under it runs PLANCK FOAM (`FOAM_WGSL`): two octaves of noise whose
 * weight RISES as the scale shrinks, because the metric fluctuates harder the smaller
 * the region you look at (δg ~ ℓP/L).
 *
 * WARPING SPACETIME, two ways:
 *   warp  displaces the lattice's own coordinates by the field (w = x + warp·F), so the
 *         grid, the needles and the pairs all live in the WARPED coordinates and bend
 *         together;
 *   bend  turns every ray toward the field as it marches, so light itself is lensed —
 *         what lies behind a strong patch of field is seen displaced.
 *
 * WHAT IS DRAWN, all as emission integrated along the ray:
 *   the spacetime lattice  lines where two of the three warped coordinates are whole
 *   the field's needles    one short segment per glyph cell, along the field at that cell,
 *                          as long as the field is strong: iron filings in 3D
 *   the field's value      a faint glow of crest and trough (the scalar sum of the modes)
 *   the virtual pairs      in each pair cell, cycle after cycle, a pair may be borrowed
 *                          (`rate`) with energy E; Δt ≈ ħ/2ΔE, so heavier pairs live
 *                          shorter. They part along a HELIX around the magnetic axis —
 *                          opposite charges wind opposite ways, opposite momenta drift
 *                          opposite ways along it — and meet again where they were born,
 *                          annihilating in a flash and a shell. Virtual pairs never escape.
 *
 * IN TIME WITH THE MUSIC. `wgsl_onsets` keeps the last eight drum onsets in an 8×1 state
 * texture (inputTexture2): seconds since each, its birth share, its running index and its
 * pair energy. An onset lights a random share of the pair cells (`rate` × share), so pairs
 * are born ON the beat, all over the patch at once; the onset's energy follows its pitch —
 * a kick borrows low-energy pairs that live long and reach far, a hat high-energy ones that
 * flicker out (E = hν). Each onset also sends a WAVEFRONT through spacetime from a point
 * ahead of the eye: the lattice, the needles and the pairs ripple as it passes. With no
 * music the cells fall back on their own clocks at a low `idle` rate.
 *
 * PHOTONS. Packets of light shot down one direction in space (`photonAzimuth`,
 * `photonElevation`): space across the beam is tiled into lanes, each onset fires a packet
 * down a random share of them from behind the eye, and the packet runs at c
 * (`photonSpeed`). A packet is a Gaussian envelope with the field swinging across the path
 * inside it — the transverse wave a photon is — and its colour and wavelength follow its
 * onset's energy, E = hν: the kick's are red and long, the hat's violet and short. The lanes
 * live in the LATTICE's coordinates — the smooth field warp and the wavefronts, no foam —
 * so the beam bends with spacetime and ripples with every wavefront, but never jitters. A few lanes carry an idle train so light still crosses a silent vacuum.
 *
 * FERMIONS AND GLUONS. The pairs above are leptons — an electron and a positron, the
 * charged fermions a magnetic field winds. QUARKS are the other fermions: they carry
 * colour charge (red, green, blue; the antiquark the anticolour), born on snares. The
 * gluon field between a quark and its antiquark does not spread like a photon's but
 * squeezes into a flux tube, drawn as the Feynman curl, whose energy grows with its length
 * — so the pair cannot part for good. Stretched far enough the tube snaps and the energy
 * condenses a NEW quark–antiquark pair at the break: two colour-neutral mesons fly apart.
 * Confinement and hadronization, in about a second and a half — and then DECAY: each meson
 * is a neutral pion, π⁰ → γγ, vanishing into a vertex that throws two photons back to back.
 * Quarks and tubes ride the smooth lattice coordinates, like the photons.
 *
 * FEYNMAN DIAGRAMS. The decays are drawn in the notation of their own diagrams: fermions are
 * straight lines with arrows (an antiparticle's arrows run backward — a particle going back
 * in time), photons wavy, gluons curly, the W a zigzag, neutrinos faint and dotted, and every
 * interaction a VERTEX where three lines meet. The muon decay μ⁻ → νμ W⁻ → νμ e⁻ ν̄e (born
 * on hats) grows its diagram in space: track in, vertex, W, vertex, three lines out.
 *
 * BLACK HOLES. Rare singularities on a sparse grid of sites: one collapses into being, holds,
 * and evaporates by Hawking radiation, shrinking ever faster until it is gone. Near one the
 * march takes shorter steps; every ray is pulled toward it (gravitational lensing — an
 * Einstein ring round the hole), a ray that crosses the horizon is swallowed (the black
 * disk), and spacetime's coordinates are dragged in after it, so the lattice, the pairs and
 * the photons' lanes all funnel down into the hole. A thin, turning accretion disk glows
 * round it, brighter on the side that comes toward the eye.
 *
 * A pair stays inside its own cell (birthplace in the middle half, separation under a
 * third of a cell), so each march step looks up ONE pair cell and ONE glyph cell. A
 * particle is far thinner than a march step, so it is not integrated along the ray like
 * the lattice: each step takes the closest approach of its own ray segment to the
 * particle's track over the last frame (`segSeg`) and counts that once.
 *
 * Nothing within arm's reach of the eye emits (`near`): anything that close would fill
 * the screen as an out-of-focus smear and streak toward the vanishing point.
 *
 * Trails and denoising ride one feedback loop (`feedback_trails` → inputTexture1): each
 * frame is blended with the last (`trail`). The march start is jittered per pixel and per
 * frame, so the blend averages the step noise away instead of banding it; the max of the
 * 2D version would keep the brightest noise and smear the eye's drift into a zoom blur.
 *
 * Deterministic (§V44): `frameU.absTime` is the only clock.
 */

const HASH_WGSL = `
fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
`;

/**
 * PLANCK FOAM in 3D. Two octaves of value noise, the finer one heavier and faster
 * (a fluctuation lasts about as long as light takes to cross it); each octave slides
 * through its own direction in time so the foam boils rather than scrolls.
 */
const FOAM_WGSL = `
/// Three value-noise channels at once: each lattice corner's ONE hash33 supplies all three,
/// so a displacement costs eight hashes, not twenty-four.
fn vnoise3v(p: vec3f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash33(i), hash33(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let b = mix(hash33(i + vec3f(0.0, 1.0, 0.0)), hash33(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let c = mix(hash33(i + vec3f(0.0, 0.0, 1.0)), hash33(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let d = mix(hash33(i + vec3f(0.0, 1.0, 1.0)), hash33(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z) * 2.0 - vec3f(1.0);
}

fn planckFoam(x: vec3f, t: f32, amount: f32, scale: f32, rate: f32) -> vec3f {
  var disp = vec3f(0.0);
  let finest = max(scale, 0.005);
  for (var o = 0; o < 2; o = o + 1) {
    let len = finest * exp2(f32(1 - o));
    let flow = t * rate * exp2(f32(o) * 0.5) * select(vec3f(0.7, -0.4, 0.5), vec3f(-0.3, 0.6, 0.8), o == 1);
    let q = x / len + flow;
    let w = exp2(f32(o) * 0.6);
    disp = disp + vnoise3v(q) * len * w;
  }
  return disp * amount * 0.3;
}
`;

export const VACUUM_SPACE_WGSL = `${SHARED_UNIFORMS_WGSL}
struct Params {
  steps: f32,         // @default 64  march steps: more is smoother and slower (the cost is linear in them)
  maxDist: f32,       // @default 5  how far the eye sees into the patch
  sway: f32,          // @default 1.1  truck and pedestal: how far the eye swings side to side and up and down — the parallax
  lens: f32,          // @default 1.25  ZOOM, the focal length: higher zooms in further
  tilt: f32,          // @default 0  TILT, degrees the gaze is lifted (negative looks down)
  wander: f32,        // @default 1  how much the gaze drifts on its own, round the pan and tilt
  orbit: f32,         // @default 0.35  ORBIT: 0 turns the eye where it stands (pan), 1 swings it round a point focusDist ahead
  focusDist: f32,     // @default 2.2  how far ahead the orbit's pivot sits
  rollAngle: f32,     // @default 0  ROLL, degrees the horizon is turned, on top of the rig's turning roll
  shake: f32,         // @default 0  handheld SHAKE: how far the eye jolts, lattice units (audio drives it on the kick)
  warp: f32,          // @default 0.16  how far the vector field displaces spacetime's coordinates
  bend: f32,          // @default 0.03  how hard the field bends light rays (lensing)
  waveScale: f32,     // @default 1.4  wavenumber of the field's modes: higher is finer
  waveSpeed: f32,     // @default 0.35  how fast field time runs
  mass: f32,          // @default 1.5  m in ω = sqrt(k² + m²)
  planck: f32,        // @default 0  Planck foam (off by default: it is ~15% of the frame; 0 skips it entirely): how hard spacetime fluctuates at the finest scale
  planckScale: f32,   // @default 0.05  the finest foam octave, in lattice units
  planckRate: f32,    // @default 2.5  how fast the foam boils
  gridDensity: f32,   // @default 1  lattice lines per unit
  gridWidth: f32,     // @default 0.016  lattice line radius
  gridGlow: f32,      // @default 5  lattice brightness
  gridColor: vec4f,   // @default [0.42, 0.45, 0.95, 1]  the lattice close to the eye
  gridFarColor: vec4f, // @default [0.1, 0.16, 0.5, 1]  the lattice deep in the patch
  gridWarp: f32,      // @default 0.75  share of the field's warp the lattice takes: lower is a straighter grid
  gridFoam: f32,      // @default 0  share of the Planck foam the lattice and the photons take: 0 keeps spacetime smooth while the particles crinkle
  nodeGlow: f32,      // @default 8  brightness of the lattice's vertices, where three lines meet
  nodeSize: f32,      // @default 0.035  vertex radius
  glyphCell: f32,     // @default 0.55  spacing of the field's needles
  glyphLen: f32,      // @default 0.14  needle half-length at unit field strength
  glyphGlow: f32,     // @default 3  needle brightness
  glyphColor: vec4f,  // @default [0.45, 0.9, 0.8, 1]  the needles
  fieldGlow: f32,     // @default 0.012  the glow of the field's value
  crestColor: vec4f,  // @default [0.5, 0.2, 0.9, 1]  where the field swings positive
  troughColor: vec4f, // @default [0.1, 0.35, 0.8, 1]  where it swings negative
  rate: f32,          // @default 0.07  share of cells a full-strength onset lights with a pair
  idle: f32,          // @default 0.08  share of cycles in which a cell borrows a pair with no music at all
  musicLife: f32,     // @default 1.3  seconds a unit-energy pair born on an onset lives
  beatRipple: f32,    // @default 0.18  how far each onset's wavefront displaces spacetime
  rippleSpeed: f32,   // @default 2.2  how fast an onset's wavefront runs out, lattice units a second
  rippleLength: f32,  // @default 0.7  wavelength of an onset's wavefront
  energy: f32,        // @default 1  scales every pair's ΔE: higher lives shorter and reaches less far
  lifetime: f32,      // @default 2.4  seconds one cell's cycle lasts at unit energy
  pairCell: f32,      // @default 1.2  size of a pair cell, in lattice units
  bfield: f32,        // @default -4.08  magnetic field: radians a track winds round the axis over a life
  size: f32,          // @default 0.014  particle radius
  glow: f32,          // @default 2.5  particle brightness
  matterColor: vec4f, // @default [1.0, 0.5, 0.16, 1]  the particle
  antiColor: vec4f,   // @default [0.18, 0.72, 1.0, 1]  the antiparticle
  flashColor: vec4f,  // @default [0.9, 0.85, 1.0, 1]  the annihilation
  flash: f32,         // @default 0.4  brightness of the annihilation flash
  ripple: f32,        // @default 0.15  the shell the field rings with when a pair annihilates
  fog: f32,           // @default 0.45  haze density: what closes the view down to the patch
  fogColor: vec4f,    // @default [0.006, 0.005, 0.018, 1]  what everything recedes into
  trail: f32,         // @default 0.3  share of last frame blended into this one: trails, and the march noise averaged out
  exposure: f32,      // @default 1  master gain
  photonAzimuth: f32,   // @default 20  the beam's heading, degrees round the vertical (0 crosses the view left to right)
  photonElevation: f32, // @default 10  the beam's climb, degrees
  photonRate: f32,    // @default 0.07  share of lanes an onset fires a photon down, before the onset's share
  photonIdle: f32,    // @default 0.04  share of lanes that carry a photon train with no music at all
  laneSize: f32,      // @default 0.7  spacing of the photon lanes across the beam
  photonSpeed: f32,   // @default 3  c, in lattice units a second
  photonBack: f32,    // @default 5  how far behind the eye, along the beam, a photon sets off
  packetLength: f32,  // @default 0.3  length of a packet's envelope
  photonWave: f32,    // @default 0.07  wavelength of the field inside a packet
  photonAmp: f32,     // @default 0.02  how far the packet's core swings across its path: the transverse field
  photonWidth: f32,   // @default 0.007  core radius
  photonGlow: f32,    // @default 2.2  photon brightness
  quarkRate: f32,     // @default 0.35  share of quark cells a snare lights with a quark–antiquark pair (other onsets a third as often)
  quarkCell: f32,     // @default 1.8  size of a quark cell: room for the flux tube to stretch
  quarkLife: f32,     // @default 1.6  seconds from a quark pair's birth to its mesons fading
  quarkSize: f32,     // @default 0.018  quark radius
  quarkGlow: f32,     // @default 2.6  quark brightness
  gluonRadius: f32,   // @default 0.03  radius of the gluon coil round the flux tube
  gluonCoils: f32,    // @default 16  coils per unit of tube: the curl of the Feynman gluon
  gluonWidth: f32,    // @default 0.006  thickness of the coil's line
  gluonGlow: f32,     // @default 1.6  brightness of the gluon coil
  decayRate: f32,     // @default 0.3  share of decay cells a hat lights with a muon decay (other onsets a fifth as often)
  decayCell: f32,     // @default 2.2  size of a decay cell: room for the whole diagram
  decayLife: f32,     // @default 2  seconds a decay's diagram takes to draw itself and fade
  decayGlow: f32,     // @default 1.4  brightness of the decay diagrams
  leptonWidth: f32,   // @default 0.007  thickness of a fermion line
  neutrinoGlow: f32,  // @default 0.45  neutrinos barely interact, so their lines are faint
  vertexGlow: f32,    // @default 3  brightness of an interaction vertex
  bhRate: f32,        // @default 0.1  share of black-hole sites that hold a singularity in a given cycle: rare
  bhCell: f32,        // @default 5  spacing of the black-hole sites
  bhCycle: f32,       // @default 18  seconds from a hole's collapse to its last flash
  bhMass: f32,        // @default 0.3  the largest horizon radius (Schwarzschild radius), lattice units
  bhLens: f32,        // @default 1  how hard the holes bend light: Einstein rings
  bhPull: f32,        // @default 1  how far spacetime's lattice is dragged down into a hole
  diskGlow: f32,      // @default 0.6  brightness of the accretion disk
  diskColor: vec4f,   // @default [1.0, 0.45, 0.12, 1]  the disk's cooler outer plasma
  diskInner: f32,     // @default 2.4  the disk's inner edge, horizon radii
  diskOuter: f32,     // @default 6  the disk's outer edge, horizon radii
};

@group(0) @binding(0) var inputSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> frameU: SharedFrame;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var inputTexture1: texture_2d<f32>;
@group(0) @binding(5) var inputTexture2: texture_2d<f32>;
@group(0) @binding(6) var inputTexture3: texture_2d<f32>;
${HASH_WGSL}
${FOAM_WGSL}
const MODES: i32 = 6;
const ONSETS: i32 = 8;
const RIPPLES: i32 = 4;
const FLASH_SECONDS: f32 = 0.5;
const MAX_STEPS: i32 = 160;

fn segment(p: vec3f, a: vec3f, b: vec3f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  return length(p - a - ab * t);
}

/// Closest distance between segments p1..q1 and p2..q2 (Ericson, Real-Time Collision
/// Detection 5.1.9). The march uses it between ONE STEP of the ray and one frame of a
/// particle's track, so a particle far thinner than a step is never stepped over.
fn segSeg(p1: vec3f, q1: vec3f, p2: vec3f, q2: vec3f) -> f32 {
  let d1 = q1 - p1;
  let d2 = q2 - p2;
  let r = p1 - p2;
  let a = dot(d1, d1);
  let e = dot(d2, d2);
  let f = dot(d2, r);
  var s = 0.0;
  var t = 0.0;
  if (a <= 1e-9 && e <= 1e-9) { return length(r); }
  if (a <= 1e-9) {
    t = clamp(f / e, 0.0, 1.0);
  } else {
    let c = dot(d1, r);
    if (e <= 1e-9) {
      s = clamp(-c / a, 0.0, 1.0);
    } else {
      let b = dot(d1, d2);
      let denom = a * e - b * b;
      s = select(0.0, clamp((b * f - c * e) / denom, 0.0, 1.0), denom > 1e-9);
      t = (b * s + f) / e;
      if (t < 0.0) {
        t = 0.0;
        s = clamp(-c / a, 0.0, 1.0);
      } else if (t > 1.0) {
        t = 1.0;
        s = clamp((b - c) / a, 0.0, 1.0);
      }
    }
  }
  return length(p1 + d1 * s - (p2 + d2 * t));
}

/// Where the pair stands at life fraction s: the particle in .m, the antiparticle in .a.
struct Pair { m: vec3f, a: vec3f };

/// A photon's colour from its energy, E = hν: low energy red, through green, to violet.
fn photonColor(e: f32) -> vec3f {
  let t = clamp((e - 0.9) / 2.1, 0.0, 1.0);
  let red = vec3f(1.0, 0.22, 0.08);
  let yellow = vec3f(1.0, 0.85, 0.25);
  let green = vec3f(0.3, 1.0, 0.45);
  let violet = vec3f(0.55, 0.35, 1.0);
  if (t < 0.33) { return mix(red, yellow, t / 0.33); }
  if (t < 0.66) { return mix(yellow, green, (t - 0.33) / 0.33); }
  return mix(green, violet, (t - 0.66) / 0.34);
}

/// One of the camera rig's integrated values, stored split in three exact halves.
fn rigValue(j: i32) -> f32 {
  let t = textureLoad(inputTexture3, vec2i(j, 0), 0);
  return t.r + t.g + t.b;
}

/// The colour charges: red, green, blue; an antiquark carries the anticolour.
fn colourCharge(i: f32) -> vec3f {
  if (i < 1.0) { return vec3f(1.0, 0.18, 0.15); }
  if (i < 2.0) { return vec3f(0.2, 1.0, 0.3); }
  return vec3f(0.25, 0.4, 1.0);
}

fn anticolour(i: f32) -> vec3f {
  return vec3f(1.0) - colourCharge(i) * 0.75;
}

/// The ray step w..wEnd against the axis a..b: (where along the axis 0..1, the step's
/// closest point minus the axis point there).
struct AxisHit { t: f32, perp: vec3f };

fn axisHit(w: vec3f, wEnd: vec3f, a: vec3f, b: vec3f) -> AxisHit {
  let d1 = wEnd - w;
  let d2 = b - a;
  let r = w - a;
  let aa = dot(d1, d1);
  let ee = dot(d2, d2);
  let bb = dot(d1, d2);
  let cc = dot(d1, r);
  let ff = dot(d2, r);
  let denom = aa * ee - bb * bb;
  var s = select(0.0, clamp((bb * ff - cc * ee) / denom, 0.0, 1.0), denom > 1e-9);
  var t = (bb * s + ff) / max(ee, 1e-9);
  t = clamp(t, 0.0, 1.0);
  s = clamp((dot(a + d2 * t - w, d1)) / max(aa, 1e-9), 0.0, 1.0);
  var out: AxisHit;
  out.t = t;
  out.perp = (w + d1 * s) - (a + d2 * t);
  return out;
}

/// A gluon between a and b: a coil round the flux tube (the Feynman curl), running along it,
/// its brightness the same per unit length however far the tube is stretched — the linear
/// potential of confinement.
fn gluon(w: vec3f, wEnd: vec3f, a: vec3f, b: vec3f, t: f32, phase: f32) -> f32 {
  let len = length(b - a);
  if (len < 1e-3) { return 0.0; }
  let ax = (b - a) / len;
  let h = axisHit(w, wEnd, a, b);
  let r = params.gluonRadius;
  if (length(h.perp) > r * 4.0) { return 0.0; }
  let e1 = normalize(cross(ax, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(ax.y) > 0.9)));
  let e2 = cross(ax, e1);
  let ang = h.t * len * params.gluonCoils * 6.2831853 - phase;
  let coil = r * (cos(ang) * e1 + sin(ang) * e2);
  let d = length(h.perp - coil) / max(params.gluonWidth, 0.001);
  // The tube itself, faint, and the coil on it; both fade into the quarks at the ends.
  let tube = exp(-dot(h.perp, h.perp) / (r * r)) * 0.15;
  let ends = smoothstep(0.0, 0.08, h.t) * smoothstep(0.0, 0.08, 1.0 - h.t);
  return (exp(-d * d) + tube) * ends;
}

/// The black hole at one site, if the site holds one now: centre and horizon radius (0 for
/// none). It COLLAPSES into being over the first tenth of the cycle, holds, and from 60%
/// EVAPORATES by Hawking radiation — a hole's mass falls as (1 - t/T)^(1/3), slowly and then
/// all at once — ending in a flash at the end of the cycle.
fn blackHole(cell: vec3f, time: f32, size: f32) -> vec4f {
  let cyc = max(params.bhCycle, 2.0);
  let offset = hash33(cell * 0.71 + vec3f(5.5, 1.1, 9.3)).x * cyc;
  let local = time + offset;
  let k = floor(local / cyc);
  let s = (local - k * cyc) / cyc;
  let h = hash33(cell * 1.13 + vec3f(k * 3.3, k * 7.1, k * 1.9) + vec3f(222.0));
  if (h.x >= params.bhRate) { return vec4f(0.0); }
  let centre = (cell + vec3f(0.5) + (h - vec3f(0.5)) * 0.4) * size;
  let mass = params.bhMass * (0.6 + 0.4 * h.y);
  let formed = smoothstep(0.0, 0.1, s);
  let evap = select(1.0, pow(max(1.0 - (s - 0.6) / 0.4, 0.0), 1.0 / 3.0), s > 0.6);
  return vec4f(centre, mass * formed * evap);
}

/// A direction from a hash, uniform on the sphere.
fn randomDir(h: vec3f) -> vec3f {
  let th = fract(h.x) * 6.2831853;
  let z = fract(h.y) * 2.0 - 1.0;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(th), z, r * sin(th));
}

/// A Feynman vertex: a bright point the ray step passes.
fn vertexDot(v: vec3f, w: vec3f, wEnd: vec3f) -> f32 {
  let d = segment(v, w, wEnd) / 0.022;
  return exp(-d * d) + 0.1 / (1.0 + d * d);
}

/// A fermion line a → b (b is the head): solid, brightest at the head, with arrows — dashes
/// marching toward the head for a particle (arrow 1) and toward the tail for an
/// antiparticle (arrow -1), Feynman's antiparticle running backward in time.
fn fermionLine(w: vec3f, wEnd: vec3f, a: vec3f, b: vec3f, width: f32, arrow: f32) -> f32 {
  let len = length(b - a);
  if (len < 1e-3) { return 0.0; }
  let h = axisHit(w, wEnd, a, b);
  let d = length(h.perp) / max(width, 0.001);
  if (d > 12.0) { return 0.0; }
  let along = h.t * len;
  let p = fract(along * 9.0 - arrow * frameU.absTime * 2.5);
  let chevron = 0.45 + 0.55 * smoothstep(0.0, 0.2, p) * (1.0 - smoothstep(0.2, 0.55, p));
  return (exp(-d * d) + 0.05 / (1.0 + d * d)) * chevron * mix(0.35, 1.0, h.t);
}

/// A neutrino line: dotted and faint, its dots marching like a fermion's arrows.
fn neutrinoLine(w: vec3f, wEnd: vec3f, a: vec3f, b: vec3f, arrow: f32) -> f32 {
  let len = length(b - a);
  if (len < 1e-3) { return 0.0; }
  let h = axisHit(w, wEnd, a, b);
  let d = length(h.perp) / 0.004;
  if (d > 10.0) { return 0.0; }
  let p = fract(h.t * len * 16.0 - arrow * frameU.absTime * 2.5);
  return exp(-d * d) * step(p, 0.35);
}

/// A W boson line: a short zigzag, the weak force's carrier.
fn wLine(w: vec3f, wEnd: vec3f, a: vec3f, b: vec3f) -> f32 {
  let len = length(b - a);
  if (len < 1e-3) { return 0.0; }
  let ax = (b - a) / len;
  let h = axisHit(w, wEnd, a, b);
  let e1 = normalize(cross(ax, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(ax.y) > 0.9)));
  let zig = abs(fract(h.t * 5.0) * 2.0 - 1.0) * 2.0 - 1.0;
  let d = length(h.perp - e1 * zig * len * 0.18) / 0.005;
  return exp(-d * d);
}

/// One photon packet seen from one ray step: envelope along the lane, the transverse
/// field's swing across it, brightest where the field peaks. u is the closest point's
/// position along the lane relative to the packet's centre; perp its offset from the lane.
fn packet(u: f32, perp: vec3f, pol: vec3f, len: f32, wave: f32, amp: f32, width: f32) -> f32 {
  let env = exp(-u * u / (len * len));
  if (env < 0.01) { return 0.0; }
  let phase = u * 6.2831853 / max(wave, 0.005);
  let off = perp - pol * amp * env * sin(phase);
  let d = length(off) / width;
  return env * (exp(-d * d) + 0.06 / (1.0 + d * d)) * (0.55 + 0.45 * cos(phase) * cos(phase));
}

fn pairAt(born: vec3f, s: f32, sep0: f32, theta: f32, wind: f32, axial: f32, axis: vec3f, e1: vec3f, e2: vec3f) -> Pair {
  let sc = clamp(s, 0.0, 1.0);
  let reach = sep0 * pow(sin(3.14159265 * sc), 0.8);
  let along = axial * sin(3.14159265 * sc);
  let pm = theta + wind * sc;
  let pa = theta + 3.14159265 - wind * sc;
  var out: Pair;
  out.m = born + reach * (cos(pm) * e1 + sin(pm) * e2) + along * axis;
  out.a = born + reach * (cos(pa) * e1 + sin(pa) * e2) - along * axis;
  return out;
}

/// A pair of photons leaving m back to back along ±dir, since seconds after the vertex:
/// two wave packets on one line, at c.
fn photonPair(w: vec3f, wEnd: vec3f, m: vec3f, dir: vec3f, since: f32) -> vec3f {
  let reachL = 4.0;
  let h = axisHit(w, wEnd, m - dir * reachL, m + dir * reachL);
  let wid = params.photonWidth;
  if (length(h.perp) > wid * 12.0 + params.photonAmp * 2.0) { return vec3f(0.0); }
  let along = (h.t * 2.0 - 1.0) * reachL;
  let headAt = since * params.photonSpeed;
  let pol = normalize(cross(dir, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.9)));
  let len = params.packetLength * 0.7;
  let wave = params.photonWave * 0.6;
  let lightOut = packet(along - headAt, h.perp, pol, len, wave, params.photonAmp, wid)
    + packet(along + headAt, h.perp, pol, len, wave, params.photonAmp, wid);
  return vec3f(1.0, 0.92, 0.6) * lightOut * params.photonGlow * exp(-since * 0.8);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = frameU.resolution.x / max(frameU.resolution.y, 1.0);
  let q = (uv - vec2f(0.5)) * vec2f(aspect, -1.0) * 2.0;
  let time = frameU.absTime;

  // THE CAMERA. wgsl_camera integrates the rig's moving parts (inputTexture3): the pan,
  // the roll and the orbit angles and the dolly's distance, so the music can speed a move
  // up or slow it down without the shot jumping. Here they become an eye and a gaze:
  //   dolly          forward along +z by the integrated distance
  //   truck/pedestal the sway: wide and slow, so near and far layers slide across each other
  //   pan / tilt     the gaze turns by the pan angle and lifts by tilt, plus a slow wander
  //   orbit          instead of turning where it stands, the eye swings round a pivot
  //                  focusDist ahead — orbit blends between the two
  //   roll           the horizon turns by the integrated roll plus rollAngle
  //   zoom           the focal length
  //   shake          a jolt, scaled by the kick
  let panPhase = rigValue(0);
  let rollPhase = rigValue(1);
  let orbitPhase = rigValue(2);
  let dolly = rigValue(3);
  let wanderYaw = params.wander * 0.5 * sin(time * 0.031);
  let pitch = radians(params.tilt) + params.wander * 0.25 * sin(time * 0.043 + 0.7);
  let base = vec3f(params.sway * sin(time * 0.083), params.sway * 0.6 * sin(time * 0.061 + 1.0), dolly);
  // The gaze before the orbit: pan plus wander.
  let yawFree = panPhase + wanderYaw;
  let fwdFree = normalize(vec3f(sin(yawFree) * cos(pitch), sin(pitch), cos(yawFree) * cos(pitch)));
  // The orbit swings eye and gaze together round the pivot ahead.
  let yawOrbit = yawFree + orbitPhase;
  let fwd = normalize(vec3f(sin(yawOrbit) * cos(pitch), sin(pitch), cos(yawOrbit) * cos(pitch)));
  let pivot = base + fwdFree * params.focusDist;
  let shakeAt = vec3f(sin(time * 37.0), sin(time * 41.0 + 1.3), sin(time * 29.0 + 2.1)) * params.shake;
  let ro = mix(base, pivot - fwd * params.focusDist, clamp(params.orbit, 0.0, 1.0)) + shakeAt;
  let rollTotal = rollPhase + radians(params.rollAngle);
  let right0 = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up0 = cross(fwd, right0);
  let right = right0 * cos(rollTotal) + up0 * sin(rollTotal);
  let up = cross(fwd, right);
  var rd = normalize(q.x * right + q.y * up + params.lens * fwd);

  // The modes, once per pixel: wavevector + phase, polarisation ⟂ k (scaled 1/sqrt(k)) + ω.
  var ks: array<vec4f, 6>;
  var us: array<vec4f, 6>;
  for (var i = 0; i < MODES; i = i + 1) {
    let h = hash33(vec3f(f32(i) * 7.1, 3.3, 11.7));
    let h2 = hash33(vec3f(f32(i) * 3.7, 19.1, 2.9));
    let kd = normalize(h * 2.0 - vec3f(1.0) + vec3f(0.0, 0.0, 0.001));
    let kmag = params.waveScale * (0.6 + 1.4 * h2.x);
    let other = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(kd.x) > 0.8);
    let pol = normalize(cross(kd, other));
    let omega = sqrt(kmag * kmag + params.mass * params.mass) * params.waveSpeed;
    ks[i] = vec4f(kd * kmag, h2.y * 6.2831853);
    us[i] = vec4f(pol / sqrt(kmag), omega);
  }

  // The last eight onsets, newest first (wgsl_onsets): age s, birth share, index, energy.
  var onsets: array<vec4f, 8>;
  for (var j = 0; j < ONSETS; j = j + 1) {
    onsets[j] = textureLoad(inputTexture2, vec2i(j, 0), 0);
  }
  // Where each of the newest onsets' wavefronts starts: ahead of the eye, scattered.
  var sources: array<vec3f, 4>;
  for (var j = 0; j < RIPPLES; j = j + 1) {
    let hs = hash33(vec3f(onsets[j].b * 1.7, 9.1, 4.3)) - vec3f(0.5);
    sources[j] = ro + fwd * (1.8 + 1.5 * (hs.z + 0.5)) + right * hs.x * 2.5 + up * hs.y * 1.6;
  }

  // The photon beam: its direction, the plane across it the lanes tile, the eye's place on it.
  let az = radians(params.photonAzimuth);
  let el = radians(params.photonElevation);
  let beam = vec3f(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  let across1 = normalize(cross(beam, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(beam.y) > 0.9)));
  let across2 = cross(beam, across1);
  let launch = dot(ro, beam) - params.photonBack;
  let lane = max(params.laneSize, 0.1);

  // The magnetic axis and its perpendicular basis, for the helices.
  let axis = normalize(vec3f(0.25, 1.0, 0.15));
  let e1 = normalize(cross(axis, vec3f(1.0, 0.0, 0.0)));
  let e2 = cross(axis, e1);

  let steps = clamp(i32(params.steps), 8, MAX_STEPS);
  let marchLen = max(params.maxDist, 0.5);
  let stepLen = marchLen / f32(steps);
  let bhc = max(params.bhCell, 1.0);
  // The black holes this pixel's ray can meet: every site within reach of the eye, looked up
  // ONCE here (they are rare, so the list is almost always empty and the march pays nothing).
  var holes: array<vec4f, 4>;
  var holeAxes: array<vec3f, 4>;
  var holeCount = 0;
  let eyeCell = floor(ro / bhc);
  for (var c = 0; c < 27; c = c + 1) {
    if (holeCount >= 4) { break; }
    let cell = eyeCell + vec3f(f32(c % 3) - 1.0, f32((c / 3) % 3) - 1.0, f32(c / 9) - 1.0);
    let bh = blackHole(cell, time, bhc);
    if (bh.w <= 0.0) { continue; }
    // The eye never falls in: a hole the eye comes too close to fades rather than black
    // out the screen.
    let rs = bh.w * smoothstep(bh.w * 1.5, bh.w * 5.0, length(ro - bh.xyz));
    if (rs <= 0.001) { continue; }
    holes[holeCount] = vec4f(bh.xyz, rs);
    holeAxes[holeCount] = randomDir(hash33(cell + vec3f(3.1, 7.7, 1.3)));
    holeCount = holeCount + 1;
  }
  let jitter = fract(hash21(uv * frameU.resolution + vec2f(frameU.frameIndex * 7.13, frameU.frameIndex * 3.71))
    + textureSample(inputTexture, inputSampler, uv).r);
  var x = ro + rd * stepLen * jitter;
  var travelled = stepLen * jitter;

  let energy = max(params.energy, 0.05);
  let cycle = max(params.lifetime, 0.05) / energy;
  let pc = max(params.pairCell, 0.1);
  let gc = max(params.glyphCell, 0.05);
  let gridF = max(params.gridDensity, 0.05);
  let dt = clamp(frameU.deltaTime, 0.0, 0.1);

  var col = vec3f(0.0);
  var trans = 1.0;
  for (var n = 0; n < MAX_STEPS; n = n + 1) {
    if (travelled >= marchLen || trans < 0.02) { break; }

    // BLACK HOLES: the pull on this point of the holes found round the eye. The step shrinks near a
    // horizon so the bending stays smooth; a ray that crosses one is gone.
    var pull = vec3f(0.0);
    var hstep = stepLen;
    var swallowed = false;
    var nearestBH = vec4f(0.0, 0.0, 0.0, 0.0);
    var nearestAxis = vec3f(0.0, 1.0, 0.0);
    var nearestR = 1e9;
    for (var c = 0; c < holeCount; c = c + 1) {
      let bh = holes[c];
      let rs = bh.w;
      let off = x - bh.xyz;
      let r = length(off);
      if (r < rs) { swallowed = true; }
      pull = pull - off / max(r, 1e-4) * rs / max(r * r, rs * rs);
      hstep = min(hstep, max(0.3 * (r - rs), 0.012));
      if (r / rs < nearestR) {
        nearestR = r / rs;
        nearestBH = bh;
        nearestAxis = holeAxes[c];
      }
    }
    if (swallowed) {
      trans = 0.0;
      break;
    }

    // The field at x: the waves, then the foam, displace spacetime's coordinates.
    var field = vec3f(0.0);
    var phi = 0.0;
    for (var i = 0; i < MODES; i = i + 1) {
      let arg = dot(ks[i].xyz, x) - us[i].w * time + ks[i].w;
      field = field + us[i].xyz * sin(arg);
      phi = phi + cos(arg) / sqrt(length(ks[i].xyz));
    }
    var foam = vec3f(0.0);
    if (params.planck > 0.0) {
      foam = planckFoam(x, time, params.planck, params.planckScale, params.planckRate);
    }
    // Each onset sends a wavefront through spacetime: a shell running out from its source at
    // rippleSpeed, a few wavelengths thick, fading as it goes. Low-energy hits (the kick)
    // ripple hardest.
    var beat = vec3f(0.0);
    for (var j = 0; j < RIPPLES; j = j + 1) {
      let o = onsets[j];
      if (o.g <= 0.0) { continue; }
      let off = x - sources[j];
      let d = length(off);
      let front = d - o.r * params.rippleSpeed;
      let packet = exp(-front * front / (params.rippleLength * params.rippleLength * 1.5)) * exp(-o.r * 1.2);
      beat = beat + off / max(d, 1e-3) * sin(front * 6.2831853 / max(params.rippleLength, 0.05)) * packet * o.g / o.a;
    }
    // Spacetime falls into the holes: the funnel displaces every coordinate toward them.
    let funnel = pull * params.bhPull * 0.05;
    let w = x + params.warp * field + foam + params.beatRipple * beat + funnel;

    var emit = vec3f(0.0);
    // Point emitters, counted once per crossing; the end of this step in warped space.
    var hit = vec3f(0.0);
    let wEnd = w + rd * hstep;
    let near = smoothstep(0.5, 1.4, travelled);

    // The lattice has its OWN coordinates: the smooth field warp (gridWarp of it) and the
    // onsets' wavefronts, and none of the foam by default — so it reads as one consistent,
    // gently curved space with depth, while the particles and needles crinkle in the foam.
    // The photons run in these same coordinates: light follows the smooth curvature of
    // spacetime, never the foam, so its paths bend without turbulence.
    let wg = x + params.warp * params.gridWarp * field + foam * params.gridFoam + params.beatRipple * beat + funnel;
    // Lines where two of the three lattice coordinates are whole. A ray running ALONG a line
    // would sit inside it for its whole length and streak toward the vanishing point, so
    // each axis's lines are weighted by how squarely the ray crosses them.
    let g = abs(fract(wg * gridF + vec3f(0.5)) - vec3f(0.5)) / gridF;
    let lw = max(params.gridWidth, 0.002);
    let cross3 = vec3f(1.0) - rd * rd;
    let lines = cross3.x * exp(-dot(g.yz, g.yz) / (lw * lw))
      + cross3.y * exp(-dot(g.xz, g.xz) / (lw * lw))
      + cross3.z * exp(-dot(g.xy, g.xy) / (lw * lw));
    // The vertices, where three lines meet: points the eye can hold on to, so the layers'
    // parallax reads. Near is warm, deep is cool.
    let ns = max(params.nodeSize, 0.005);
    let vertex = exp(-dot(g, g) / (ns * ns));
    let depthTint = mix(params.gridColor.rgb, params.gridFarColor.rgb, smoothstep(1.0, max(params.maxDist, 1.5) * 0.8, travelled));
    emit = emit + depthTint * (params.gridGlow * lines * (0.55 + 0.45 * clamp(length(field), 0.0, 2.0)) + params.nodeGlow * vertex);

    // The needles: one per glyph cell, along the waves at the cell's centre, brighter at the head.
    let gcell = floor(w / gc);
    let gcen = (gcell + vec3f(0.5)) * gc;
    var gfield = vec3f(0.0);
    for (var i = 0; i < MODES; i = i + 1) {
      gfield = gfield + us[i].xyz * sin(dot(ks[i].xyz, gcen) - us[i].w * time + ks[i].w);
    }
    let half = gfield * params.glyphLen;
    let needle = segment(w, gcen - half, gcen + half);
    let head = clamp(dot(w - gcen, half) / max(dot(half, half), 1e-6) * 0.5 + 0.5, 0.0, 1.0);
    let nw = lw * 0.6;
    emit = emit + params.glyphColor.rgb * params.glyphGlow * exp(-needle * needle / (nw * nw)) * (0.3 + 0.7 * head);

    // The field's value as a faint glow.
    emit = emit + params.fieldGlow * (params.crestColor.rgb * max(phi, 0.0) + params.troughColor.rgb * max(-phi, 0.0));

    // The pair in this cell. MUSIC first: the most recent onset that lit this cell (a lit
    // cell keeps that pair; older onsets never overlap it). Otherwise the IDLE vacuum: the
    // cell's own clock, at a low rate, so silence still fluctuates.
    let cid = floor(w / pc);
    var lit = false;
    var e = 1.0;
    var life = 1.0;
    var age = -1.0;
    var h2 = vec3f(0.0);
    for (var j = 0; j < ONSETS; j = j + 1) {
      let o = onsets[j];
      if (o.g <= 0.0) { continue; }
      let hj = hash33(cid * 1.37 + vec3f(o.b * 7.3, o.b * 1.9, o.b * 3.1));
      if (hj.x < params.rate * o.g) {
        lit = true;
        e = o.a * (0.8 + 0.4 * hj.y) * energy;
        life = params.musicLife / e;
        age = o.r;
        h2 = hash33(cid * 2.11 + vec3f(o.b * 3.7, o.b * 5.3, o.b * 0.7) + vec3f(91.0, 37.0, 11.0));
        break;
      }
    }
    if (!lit) {
      let offset = hash33(cid + vec3f(17.0, 5.0, 3.0)).x * cycle;
      let local = time + offset;
      let k = floor(local / cycle);
      let tau = local - k * cycle;
      let h = hash33(cid * 1.37 + vec3f(k * 7.3, k * 1.9, k * 3.1) + vec3f(400.0));
      if (h.x < params.idle) {
        lit = true;
        e = (1.0 + 1.5 * h.y) * energy;
        life = cycle * 0.5 / (1.0 + 1.5 * h.y);
        h2 = hash33(cid * 2.11 + vec3f(k * 3.7, k * 5.3, k * 0.7) + vec3f(491.0, 37.0, 11.0));
        age = tau - h.z * (cycle - life - FLASH_SECONDS / energy);
      }
    }
    if (lit && age >= 0.0) {
      let born = (cid + vec3f(0.25) + 0.5 * h2) * pc;
      let sep0 = pc * 0.3 / max(e, 0.5);
      let r = max(params.size, 0.001);
      let flashLen = FLASH_SECONDS / max(e, 0.5);
      if (age < life) {
        let s = age / life;
        let theta = h2.x * 6.2831853;
        let wind = params.bfield * (0.6 + 0.8 * h2.y);
        let axial = sep0 * (h2.z * 2.0 - 1.0) * 0.8;
        let now = pairAt(born, s, sep0, theta, wind, axial, axis, e1, e2);
        let before = pairAt(born, s - dt / life, sep0, theta, wind, axial, axis, e1, e2);
        // A pair born on a beat condenses fast: a twentieth of its life.
        let fade = smoothstep(0.0, 0.05, s) * params.glow * (0.7 + 0.3 * e) * near;
        // Per crossing, not per length: the closest approach of this ray step to the track.
        let dm = segSeg(w, wEnd, before.m, now.m) / r;
        let da = segSeg(w, wEnd, before.a, now.a) / r;
        hit = hit + params.matterColor.rgb * (exp(-dm * dm) + 0.08 / (1.0 + dm * dm)) * fade;
        hit = hit + params.antiColor.rgb * (exp(-da * da) + 0.08 / (1.0 + da * da)) * fade;
      } else {
        let u = (age - life) / flashLen;
        if (u < 1.0) {
          let d = length(w - born);
          let db = segment(born, w, wEnd) / (r * (1.5 + e));
          hit = hit + params.flashColor.rgb * exp(-u * 10.0) * (exp(-db * db) + 0.15 / (1.0 + db * db)) * params.flash * e * near;
          let shell = exp(-pow((d - u * pc * 0.4) / (r * 0.6), 2.0)) * (1.0 - u) * (1.0 - u) / r;
          emit = emit + params.flashColor.rgb * shell * params.ripple * 0.3;
        }
      }
    }

    // QUARKS AND GLUONS, in the smooth coordinates like the photons: confinement as a
    // story in three acts. A quark and its antiquark (colour and anticolour) are born on
    // an onset and part; the gluon field between them is a flux tube — drawn as the
    // Feynman curl — whose energy grows with its length. At 55% of the life the tube
    // snaps: a new quark pair condenses out of the vacuum at the break, and the two
    // mesons (each a quark and an antiquark) drift apart, their own tubes short, and fade.
    if (params.quarkRate > 0.0) {
      let qc = max(params.quarkCell, 0.4);
      let cq = floor(wg / qc);
      var qlit = false;
      var qage = 0.0;
      var qe = 1.0;
      var qh = vec3f(0.0);
      for (var j = 0; j < ONSETS; j = j + 1) {
        let o = onsets[j];
        if (o.g <= 0.0) { continue; }
        let snare = o.a > 1.35 && o.a < 2.1;
        let hq = hash33(cq * 1.91 + vec3f(o.b * 4.1, o.b * 2.3, o.b * 6.7) + vec3f(13.0));
        if (hq.x < params.quarkRate * select(0.33, 1.0, snare)) {
          qlit = true;
          qage = o.r;
          qe = o.a;
          qh = hash33(cq * 3.07 + vec3f(o.b * 1.3, o.b * 8.9, o.b * 2.2) + vec3f(57.0));
          break;
        }
      }
      let qlife = params.quarkLife;
      let wgE = wg + rd * hstep;
      // The life runs on past qlife for the decay photons to get away.
      if (qlit && qage < qlife * 1.6) {
        let s = qage / qlife;
        let centre = (cq + vec3f(0.3) + 0.4 * qh) * qc;
        let theta = qh.x * 6.2831853;
        let phi = acos(qh.y * 2.0 - 1.0);
        let dir = vec3f(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
        let reach = qc * 0.36 / sqrt(qe);
        let colourIdx = floor(qh.z * 3.0);
        let breakIdx = floor(fract(qh.z * 7.0) * 3.0);
        let cQ = colourCharge(colourIdx);
        let cA = anticolour(colourIdx);
        let cNewA = anticolour(breakIdx);
        let cNewQ = colourCharge(breakIdx);
        let rq = max(params.quarkSize, 0.002);
        let fade = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(1.4, 1.6, s)) * near;
        let flow = time * 9.0;
        var qlight = vec3f(0.0);
        let SNAP = 0.55;
        if (s < SNAP) {
          // Act one: parting, slowing as the tube pulls back.
          let sep = reach * (1.0 - pow(1.0 - s / SNAP, 2.0));
          let q = centre + dir * sep;
          let a = centre - dir * sep;
          let dq = segment(q, wg, wgE) / rq;
          let da = segment(a, wg, wgE) / rq;
          qlight = qlight + cQ * exp(-dq * dq) * params.quarkGlow + cA * exp(-da * da) * params.quarkGlow;
          // The tube brightens as it stretches toward the snap.
          let strain = 0.6 + 0.8 * (s / SNAP);
          qlight = qlight + mix(cQ, cA, 0.5) * gluon(wg, wgE, q, a, 0.0, flow) * params.gluonGlow * strain;
        } else {
          // Act two: the snap, and the two mesons — which then DECAY, each π⁰ → γγ: the
          // meson vanishes into a vertex and two photons leave it back to back.
          let u = (s - SNAP) / (1.0 - SNAP);
          let DECAY = 0.65;
          let live = 1.0 - smoothstep(DECAY, DECAY + 0.08, u);
          let drift = reach * (1.0 + 0.6 * min(u, 1.0));
          let q = centre + dir * drift;
          let a = centre - dir * drift;
          // The new pair, born at the break, pulled toward its partners.
          let gap = reach * (0.9 * (1.0 - min(u, 1.0)) + 0.15);
          let newA = q - dir * gap;
          let newQ = a + dir * gap;
          if (live > 0.0) {
            let dq = segment(q, wg, wgE) / rq;
            let da = segment(a, wg, wgE) / rq;
            let dnA = segment(newA, wg, wgE) / rq;
            let dnQ = segment(newQ, wg, wgE) / rq;
            qlight = qlight + (cQ * exp(-dq * dq) + cA * exp(-da * da) + cNewA * exp(-dnA * dnA) + cNewQ * exp(-dnQ * dnQ)) * params.quarkGlow * live;
            qlight = qlight + mix(cQ, cNewA, 0.5) * gluon(wg, wgE, q, newA, 0.0, flow) * params.gluonGlow * live;
            qlight = qlight + mix(cNewQ, cA, 0.5) * gluon(wg, wgE, newQ, a, 0.0, flow) * params.gluonGlow * live;
          }
          // The snap itself: a white flash where the tube broke — a vertex.
          let db = segment(centre, wg, wgE) / (rq * 3.0);
          qlight = qlight + vec3f(1.0) * exp(-u * 12.0) * exp(-db * db) * params.flash * 2.0;
          if (u > DECAY) {
            let since = (u - DECAY) * (1.0 - SNAP) * qlife;
            let m1 = (q + newA) * 0.5;
            let m2 = (newQ + a) * 0.5;
            let p1 = randomDir(qh * 5.3 + vec3f(1.0));
            let p2 = randomDir(qh * 7.9 + vec3f(2.0));
            qlight = qlight + photonPair(wg, wgE, m1, p1, since) + photonPair(wg, wgE, m2, p2, since);
            qlight = qlight + vec3f(1.0, 0.95, 0.85) * params.vertexGlow * exp(-since * 5.0)
              * (vertexDot(m1, wg, wgE) + vertexDot(m2, wg, wgE));
          }
        }
        hit = hit + qlight * fade;
      }
    }

    // DECAYS, drawn as their Feynman diagrams growing in space, in the smooth coordinates.
    // μ⁻ → νμ W⁻, then W⁻ → e⁻ ν̄e: the muon's track runs in to a vertex; there it becomes
    // a muon neutrino and throws off a W, so heavy and brief it is a short zigzag that is
    // gone almost at once; at the W's far end a second vertex makes the electron and the
    // electron antineutrino. Fermions are straight lines with arrows (an antiparticle's
    // arrows run backward, Feynman's particle going back in time), neutrinos faint and
    // dotted, every vertex a bright point. Born on hats, the high end of the sound.
    if (params.decayRate > 0.0) {
      let dc = max(params.decayCell, 0.5);
      let cd = floor(wg / dc);
      let wgE = wg + rd * hstep;
      var dlit = false;
      var dage = 0.0;
      var dh = vec3f(0.0);
      for (var j = 0; j < ONSETS; j = j + 1) {
        let o = onsets[j];
        if (o.g <= 0.0) { continue; }
        let hat = o.a >= 2.1;
        let hd = hash33(cd * 2.37 + vec3f(o.b * 5.9, o.b * 3.1, o.b * 7.7) + vec3f(29.0));
        if (hd.x < params.decayRate * select(0.2, 1.0, hat)) {
          dlit = true;
          dage = o.r;
          dh = hash33(cd * 4.13 + vec3f(o.b * 2.9, o.b * 6.1, o.b * 1.7) + vec3f(83.0));
          break;
        }
      }
      let T = max(params.decayLife, 0.2);
      if (dlit && dage < T) {
        let s = dage / T;
        let muDir = randomDir(dh);
        let side = normalize(cross(muDir, randomDir(dh.zxy + vec3f(0.37))));
        let L = dc * 0.32;
        let V = (cd + vec3f(0.35) + 0.3 * dh) * dc;
        let P0 = V - muDir * L;
        let V2 = V + normalize(muDir + side * 1.4) * dc * 0.07;
        let eDir = normalize(muDir * cos(0.9) + side * sin(0.9));
        let nuMuDir = normalize(muDir * cos(0.25) - side * sin(0.25));
        let anuDir = normalize(muDir * cos(1.6) - side * sin(1.6));
        let fadeAll = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.85, 1.0, s)) * near;
        let S1 = 0.4;
        var dl = vec3f(0.0);
        let muColor = vec3f(1.0, 0.45, 0.8);
        let eColor = params.matterColor.rgb;
        let nuColor = vec3f(0.55, 0.62, 0.7);
        let head = P0 + muDir * L * min(s / S1, 1.0);
        dl = dl + muColor * fermionLine(wg, wgE, P0, head, params.leptonWidth, 1.0);
        if (s >= S1) {
          let k = (s - S1) / (1.0 - S1);
          let grow = 1.0 - pow(1.0 - k, 2.0);
          let L2 = dc * 0.38;
          dl = dl + vec3f(0.9, 1.0, 0.3) * wLine(wg, wgE, V, V2) * exp(-k * 6.0) * 2.0;
          dl = dl + nuColor * neutrinoLine(wg, wgE, V, V + nuMuDir * L2 * grow, 1.0) * params.neutrinoGlow;
          dl = dl + eColor * fermionLine(wg, wgE, V2, V2 + eDir * L2 * grow, params.leptonWidth, 1.0);
          dl = dl + nuColor * neutrinoLine(wg, wgE, V2, V2 + anuDir * L2 * grow, -1.0) * params.neutrinoGlow;
          dl = dl + vec3f(1.0) * params.vertexGlow * (vertexDot(V, wg, wgE) + vertexDot(V2, wg, wgE)) * (0.4 + 0.6 * exp(-k * 4.0));
        }
        hit = hit + dl * params.decayGlow * fadeAll;
      }
    }

    // PHOTONS: packets running down the beam at c, in the lane this point falls in. Lanes
    // live in warped coordinates, so the beam bends where spacetime does. The ray step's
    // closest approach to the lane's centre line is found once; each onset that fired this
    // lane then only asks where its packet has got to.
    if (params.photonRate > 0.0 || params.photonIdle > 0.0) {
      let lc = floor(vec2f(dot(wg, across1), dot(wg, across2)) / lane);
      let lh = hash33(vec3f(lc, 71.3));
      let centre2 = (lc + vec2f(0.3) + 0.4 * lh.xy) * lane;
      let centre = across1 * centre2.x + across2 * centre2.y;
      // Closest point of the step w..wEnd to the line centre + beam·t.
      let wgEnd = wg + rd * hstep;
      let d1 = wgEnd - wg;
      let rr = wg - centre;
      let a = dot(d1, d1);
      let b = dot(d1, beam);
      let denom = a - b * b;
      let sc = select(0.0, clamp((b * dot(beam, rr) - dot(d1, rr)) / denom, 0.0, 1.0), denom > 1e-9);
      let q = wg + d1 * sc;
      let along = dot(q - centre, beam);
      let perp = q - centre - beam * along;
      if (length(perp) < params.photonWidth * 12.0 + params.photonAmp * 2.0) {
        let polAngle = lh.z * 6.2831853;
        let pol = across1 * cos(polAngle) + across2 * sin(polAngle);
        let start = launch + lh.z * 1.5;
        var light = vec3f(0.0);
        for (var j = 0; j < ONSETS; j = j + 1) {
          let o = onsets[j];
          if (o.g <= 0.0) { continue; }
          let hp = hash33(vec3f(lc * 1.31, o.b * 2.7 + 5.0));
          if (hp.x >= params.photonRate * o.g * 2.0) { continue; }
          let u = along - (start + o.r * params.photonSpeed);
          light = light + photonColor(o.a) * packet(u, perp, pol, params.packetLength, params.photonWave / o.a, params.photonAmp, params.photonWidth);
        }
        // The idle stream: a train down a few lanes, spaced by the lane's own hash.
        if (lh.x < params.photonIdle) {
          let spacing = 3.0 + 4.0 * lh.y;
          let u = (fract((along - time * params.photonSpeed) / spacing + lh.z) - 0.5) * spacing;
          light = light + photonColor(1.6 + lh.y) * 0.6 * packet(u, perp, pol, params.packetLength, params.photonWave, params.photonAmp, params.photonWidth);
        }
        hit = hit + light * params.photonGlow * near;
      }
    }

    // The accretion disk of the nearest hole: hot plasma in a thin plane round it, from
    // diskInner to diskOuter horizon radii, turning; the side coming toward the eye is
    // brighter (Doppler beaming). The photon sphere at 1.5 horizon radii glows faintly.
    if (nearestBH.w > 0.0 && nearestR < params.diskOuter * 1.3) {
      let rs = nearestBH.w;
      let off = x - nearestBH.xyz;
      let hgt = dot(off, nearestAxis);
      let inPlane = off - nearestAxis * hgt;
      let rr = length(inPlane) / rs;
      let band = smoothstep(params.diskInner, params.diskInner + 0.6, rr) * (1.0 - smoothstep(params.diskOuter - 1.5, params.diskOuter, rr));
      let thin = exp(-hgt * hgt / (rs * rs * 0.012));
      let tangent = normalize(cross(nearestAxis, inPlane + vec3f(1e-5)));
      let doppler = 1.0 + 0.7 * dot(tangent, -rd);
      let swirl = 0.6 + 0.4 * sin(atan2(dot(inPlane, cross(nearestAxis, tangent)), dot(inPlane, tangent)) * 3.0 + rr * 2.0 - time * 3.0 / max(rr, 1.0));
      let heat = mix(vec3f(1.0, 0.95, 0.85), params.diskColor.rgb, smoothstep(params.diskInner, params.diskOuter, rr));
      emit = emit + heat * band * thin * doppler * doppler * swirl * params.diskGlow / rs;
      let sphere = exp(-pow((length(off) / rs - 1.5) * 4.0, 2.0));
      emit = emit + vec3f(0.8, 0.85, 1.0) * sphere * 0.4 / rs;
    }

    // Emission through the haze. near keeps everything within arm's reach of the eye
    // dark: anything that close fills the screen as an out-of-focus smear. Point emitters
    // are counted per crossing; where the steps shrink near a hole they are scaled back so a
    // shorter step does not count the same particle many times.
    col = col + (emit * hstep * near + hit * (hstep / stepLen)) * trans;
    trans = trans * exp(-max(params.fog, 0.0) * hstep);

    // Light bends toward the field: the lensing half of the warp.
    rd = normalize(rd + params.bend * field * hstep + pull * params.bhLens * hstep);
    x = x + rd * hstep;
    travelled = travelled + hstep;
  }
  col = col + params.fogColor.rgb * (1.0 - trans);
  col = col * params.exposure;

  let size = vec2f(textureDimensions(inputTexture1));
  let prev = textureLoad(inputTexture1, vec2i(clamp(uv * size, vec2f(0.0), size - vec2f(1.0))), 0).rgb;
  col = mix(col, prev, clamp(params.trail, 0.0, 0.98));
  return vec4f(col, 1.0);
}
`;

/**
 * The onset memory: an 8×1 rgba16float state texture that feeds back into itself
 * (`feedback_onsets` → inputTexture1). Texel j holds the j-th newest drum onset:
 *   r  seconds since it struck (stops counting at 60)
 *   g  its birth share: how big a share of the pair cells it lights (0 = empty slot)
 *   b  its running index, mod 1024, so every onset hashes its own cells
 *   a  the energy of the pairs it borrows
 * On a frame with a hit every slot shifts one along and slot 0 takes the new onset; on any
 * other frame every age grows by the frame's delta. One hit per frame, kick first.
 *
 * Ages are relative, so half floats hold them to a few milliseconds at the oldest.
 */
export const VACUUM_ONSETS_WGSL = `${SHARED_UNIFORMS_WGSL}
struct Params {
  kick: f32,          // @default 0  kick events this frame (from the audio)
  snare: f32,         // @default 0  snare events this frame
  hat: f32,           // @default 0  hat events this frame
  brightness: f32,    // @default 0.5  spectral centroid at the hit, 0..1: raises the pairs' energy
  level: f32,         // @default 0.3  loudness at the hit: raises the share of cells lit
  kickShare: f32,     // @default 0.55  share of cells a kick lights, before loudness
  snareShare: f32,    // @default 0.35  share a snare lights
  hatShare: f32,      // @default 0.1  share a hat lights
};

@group(0) @binding(0) var inputSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> frameU: SharedFrame;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var inputTexture1: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let j = i32(floor(uv.x * 8.0));
  let dt = clamp(frameU.deltaTime, 0.0, 0.1);
  let isKick = params.kick > 0.0;
  let isSnare = params.snare > 0.0;
  let isHat = params.hat > 0.0;
  if (!(isKick || isSnare || isHat)) {
    let o = textureLoad(inputTexture1, vec2i(j, 0), 0);
    return vec4f(min(o.r + dt, 60.0), o.g, o.b, o.a);
  }
  if (j > 0) {
    let o = textureLoad(inputTexture1, vec2i(j - 1, 0), 0);
    return vec4f(min(o.r + dt, 60.0), o.g, o.b, o.a);
  }
  let newest = textureLoad(inputTexture1, vec2i(0, 0), 0);
  let index = (newest.b + 1.0) % 1024.0;
  let loud = 0.6 + 0.8 * clamp(params.level * 3.0, 0.0, 1.0);
  let bright = clamp(params.brightness, 0.0, 1.0);
  var share = params.hatShare;
  var energy = 2.2 + 0.8 * bright;
  if (isKick) {
    share = params.kickShare;
    energy = 0.9 + 0.4 * bright;
  } else if (isSnare) {
    share = params.snareShare;
    energy = 1.4 + 0.6 * bright;
  }
  return vec4f(0.0, clamp(share * loud, 0.0, 1.0), index, energy);
}
`;

/**
 * The camera rig's memory: a 4×1 rgba16float state texture that feeds back into itself
 * (`feedback_camera` → inputTexture1). It INTEGRATES the moves whose speed the music
 * drives, so speeding one up or slowing it down bends the move instead of jumping the shot:
 *   texel 0  pan angle, radians      += panSpeed · dt
 *   texel 1  roll angle, radians     += rollSpeed · dt
 *   texel 2  orbit angle, radians    += orbitSpeed · dt
 *   texel 3  dolly distance          += dolly · dt
 * The angles wrap at ±π; the distance runs on.
 *
 * Half floats cannot add a thousandth of a radian to 3.1 (their step there is 0.002), and a
 * feedback loop cannot carry 32-bit floats (it samples, and this GPU does not filter them).
 * So each value is stored in three exact halves: r the whole part (exact to 2048), g the
 * fraction in 1/1024 steps (exact), b what is left below 1/1024 (a half is precise to about
 * 1e-6 there). r + g + b is the value; `rigValue` in the space shader reads it back.
 */
export const VACUUM_CAMERA_WGSL = `${SHARED_UNIFORMS_WGSL}
struct Params {
  dolly: f32,         // @default 0.16  DOLLY: how fast the eye moves forward, lattice units a second
  panSpeed: f32,      // @default 0.02  PAN: radians a second the gaze turns where the eye stands
  rollSpeed: f32,     // @default 0.03  ROLL: radians a second the horizon turns
  orbitSpeed: f32,    // @default 0.06  ORBIT: radians a second the eye swings round its pivot
};

@group(0) @binding(0) var inputSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> frameU: SharedFrame;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var inputTexture1: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let j = i32(floor(uv.x * 4.0));
  let dt = clamp(frameU.deltaTime, 0.0, 0.1);
  let stored = textureLoad(inputTexture1, vec2i(j, 0), 0);
  let prev = stored.r + stored.g + stored.b;
  var speed = params.dolly;
  if (j == 0) { speed = params.panSpeed; }
  if (j == 1) { speed = params.rollSpeed; }
  if (j == 2) { speed = params.orbitSpeed; }
  var v = prev + speed * dt;
  if (j < 3) {
    v = v - 6.2831853 * floor((v + 3.14159265) / 6.2831853);
  }
  let whole = floor(v);
  let frac = floor((v - whole) * 1024.0) / 1024.0;
  return vec4f(whole, frac, v - whole - frac, 1.0);
}
`;
