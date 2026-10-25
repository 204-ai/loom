import { settings, named, edge, graph, document, expressionSlot } from "../../examples/documents/builders.ts";
import type { ProjectDocument } from "../../domain/types/graph.ts";
import { BIRCHWOOD_WGSL } from "./birchwood.wgsl.ts";

/**
 * Birchwood — a dark birch stand, tall white trunks lined up down an aisle into the dark,
 * with the sound on the trees' HIGHLIGHTS, their SHADOWS and the BACKGROUND.
 *
 *   noise_veil(noise) ─► wgsl_birches(customWgsl) ─► output_frame(output)
 *
 *   pattern_music(audioPattern) ─┐
 *   audiofile_track(audioFileIn) ─┴► switch_source(valueSwitch)
 *        ├► lag_body ─► normalize_body ─► lag_bodySmooth   the bands, ranked: slow swells
 *        └► lag_hit                                         the drums, enveloped: the hits
 *
 * WHAT DRIVES WHAT, one band per target so the three read as three gestures:
 *
 *   highlight  ← low (bass swell)       + kick       the moonlit flanks and rims brighten
 *   shadow     ← lowMid (body swell)                 the shadows open into blue, then close
 *   glow       ← high (air swell)       + snare      the mist at the aisle's end lights up
 *   pulse      ← kick                                a band of light runs down the rows
 *
 * The bands go through `valueNormalize` between two lags, the drive shape E57 Forest
 * measured: a raw envelope pins or idles depending on the track, a ranked one spends equal
 * time across its range, and the lag after the rank bounds the step the rank's own
 * steepness can make. The drums go through one short lag on the ENVELOPES (not the counts,
 * whose one-frame peak depends on the frame rate). The pulse reads the kick envelope
 * scaled to 0..1: it jumps toward 1 on the hit and decays, and the shader puts the band at
 * `(1 - pulse) * pulseReach`, so the decay is the band travelling into the depth.
 *
 * Index 0 of `switch_source` is a deterministic beat, so the scene plays on open with no
 * track. Drop a file into `audiofile_track` and set the switch to 1 — or swap the pattern
 * for an Audio In to play to the room.
 */
export function birchwoodDocument(): ProjectDocument {
  return document(
    "birchwood",
    "Birchwood",
    settings({ randomSeed: 31, previewFps: 30 }),
    graph(
      [
        /* Drifting mist texture behind the silhouettes, at a crawl. */
        named("veil", "noise", [-900, 0], {
          type: "perlin4d", period: 0.5, harmon: 3, spread: 2, gain: 0.55, rough: 0.5,
          exp: 1, amp: 1.1, offset: 0.5, mono: true, speed: 0.03,
        }),

        named("birches", "customWgsl", [-600, 0], {
          source: BIRCHWOOD_WGSL,
        }, {
          parameters: {
            highlight: expressionSlot(
              `0.5 + 0.85 * op('lag_bodySmooth').chan.low + 0.9 * op('lag_hit').chan.kick`,
              0.95,
            ),
            shadow: expressionSlot(`0.03 + 0.3 * op('lag_bodySmooth').chan.lowMid`, 0.18),
            glow: expressionSlot(
              `0.25 + 0.85 * op('lag_bodySmooth').chan.high + 2.2 * op('lag_hit').chan.snare`,
              0.7,
            ),
            pulse: expressionSlot(`clamp(4 * op('lag_hit').chan.kick, 0, 1)`, 0),
          },
        }),

        named("frame", "output", [-300, 0], { toneMap: "filmic" }),

        named("music", "audioPattern", [-2100, 600], { bpm: 118, amount: 1, beatsPerBar: 4 }),
        named("track", "audioFileIn", [-2100, 1000], {
          cue: false, cuePoint: 0, extend: "loop", file: "", monitor: true, play: true,
          playMode: "freeRun", speed: 1, trimEnd: 0, trimStart: 0, volume: 1,
        }),
        named("source", "valueSwitch", [-1800, 800], { index: 0 }),

        /* The swells: ~0.5 s to rise, 1 s to fall, ranked over 16 s, then smoothed again. */
        named("body", "valueLag", [-1500, 600], { lag: 0.5, releaseRatio: 2 }),
        named("body", "valueNormalize", [-1200, 600], { window: 16 }),
        named("bodySmooth", "valueLag", [-900, 600], { lag: 0.35, releaseRatio: 1 }),

        /* The hits: about a fifth of a second to rise, so a kick swells in rather than blinking (a one-frame
           step of 17% mean luma read as a strobe), and twice that to fall. */
        named("hit", "valueLag", [-1500, 1000], { lag: 0.22, releaseRatio: 2 }),
      ],
      [
        edge("e-veil-birches", ["noise_veil", "out"], ["wgsl_birches", "input"]),
        edge("e-birches-frame", ["wgsl_birches", "out"], ["output_frame", "input"]),

        edge("e-music-source", ["pattern_music", "out"], ["switch_source", "in1"]),
        edge("e-track-source", ["audiofile_track", "out"], ["switch_source", "in2"]),
        edge("e-source-body", ["switch_source", "out"], ["lag_body", "in"]),
        edge("e-body-rank", ["lag_body", "out"], ["normalize_body", "in"]),
        edge("e-rank-smooth", ["normalize_body", "out"], ["lag_bodySmooth", "in"]),
        edge("e-source-hit", ["switch_source", "out"], ["lag_hit", "in"]),
      ],
    ),
  );
}
