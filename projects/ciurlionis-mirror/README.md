# Čiurlionis mirror look

The look of the Čiurlionis TouchDesigner mirror
(`mirror-ciurlionis/MagicMirror_A1.ciurlionis-THIS-IS-THE-ULTIMATE-VERSION.toe`) as two
reusable Loom components, plus an example network that feeds them a movie in place of the
StreamDiffusion output.

| File | What it is |
|---|---|
| `ciurlionis-mirror.loom.json` | The example network. Carries both components. |
| `mirror-hybrid.loom.json` | The whole mirror as a hybrid with realtime-client and sd-webrtc (see The hybrid). |
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

## The hybrid

`mirror-hybrid.loom.json` is the whole mirror with no code changes anywhere: realtime-client
feeds sd-webrtc, and Loom reads the result, runs the painting controller and draws the look.

```
Femto colour ─► realtime-client [StreamDiffusion | Sense: OpenPose, black | Depth camera, RGB]
                   └─ POST /offer, one track packed [RGB | skeleton] ─► sd-webrtc (openpose ControlNet)
sd-webrtc /whep ─► whep-view "mirror engine" ─► screenin_engine ─► glow, angels ─► flip_mirror
   ─► paintingkey_look ─► watercolor_look ─► cornerpin_projector ─► window_perform, output_main
Femto colour /whep ─► whep-view "mirror camera" (centre square) ─► screenin_camera ─► pose_visitor
   ─► wrists ─► state ─► lag_blend ─► expression_engine ─► oscout_engine
   ─► Loom helper ─► udp 127.0.0.1:9100 ─► bridge.py ─► POST /prompts, /t_index ─► sd-webrtc
```

`bridge.py` and `whep-view.html` live outside this repo, in
`dao-llama/mirror-ciurlionis/bridge/`: a launch script is not a project file.

### Setup

1. **sd-webrtc** on the GPU box, from PR 204-ai/sd-webrtc#15's branch
   (`feat/weighted-prompts-seeds-lora`, which carries `POST /prompts` and `/t_index`). The
   TD build's settings plus the openpose ControlNet:

   ```
   python webrtc_server.py --config configs/sd_0.2.99_depth_v2v_lora.json \
     --set controlnet_model=C:/AI/StreamDiffusion/StreamDiffusion/models/ControlNet/control_v11p_sd21_openpose.safetensors \
     --set controlnet_weight=0.813 --set width=512 --set height=512 \
     --set feature_injection_strength=0.7 --set feature_similarity_threshold=0.3 \
     --set cache_maxframes=4 --set guidance_scale=1.005
   ```

   A ControlNet that fails to load exits the server, and it also needs
   `models/ControlNet/cldm_v21.yaml` under the engine root. The preset's LoRA
   (`ciurlionis_everything_v5` at 1.0) is a `C:/` path, so this runs on the Windows box.
