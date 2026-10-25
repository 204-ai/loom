# Čiurlionis mirror look

The look of the Čiurlionis TouchDesigner mirror
(`mirror-ciurlionis/MagicMirror_A1.ciurlionis-THIS-IS-THE-ULTIMATE-VERSION.toe`) as two
reusable Loom components, plus an example network that feeds them a movie in place of the
StreamDiffusion output.

| File | What it is |
|---|---|
| `ciurlionis-mirror.loom.json` | The example network. Carries both components. |
| `Watercolor.loom.json` | Watercolor on its own: the component and a movie to run it on. |
| `PaintingKey.loom.json` | PaintingKey on its own, with the two painting loops. |
| `media/` | The stand-in movies (see Media). |
| `td-vs-loom.jpg` | The comparison below, as pictures. |

Open with File → Open project from a local `pnpm dev`. The movies are addressed relative to
the page (`projects/ciurlionis-mirror/media/…`), so they load from the dev server and not
from the hosted build.

## The example network

```
movie_ai × circle_surround → flip_mirror → paintingkey_look → watercolor_look → cornerpin_projector → output_main
movie_angels → paintingkey_look.painting0     movie_friendship → paintingkey_look.painting1
```

This is the order of `/project1/container1` in the .toe: the SD output is flipped, keyed atop
the painting loop, run through the watercolor, and then corner-pinned (`corner1`, the show's
pins). `circle_surround` stands in for the black ground StreamDiffusion keeps around the
depth-keyed visitor. `Scene` follows the show's 30-second scene clock (without its 2 s lag).
1280 × 1280 at 60 fps, like `out1`.

Cost: on this Mac (Apple GPU, Loom in a browser pane, sharing the GPU with two running
TouchDesigner instances) a frame measured 24–32 ms of GPU time. The show runs on an RTX 4090.

## Watercolor

drmbt's `watercolor` COMP (2023.03.12), operator for operator. Socket `input`, output `out`.
The parameters keep drmbt's names, defaults are the mirror's values: `Bypass`, `Drywet` 0.535,
`Blendoriginal` 0.207, `Speed` 0.0147, `Displaceweight` 0.0055, `Midpoint` 1,
`Embossstrength` 9.08, `Direction` 162.

