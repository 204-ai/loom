import { settings, named, edge, graph, document, expressionSlot } from "../../examples/documents/builders.ts";
import type { ProjectDocument } from "../../domain/types/graph.ts";
import { serializePanelBoard } from "../../nodes/definitions/controls.ts";
import { VACUUM_CAMERA_WGSL, VACUUM_ONSETS_WGSL, VACUUM_SPACE_WGSL } from "./vacuum.wgsl.ts";

/**
 * Vacuum — a small patch of quantum vacuum in 3D: a spacetime lattice warped by vector
 * fields and Planck foam, and virtual particle pairs borrowing energy from it.
 *
 *   noise_foam(noise) ─► wgsl_space(customWgslMulti) ─► output_frame
 *                              ▲ more[0]        ▲ more[1]
 *   feedback_trails(source wgsl_space) ─┘       │
 *   noise_foam ─► wgsl_onsets(customWgslMulti, 8×1) ◄─ feedback_onsets(source wgsl_onsets)
 *                     ▲ kick / snare / hat counts, centroid, level from switch_source
 *   noise_foam ─► wgsl_camera(customWgslMulti, 4×1) ◄─ feedback_camera   ─► wgsl_space more[2]
 *                     ▲ dolly / pan / roll / orbit speeds, audio-driven
 *
 *   slider_rate  slider_energy  slider_bfield  slider_warp  slider_planck  slider_trail  slider_react
 *   slider_photons  xypad_beam ─► panel_vacuum (Phone on)
 *
 *   pattern_music ─┐
 *   audiofile_track ┼► switch_source ─┬► lag_body ─► normalize_body ─► lag_bodySmooth   the swells, ranked
 *   audioin_room ──┘                  └► lag_hit                                          the hits, enveloped
 *
 * The physics each slider moves, and what reads on screen (see `vacuum.wgsl.ts`):
 *
 *   rate    how often a cell borrows a pair             more or fewer pairs
 *   energy  ΔE of every loan; Δt ≈ ħ/2ΔE               shorter, tighter, brighter lives
 *   bfield  magnetic field on the charged pair          tighter helices, opposite windings
 *   warp    the vector field's grip on spacetime        lattice bends, rays lens
 *   planck  spacetime foam at the finest scale          the lattice and tracks crinkle
 *   trail   bubble-chamber memory                       how long the tracks linger
 *   photons share of lanes each onset fires a photon down
 *   black holes  share of black-hole sites that hold a singularity per cycle (rare by default)
 *   decays  share of decay cells a hat lights with a muon decay, drawn as its Feynman diagram
 *   quarks  share of quark cells a snare (or, less often, any onset) lights with a meson's worth of quarks
 *   beam    (xy pad) the photons' direction: x is the heading round the vertical, y the climb
 *
 * AUDIO, one band per piece of the physics, all scaled by slider_react (0 is silence):
 *
 *   low      bass swell    spacetime heaves: the warp and the lattice's glow swell
 *   lowMid   body swell    the vacuum gets busier: more pairs borrowed
 *   highMid  presence      the magnetic field tightens the helices
 *   high     air swell     the Planck foam boils harder — the finest sound on the finest scale
 *   kick     onset         a burst of low-energy pairs born on the beat, a wavefront through
 *                          spacetime, a lensing shock, the lattice and particles flare
 *   snare    onset         a smaller burst of mid-energy pairs and a wavefront; annihilations flare
 *   hat      onset         a sprinkle of high-energy pairs that flicker out; a crackle of foam
 *
 * The onsets are EVENTS (kickCount, snareCount, hatCount), not envelopes: wgsl_onsets keeps
 * the last eight in a state texture and wgsl_space births its pairs and sends its wavefronts
 * from them, so the pairs appear on the hit itself.
 *
 * The swells go through `valueNormalize` between two lags (the drive shape birchwood and
 * E57 Forest use): a ranked band spends equal time across its range whatever the track's
 * loudness, so every swell term is written around its mean, `(band - 0.5)`, and silence
 * leaves the picture where the sliders put it. The hits go through one short lag on the
 * envelopes and are scaled ×8 and clamped to 0..1.
 *
 * Nothing that sets a CLOCK is driven directly — energy, lifetime, waveSpeed, planckRate all
 * multiply absTime, so moving one would jump the whole picture to another phase. The
 * camera's speeds ARE driven, because wgsl_camera integrates them frame by frame.
 *
 * CAMERA, standard moves on the panel's Camera rows, and what the music does to each:
 *
 *   zoom     focal length                       punches in on the kick
 *   dolly    forward speed                      surges with the bass swell and on the kick
 *   orbit    0 pans where it stands, 1 swings round a pivot ahead; the swing speeds up with the air
 *   pan      turn speed                         quickens with the body swell
 *   roll     horizon turn speed                 quickens with presence; the snare twitches it
 *   shake    handheld jolt                      fired by the kick only
 *
 * switch_source ships on index 2, audioin_room: whatever the audio input hears — Spotify,
 * through a loopback device (BlackHole) chosen in audioin_room's Device, or the room's mic
 * hearing the speakers. Index 0 is the deterministic beat (it plays with no input at all),
 * index 1 is audiofile_track. A browser cannot capture another app's sound by itself.
 *
 * `noise_foam` only dithers where each pixel's march starts; the foam in the picture is
 * computed in 3D inside the shader. The panel is remote, so a phone on the same wifi can
 * play the vacuum: start the helper with the phone door and press the phone icon on
 * panel_vacuum's header.
 */