2. **depthcam-studio** on the camera machine: `depthcam-studio` for the Femto, or
   `--source mock`, or `--replay <take>` (PR 204-ai/depthcam-studio#4).
3. **The bridge**, on the Loom machine: `python3 bridge.py --engine http://<gpu-box>:8766`.
   It listens for OSC on 127.0.0.1:9100 and serves `whep-view.html` on
   http://127.0.0.1:9101/. `--dry-run` prints instead of sending.
4. **realtime-client** in Chrome or Edge (packing needs the Streams backend). `yarn dev`, or
   `yarn dev --port 5199 --strictPort` when Loom's dev server already holds 5173. Build the
   stack bottom first, and leave no empty layer between the engine and Sense:
   - **Depth camera**: server `http://<camera-host>:8777`, view **RGB**. TD keyed the visitor
     by depth before diffusion, and **Cut to range** with far set behind the visitor does
     the same. (A **WHEP** clip on mediamtx's `cam-femto` also works, without the key.)
   - **Sense**: OpenPose on, YOLO26 and Pose off, background **Black (no blend)**.
   - **StreamDiffusion**: server `http://<gpu-box>:8766`, Start, controlnet **openpose**
     (packing switches on by itself), cn weight about 0.81, steps 4 and 14. Aspect Auto,
     res 720p: sd-webrtc centre-crops each half to the 512² model.
   - Leave the prompt panel and Autoloop alone. The bridge owns the prompt, t_index,
     guidance, delta and ControlNet scale, and puts them back within 2 s when
     realtime-client's reconnect flush (`tindex:5,10`, `guidance:1`, `delta:0.7`,
     `cn:…:1.2`) or an operator changes them. `--no-keep` turns that off.

   realtime-client saves the stack to localStorage, but not the engine clip's server or
   ControlNet mode: type those again after a reload. To paste the stack in, run this in
   DevTools on the realtime-client page and reload:

   ```js
   localStorage.setItem("fluxrt.composition.v1", JSON.stringify({ version: 1, layers: [
     { name: "SD", kind: "streamdiffusion", opacity: 1, blend: "normal", cells: [{ active: true, clip: { kind: "streamdiffusion", label: "StreamDiffusion", mirror: false } }] },
     { name: "Sense", kind: "sense", opacity: 1, blend: "normal", cells: [{ active: true, clip: { kind: "sense", label: "Sense", mirror: false, effectConfig: { enabled: true, pose: false, openpose: true, yolo: false, detect: false, removeBg: true, face: false, hands: false, numPoses: 1, color: "#39ff88", size: 20 } } }] },
     { name: "Femto", kind: "orbbec", opacity: 1, blend: "normal", cells: [{ active: true, clip: { kind: "orbbec", label: "Femto colour", mirror: false, effectConfig: { serverUrl: "http://<camera-host>:8777", view: "rgb", stride: 2, depthFps: 20 } } }] },
   ] }));
   ```
5. **Two viewer tabs** in the same Chrome as Loom (each costs the server one x264 encode):
   - `http://127.0.0.1:9101/whep-view.html?label=engine&whep=http%3A%2F%2F<gpu-box>%3A8766%2Fwhep`
   - `http://127.0.0.1:9101/whep-view.html?label=camera&square=1&whep=http%3A%2F%2F<camera-host>%3A8777%2Fwhep%3Fstream%3Dcolor`

   `square=1` shows the camera's centre square, which is the square sd-webrtc diffuses. Both
   Screen Ins fill, so a wrist MoveNet finds in the camera lands on the same spot of the
   engine image.
6. **Loom**: `pnpm dev`, File → Open project → `mirror-hybrid.loom.json`.
   - `screenin_engine`: Share tab/window → "mirror engine". `screenin_camera`: → "mirror camera".
   - Pose: **Download** (MoveNet SinglePose Lightning, 8.9 MB, once per machine).
   - OSC: start the helper (`pnpm helper`) and enter its pairing code under Connections in
     the agent panel. `oscout_engine` then sends `/mirror/p3` … `/mirror/step_end` at 15/s.
   - `window_perform` goes fullscreen on the projector.

For an unattended start, Chrome's `--auto-select-tab-capture-source-by-title="mirror engine"`
answers the picker with the tab of that title (`--auto-select-desktop-capture-source` does the
same for a window or screen). It takes one title per launch, and Loom only opens a capture on
a click, so each start still needs the two Share clicks, and the second needs the camera tab
to carry the title. See Limits.

### The network

| TD (.toe) | Loom |
|---|---|
| MediaPipe wrists from SpoutCam | `pose_visitor` (MoveNet) on `screenin_camera`; `transform_lwrist/rwrist` crop keypoints 9 and 10 to one pixel; `analyze_*` → `channelin_*` give x, y (0..1, y down) and confidence |
| filter1 (0.13 s) | `feedback_keypoints` + `cross_keypoints` (0.12 a frame, 0.13 s at 60 fps) |
| painting_logic: borders, `or` mode | `constant_bordertop` 0.35, `borderbottom/left/right` 0.15, `visibility` 0.5; `constant_leftin`, `rightin`, `hands` (max) |
| timer2 (30 s) → count2 → lag1 (2 s) | `constant_scenelength` 30 → `expression_scene` → `lag_scene` 2 s; also drives PaintingKey's Scene |
| STATE_MATRIX, Blendscene on | `expression_state`: p3–p6 and butterfly from scene and hands |
| lag1 Blendtime 0.75 s | `lag_blend` 0.75 s |
| math1, math2 on prompt4 | `expression_engine`: `step_start = round(4 + 16·p4)`, `step_end = round(14 + 11·p4)` |
| Promptdict3–6 weights, t_index | `oscout_engine` → bridge → `POST /prompts` (four fixed slots, blocks 5 and 6 crosswise as in the .toe) and `POST /t_index` |
| circle1 → level4 (opacity hands) | `constant_wristscale` → `circle_glow` → `level_glow` (opacity hands) → `composite_glow` |
| Angels_flying_loop → transform6 (×0.8) → level2 (opacity butterfly), comp6 tx = wrist x + 0.25 | `movie_angelsoverlay` → `level_angelsoverlay` (brightness 2, gamma 2.53, opacity butterfly) → `transform_angelsoverlay` (×0.8, wrist x + 0.25) → `composite_angelsoverlay` (screen) |
| flip X → … → corner1 → out1 | `flip_mirror` → `paintingkey_look` → `watercolor_look` → `cornerpin_projector` → `window_perform` |

### What changed from TD

- **The overlays come after diffusion.** TD drew a white disc at the right wrist and the
  angels loop into StreamDiffusion's input, so SD painted them (the disc comes out as the
  candle or orb light). Here they are drawn over SD's output and SD never sees them: a soft
  warm disc stands in for that light. Drawing them before diffusion would need
  realtime-client to draw at a wrist, which it cannot do today.