| TD | Loom |
|---|---|
| noise1 (Random GPU, Input + Noise) → comp1 (Multiply) | `noise_grain` → `composite_grain` (add) → `composite_paper` (multiply) |
| feedback1, recording comp2 | `feedback_trail`, recording `wgsl_maximum` |
| speed1 (∫ Speed) → tz of noise2–5 | `constant_rate` → `speed_drift` → `t.z` |
| noise2, noise3 (Simplex 3D, 10 harmonics) | `noise_flowa`, `noise_flowb` (8 harmonics, Loom's ceiling) |
| noise4, noise5 (noise at noise2/3's Noise Coordinate Map) | `noise_warpa/b` read by `remap_flowa/b` at the map's value |
| reorder1, displace1, blur1 | `reorder_flow`, `displace_drift`, `blur_soften` |
| comp3 (Soft Light) | `wgsl_softlight` |
| slope1, displace2 | `slope_flow`, `displace_bleed` |
| switch1 (blend by Blendoriginal) | `cross_original` |
| comp2 (Maximum) | `wgsl_maximum` |
| emboss1 | `reorder_luma` → `convolve_emboss` |
| comp4 (Multiply), wetDryMix, switch_bypass | `composite_relief`, `cross_drywet`, `switch_bypass` |

## PaintingKey

Sockets `ai`, `painting0`, `painting1`, output `out`. Parameters `Threshold` 0.05, `Soften`
0.75, `Scene` 0, `Brightness` 1.64, `Gamma` 0.98, `Scale` 1.6 × 1.6.

thresh1 → `threshold_key`, comp3 (Minimum) → `wgsl_minimum`, switch2 → `switch_scene`,
level1 → `level_brightness` + `level_gamma`, fit1 → the Movie File In's Image Fit `fit` plus
`transform_fit`, comp4 (Atop) → `composite_atop`.

## How the TD maths was carried over

Each operator was measured in TouchDesigner 2025.33230 rather than assumed. These are the
results the components depend on:

- **Colour.** The .toe runs with `workingColorSpace = PASS_THROUGH`: every TOP holds
  sRGB-encoded 8-bit values and does its maths on them. Loom works in linear light with
  straight alpha. Both components therefore encode at the input (`wgsl_encode*`), run every
  node in between at `rgba8unorm` like TD's 8-bit TOPs (which also gives TD's clamping), and
  decode at the output (`wgsl_decode*`). Thresholds, brightness, soft light and emboss keep
  their TD values.
- **Composite defaults to Multiply** in TD, which makes comp1 and comp4 multiplies.
- **Soft Light** is `(1 − 2b)·a² + 2b·a` (Pegtop), with a = input 0.
- **Threshold "Less"** keeps what is above the threshold: Loom's `greater`. Both are
  `smoothstep(t − s/2, t + s/2, luminance)`. With soften 0.75, black keeps about 40% cover.
- **Level** applies brightness before gamma, `(x·b)^(1/g)`, so it takes two Loom Levels.
- **Slope** is `0.5 · strength · d/dpx`, so slope1's strength 5 is 2.5 on Loom's Slope.
- **Emboss** is `midpoint − strength · (central difference along Direction, y up) / (|cos| + |sin|)`.
  That is a 3 × 3 kernel on the luminance, so Reorder + Convolve reproduce it exactly. Loom's
  Slope in Emboss mode uses a Sobel kernel, which answers the per-pixel grain only 0.6 as
  strongly. Together with a 1.28 px grain cell, that first version darkened 0.6% of pixels
  by more than 20 levels, against TD's 2.3%.
- **Noise.** Loom's noise is not TD's, so the flow fields are calibrated to TD's measured
  output on the same 1280² 8-bit canvas instead of copying periods. For noise2 (Loom against
  TD): std 0.272 vs 0.269, 4.3%/3.9% clipped vs 3.9%/3.9%, and autocorrelation
  0.81/0.65/0.38 vs 0.81/0.64/0.36 at 16/32/64 px. noise4 is a "noise at a noise": a Remap of
  a second field at the first one's value. It gives std 0.279 vs 0.274–0.279 and lag-1
  autocorrelation 0.38 vs 0.22–0.38 (TD's own value drifts with time). The warp fields are
  only ever read at the 256 values an 8-bit map can hold, so they render at 320 × 320.

## Compared with the TD original

drmbt's COMP was exported from the .toe as a .tox (the .toe was not modified) and run in a
second TouchDesigner instance. Loom's components were rendered on Dawn with the harness. Both
were given the same 1280² frame bytes: 2.0 s into `ai-standin-portraits.mp4`, and for the key
2.0 s into `painting-loop-angels.mp4`.

| Watercolor, steady state | input | TD | Loom |
|---|---|---|---|
| mean RGB (0–255) | 143.2 114.1 98.2 | 138.5 109.3 93.3 | 138.3 109.2 93.3 |
| texture (mean \|Laplacian\| of luma) | 1.99 | 15.84 | 15.38 |
| pixels darkened > 10 by the relief | | 16.7% | 15.7% |
| pixels darkened > 20 | | 2.3% | 1.6% |
| pixels brightened > 10 by the trail | | 1.5% | 0.9% |

`Bypass` returns the input byte for byte. PaintingKey against TD's thresh1 → comp3 → comp4 on
the same frames gives a mean absolute difference of 0.33/255 on the bright frame. On a frame
with a dark surround, where the soft key shows the painting through, it is 0.72/255 (99th
percentile 3 levels). See `td-vs-loom.jpg`.

**What still differs**

- slope1 measures over ±5 px (Prev/Next, offset 5). Loom's Slope is a ±1 px Sobel, so the
  bleed acts on a narrower band, with stronger pushes. This is the "brightened by the trail"
  line in the table.
- The noise harmonics are 8 instead of 10, and the fields are statistically matched, not
  identical. Its flow is a different instance of the same kind of field.
- TD's speed1 stops when `Bypass` is on or `Drywet` is 0. Here `Speed` always runs, which only
  matters for where the field resumes. `Resetpulse` is not on the page: Loom's reset-feedback
  command resets the trail.
- Grain cells are one pixel at a 1280-pixel frame (Random has a 0.001 period floor, so
  `noise_grain` scales by 0.78125). On other sizes the grain scales with the frame.
- The NVIDIA ×2 upscaler (Windows/RTX only) and everything upstream of the SD output (depth
  camera, MediaPipe, wrist glow, angels overlay, the painting controller) are not part of the
  look and are not here.

## Media

The movies are untracked working copies of 204.ai material:

- `ai-standin-portraits.mp4` is `feat-ciurlionis-5a3485.mp4` from the 204.ai site.
- `painting-loop-angels.mp4` is 212–224 s of `Ciurlionis_Narrative_Journey_720p.mp4`, centre
  crop 472 × 720.
- `painting-loop-background.mp4` is the KBC mirror's `background_ciurlionis_2.mp4`, scaled
  to 576 × 788.

The show's own loops (`ciurlionis_loop_1_friendship` / `loop_2_angels`, 1152 × 1760) are on
the 204.ai shared drive. Point `movie_angels` and `movie_friendship` at them for the real
thing.

## How these files were made

No published agent tool can do this yet. `save_project` needs the `localFile` capability,
which nothing issues, and a headless server cannot hold `componentInstall`. So the files were
authored the way Loom's starter components are. A flat network went through
`component.saveSelection`, `graph.layoutAll` and `component.publishParameter` on the domain
command bus. It was then written through the checked save (`buildCheckedProjectFile`) and
loaded back through `runExample`, the gates and the app.