const VACUUM_BOARD = serializePanelBoard({
  columns: 4,
  items: [
    { label: "Vacuum", rect: { x: 0, y: 0, w: 4, h: 1 } },
    { member: "slider_rate", rect: { x: 0, y: 1, w: 4, h: 1 } },
    { member: "slider_energy", rect: { x: 0, y: 2, w: 4, h: 1 } },
    { member: "slider_bfield", rect: { x: 0, y: 3, w: 4, h: 1 } },
    { member: "slider_warp", rect: { x: 0, y: 4, w: 4, h: 1 } },
    { member: "slider_planck", rect: { x: 0, y: 5, w: 4, h: 1 } },
    { member: "slider_trail", rect: { x: 0, y: 6, w: 4, h: 1 } },
    { member: "slider_react", rect: { x: 0, y: 7, w: 4, h: 1 } },
    { member: "slider_photons", rect: { x: 0, y: 8, w: 4, h: 1 } },
    { member: "slider_quarks", rect: { x: 0, y: 14, w: 4, h: 1 } },
    { member: "slider_decays", rect: { x: 0, y: 22, w: 4, h: 1 } },
    { member: "slider_blackholes", rect: { x: 0, y: 23, w: 4, h: 1 } },
    { label: "Camera", rect: { x: 0, y: 15, w: 4, h: 1 } },
    { member: "slider_zoom", rect: { x: 0, y: 16, w: 4, h: 1 } },
    { member: "slider_dolly", rect: { x: 0, y: 17, w: 4, h: 1 } },
    { member: "slider_orbit", rect: { x: 0, y: 18, w: 4, h: 1 } },
    { member: "slider_pan", rect: { x: 0, y: 19, w: 4, h: 1 } },
    { member: "slider_roll", rect: { x: 0, y: 20, w: 4, h: 1 } },
    { member: "slider_shake", rect: { x: 0, y: 21, w: 4, h: 1 } },
    { label: "Photon beam", rect: { x: 0, y: 9, w: 4, h: 1 } },
    { member: "xypad_beam", rect: { x: 0, y: 10, w: 4, h: 4 } },
  ],
});

/** Audio reactivity: 0 leaves the picture to the sliders. */
const REACT = "op('slider_react').chan.react";
/** A ranked swell, around its own mean: 0 on average, ±0.5 at the extremes. */
const swell = (band: string): string => `(op('lag_bodySmooth').chan.${band} - 0.5)`;
/** A drum hit's envelope, 0..1. A strike peaks near 0.28 (the analyser's onset scale) and the lag takes the top off it. */
const hit = (drum: string): string => `clamp(8 * op('lag_hit').chan.${drum}, 0, 1)`;