- **Wrist scale 1.** TD drew its disc at wrist × 1.2 in its own SpoutCam framing. Here
  MoveNet looks at the same square SD diffuses, so the wrist maps as is; `constant_wristscale`
  is the knob.
- **The angels follow across only**, a quarter frame to the side, at ×0.8, as comp6 and
  transform6 do (transform5 is bypassed in the .toe). The clip is the
  `painting-loop-angels.mp4` stand-in: `Angels_flying_loop.mp4` is not in this repo.
- **Visibility is gated.** The .toe routes no visibility channel, so its gate never fires.
  MoveNet always returns 17 joints, so a joint below 0.5 confidence does not count.
- **The play area is measured on the centre square** SD diffuses, not on MediaPipe's full
  SpoutCam frame.
- **Colour, not mono.** TD keyed the visitor by depth, made it grey (mono1), and zoomed it
  1.2× and down a quarter (transform2) before SD. realtime-client sends the camera in colour
  at 1×. Its clip transform could do the zoom; the camera tab would then need it too.
- **ControlNet is on.** The .toe has `Usecontrolnet` off. This launch line runs the
  openpose model at 0.813, fed by realtime-client's packed skeleton.
- Lags are exponential. TD's lag1 also has slope and acceleration limits, which Loom's Lag
  does not. Prompt blocks 1 and 2 (weight 0 in the .toe) and the ×2 upscaler are left out.

### Tested on this Mac, 2026-10-25

- sd-webrtc `--mock` (PR #15 plus #16, 6c793f3), depthcam-studio `--source mock`,
  realtime-client on :5199 and the bridge, all on 127.0.0.1.
- realtime-client: the restored stack connected to the mock, and with openpose its engine
  input showed the packed `[RGB | skeleton]` frame. The mock centre-crops a packed frame, so
  it is not a ControlNet check.
- Bridge: each state's OSC set produced the right `prompt_list` and `t_index` in `/healthz`.
  After a simulated reconnect flush, `/prompt`, `tindex:5,10`, `guidance:1`, `delta:0.7` and
  `cn scale 1.2` were all put back within one 2 s check.
- Loom: the project opens with only the OSC helper warnings and the Pose model notice, and
  the gates pass. Both Screen Ins captured their viewer tabs in Playwright's Chromium and the
  look ran at 60 fps. The browser pane the rest of the test used blocks screen capture.
- The value graph, evaluated headless: a right wrist inside the borders at 0.9 confidence
  gives p4 and t_index 20, 25. Above the top border, or at 0.3 confidence, it gives p3 and
  4, 14. The scene ramps to p6 over the 2 s lag at 30 s.
- Not run: MoveNet (its weights are not downloaded in the test browser) and the OSC hop
  through the helper (it needs the helper's pairing code).

### Limits

- **Screen In needs a click.** Loom opens a capture only on a click, and Chrome's auto-select
  flag takes one title. An unattended show needs Loom to restore captures on load (with
  Chrome's `ScreenCaptureWithoutGestureAllowedForOrigins` policy), or the engine output on
  an input Loom already has (NDI In, Syphon In, Spout In), which nothing here produces.
- **realtime-client does not save the engine clip's server or ControlNet mode**, and has no
  file export for a composition.
- **OSC Out needs the helper running and the tab paired** with the helper's code.
- **Overlays before diffusion** would need realtime-client to draw at a wrist.

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
  look. The hybrid below carries the controller and the overlays.

## Media

The movies are working copies of 204.ai material:

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