export function vacuumDocument(): ProjectDocument {
  return document(
    "vacuum",
    "Vacuum",
    settings({ randomSeed: 137, previewFps: 30 }),
    graph(
      [
        /* Dither for the march start: decorrelates the steps between neighbouring pixels. */
        named("foam", "noise", [-900, 0], {
          type: "perlin4d", period: 0.02, harmon: 1, spread: 2, gain: 0.5, rough: 0.5,
          exp: 1, amp: 1, offset: 0.5, mono: true, speed: 4,
        }),

        /* The 3D pass renders at 960×540 and the output scales it to 1280×720: every pixel is a
           ray march, so a quarter fewer pixels is what lets it run live. */
        named("space", "customWgslMulti", [-600, 0], { source: VACUUM_SPACE_WGSL }, {
          resolution: { mode: "fixed", width: 960, height: 540 },
          parameters: {
            rate: expressionSlot(`clamp(op('slider_rate').chan.rate * (1 + ${REACT} * 0.9 * ${swell("lowMid")}), 0, 1)`, 0.07),
            beatRipple: expressionSlot(`0.18 * ${REACT}`, 0.288),
            energy: expressionSlot("op('slider_energy').chan.energy", 1),
            bfield: expressionSlot(`op('slider_bfield').chan.bfield * (1 + ${REACT} * 0.8 * ${swell("highMid")})`, -4.08),
            warp: expressionSlot(`max(op('slider_warp').chan.warp * (1 + ${REACT} * 1.6 * ${swell("low")}), 0)`, 0.16),
            bend: expressionSlot(`0.03 + ${REACT} * 0.07 * ${hit("kick")}`, 0.03),
            planck: expressionSlot(
              `max(op('slider_planck').chan.planck * (1 + ${REACT} * (1.4 * ${swell("high")} + 1.2 * ${hit("hat")})), 0)`,
              0,
            ),
            gridGlow: expressionSlot(`max(5 * (1 + ${REACT} * (1.2 * ${swell("low")} + 0.9 * ${hit("kick")})), 0)`, 5),
            flash: expressionSlot(`0.4 * (1 + ${REACT} * 4 * ${hit("snare")})`, 0.4),
            glow: expressionSlot(`2.5 * (1 + ${REACT} * 0.8 * ${hit("kick")})`, 2.5),
            trail: expressionSlot("op('slider_trail').chan.trail", 0.3),
            photonRate: expressionSlot("op('slider_photons').chan.photons", 0.07),
            quarkRate: expressionSlot("op('slider_quarks').chan.quarks", 0.35),
            decayRate: expressionSlot("op('slider_decays').chan.decays", 0.3),
            bhRate: expressionSlot("op('slider_blackholes').chan.blackholes", 0.1),
            lens: expressionSlot(`op('slider_zoom').chan.zoom * (1 + ${REACT} * 0.18 * ${hit("kick")})`, 1.25),
            orbit: expressionSlot("op('slider_orbit').chan.orbit", 0.35),
            shake: expressionSlot(`op('slider_shake').chan.shake * ${REACT} * 0.035 * ${hit("kick")}`, 0),
            rollAngle: expressionSlot(`${REACT} * 4 * ${hit("snare")}`, 0),
            photonAzimuth: expressionSlot("(op('xypad_beam').chan.beamX - 0.5) * 360", 20),
            photonElevation: expressionSlot("(op('xypad_beam').chan.beamY - 0.5) * 180", 10),
          },
        }),

        /* The onset memory: the last eight drum hits, as an 8×1 state texture that feeds back into itself. */
        named("onsets", "customWgslMulti", [-900, -400], { source: VACUUM_ONSETS_WGSL }, {
          resolution: { mode: "fixed", width: 8, height: 1 },
          format: { mode: "fixed", format: "rgba16float" },
          parameters: {
            kick: expressionSlot("op('switch_source').chan.kickCount", 0),
            snare: expressionSlot("op('switch_source').chan.snareCount", 0),
            hat: expressionSlot("op('switch_source').chan.hatCount", 0),
            brightness: expressionSlot("op('switch_source').chan.centroid", 0.5),
            level: expressionSlot("op('switch_source').chan.level", 0.3),
          },
        }),
        named("onsets", "feedback", [-1200, -400], { source: "wgsl_onsets", persistence: 1, clearColor: [0, 0, 0, 0] }, {
          resolution: { mode: "fixed", width: 8, height: 1 },
          format: { mode: "fixed", format: "rgba16float" },
        }),

        /* The camera rig's memory: pan, roll and orbit angles and the dolly's distance, integrated. */
        named("camera", "customWgslMulti", [-900, -700], { source: VACUUM_CAMERA_WGSL }, {
          resolution: { mode: "fixed", width: 4, height: 1 },
          format: { mode: "fixed", format: "rgba16float" },
          parameters: {
            dolly: expressionSlot(
              `op('slider_dolly').chan.dolly * (1 + ${REACT} * 1.2 * ${swell("low")}) + ${REACT} * 0.35 * ${hit("kick")}`,
              0.16,
            ),
            panSpeed: expressionSlot(`op('slider_pan').chan.pan * (1 + ${REACT} * ${swell("lowMid")})`, 0.02),
            rollSpeed: expressionSlot(`op('slider_roll').chan.roll * (1 + ${REACT} * 1.5 * ${swell("highMid")})`, 0.03),
            orbitSpeed: expressionSlot(`0.06 * (1 + ${REACT} * 1.5 * ${swell("high")})`, 0.06),
          },
        }),
        named("camera", "feedback", [-1200, -700], { source: "wgsl_camera", persistence: 1, clearColor: [0, 0, 0, 0] }, {
          resolution: { mode: "fixed", width: 4, height: 1 },
          format: { mode: "fixed", format: "rgba16float" },
        }),

        /* Last frame, read back by wgsl_space as inputTexture1: trails and denoise. */
        named("trails", "feedback", [-900, 400], { source: "wgsl_space", persistence: 1, clearColor: [0, 0, 0, 1] }),

        named("frame", "output", [-300, 0], { toneMap: "filmic" }),

        named("rate", "slider", [-1500, 800], {
          channel: "rate", caption: "Fluctuation rate", value: 0.07, defaultValue: 0.07, min: 0, max: 0.2, step: 0,
        }),
        named("energy", "slider", [-1200, 800], {
          channel: "energy", caption: "Energy ΔE", value: 1, defaultValue: 1, min: 0.3, max: 2, step: 0,
        }),
        named("bfield", "slider", [-900, 800], {
          channel: "bfield", caption: "Magnetic field", value: -4.08, defaultValue: -4.08, min: -10, max: 10, step: 0,
        }),
        named("warp", "slider", [-600, 800], {
          channel: "warp", caption: "Spacetime warp", value: 0.16, defaultValue: 0.16, min: 0, max: 0.4, step: 0,
        }),
        named("planck", "slider", [-300, 800], {
          channel: "planck", caption: "Planck foam", value: 0, defaultValue: 0, min: 0, max: 1.5, step: 0,
        }),
        named("trail", "slider", [0, 800], {
          channel: "trail", caption: "Trails", value: 0.3, defaultValue: 0.3, min: 0, max: 0.9, step: 0,
        }),
        named("react", "slider", [300, 800], {
          channel: "react", caption: "Audio reactivity", value: 1.6, defaultValue: 1.6, min: 0, max: 3, step: 0,
        }),
        named("quarks", "slider", [600, 1100], {
          channel: "quarks", caption: "Quarks & gluons", value: 0.35, defaultValue: 0.35, min: 0, max: 1, step: 0,
        }),
        named("decays", "slider", [300, 1100], {
          channel: "decays", caption: "Decays", value: 0.3, defaultValue: 0.3, min: 0, max: 1, step: 0,
        }),
        named("blackholes", "slider", [600, 1400], {
          channel: "blackholes", caption: "Black holes", value: 0.1, defaultValue: 0.1, min: 0, max: 0.5, step: 0,
        }),
        named("zoom", "slider", [-1500, 1100], {
          channel: "zoom", caption: "Zoom", value: 1.25, defaultValue: 1.25, min: 0.5, max: 3, step: 0,
        }),
        named("dolly", "slider", [-1200, 1100], {
          channel: "dolly", caption: "Dolly", value: 0.16, defaultValue: 0.16, min: 0, max: 0.5, step: 0,
        }),
        named("orbit", "slider", [-900, 1100], {
          channel: "orbit", caption: "Orbit", value: 0.35, defaultValue: 0.35, min: 0, max: 1, step: 0,
        }),
        named("pan", "slider", [-600, 1100], {
          channel: "pan", caption: "Pan", value: 0.02, defaultValue: 0.02, min: -0.15, max: 0.15, step: 0,
        }),
        named("roll", "slider", [-300, 1100], {
          channel: "roll", caption: "Roll", value: 0.03, defaultValue: 0.03, min: -0.2, max: 0.2, step: 0,
        }),
        named("shake", "slider", [0, 1100], {
          channel: "shake", caption: "Shake", value: 1, defaultValue: 1, min: 0, max: 3, step: 0,
        }),
        named("photons", "slider", [600, 800], {
          channel: "photons", caption: "Photons", value: 0.07, defaultValue: 0.07, min: 0, max: 0.2, step: 0,
        }),
        /* x 0.5556 is a heading of 20°, y 0.5556 a climb of 10°: the beam crosses the view, rising. */
        named("beam", "xyPad", [900, 800], {
          channel: "beam", caption: "Photon beam", x: 0.5556, y: 0.5556, defaultX: 0.5556, defaultY: 0.5556, min: 0, max: 1,
        }),
        named("vacuum", "panel", [1200, 800], { title: "Vacuum", remote: true, board: VACUUM_BOARD }),

        /* The sound: a deterministic beat (index 0), a file (1), or the audio input (2) — Spotify through BlackHole, or the mic. */
        named("music", "audioPattern", [-2400, -600], { bpm: 120, amount: 1, beatsPerBar: 4 }),
        named("track", "audioFileIn", [-2400, -250], {
          cue: false, cuePoint: 0, extend: "loop", file: "", monitor: true, play: true,
          playMode: "freeRun", speed: 1, trimEnd: 0, trimStart: 0, volume: 1,
        }),
        named("room", "audioIn", [-2400, 100], {}),
        named("source", "valueSwitch", [-2100, -250], { index: 2 }),

        /* The swells: ~0.5 s to rise, 1 s to fall, ranked over 16 s, then smoothed again. */
        named("body", "valueLag", [-1800, -450], { lag: 0.5, releaseRatio: 2 }),
        named("body", "valueNormalize", [-1500, -450], { window: 16 }),
        named("bodySmooth", "valueLag", [-1200, -450], { lag: 0.35, releaseRatio: 1 }),

        /* The hits: an eighth of a second to rise, so a kick swells in rather than strobing, and longer to fall. */
        named("hit", "valueLag", [-1800, -50], { lag: 0.12, releaseRatio: 2.5 }),
      ],
      [
        edge("e-music-source", ["pattern_music", "out"], ["switch_source", "in1"]),
        edge("e-track-source", ["audiofile_track", "out"], ["switch_source", "in2"]),
        edge("e-room-source", ["audioin_room", "out"], ["switch_source", "in3"]),
        edge("e-source-body", ["switch_source", "out"], ["lag_body", "in"]),
        edge("e-body-rank", ["lag_body", "out"], ["normalize_body", "in"]),
        edge("e-rank-smooth", ["normalize_body", "out"], ["lag_bodySmooth", "in"]),
        edge("e-source-hit", ["switch_source", "out"], ["lag_hit", "in"]),

        edge("e-foam-space", ["noise_foam", "out"], ["wgsl_space", "input"]),
        edge("e-trails-space", ["feedback_trails", "out"], ["wgsl_space", "more"], 0),
        edge("e-onsets-space", ["wgsl_onsets", "out"], ["wgsl_space", "more"], 1),
        edge("e-camera-space", ["wgsl_camera", "out"], ["wgsl_space", "more"], 2),
        edge("e-foam-camera", ["noise_foam", "out"], ["wgsl_camera", "input"]),
        edge("e-memory-camera", ["feedback_camera", "out"], ["wgsl_camera", "more"], 0),
        edge("e-foam-onsets", ["noise_foam", "out"], ["wgsl_onsets", "input"]),
        edge("e-memory-onsets", ["feedback_onsets", "out"], ["wgsl_onsets", "more"], 0),
        edge("e-space-frame", ["wgsl_space", "out"], ["output_frame", "input"]),

        edge("e-rate-panel", ["slider_rate", "out"], ["panel_vacuum", "controls"], 0),
        edge("e-energy-panel", ["slider_energy", "out"], ["panel_vacuum", "controls"], 1),
        edge("e-bfield-panel", ["slider_bfield", "out"], ["panel_vacuum", "controls"], 2),
        edge("e-warp-panel", ["slider_warp", "out"], ["panel_vacuum", "controls"], 3),
        edge("e-planck-panel", ["slider_planck", "out"], ["panel_vacuum", "controls"], 4),
        edge("e-trail-panel", ["slider_trail", "out"], ["panel_vacuum", "controls"], 5),
        edge("e-react-panel", ["slider_react", "out"], ["panel_vacuum", "controls"], 6),
        edge("e-photons-panel", ["slider_photons", "out"], ["panel_vacuum", "controls"], 7),
        edge("e-beam-panel", ["xypad_beam", "out"], ["panel_vacuum", "controls"], 8),
        edge("e-quarks-panel", ["slider_quarks", "out"], ["panel_vacuum", "controls"], 9),
        edge("e-zoom-panel", ["slider_zoom", "out"], ["panel_vacuum", "controls"], 10),
        edge("e-dolly-panel", ["slider_dolly", "out"], ["panel_vacuum", "controls"], 11),
        edge("e-orbit-panel", ["slider_orbit", "out"], ["panel_vacuum", "controls"], 12),
        edge("e-pan-panel", ["slider_pan", "out"], ["panel_vacuum", "controls"], 13),
        edge("e-roll-panel", ["slider_roll", "out"], ["panel_vacuum", "controls"], 14),
        edge("e-shake-panel", ["slider_shake", "out"], ["panel_vacuum", "controls"], 15),
        edge("e-decays-panel", ["slider_decays", "out"], ["panel_vacuum", "controls"], 16),
        edge("e-blackholes-panel", ["slider_blackholes", "out"], ["panel_vacuum", "controls"], 17),
      ],
    ),
  );
}
