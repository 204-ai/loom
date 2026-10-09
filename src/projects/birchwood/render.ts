import { mkdirSync, writeFileSync } from "node:fs";
import { renderHeadless, type RenderedFrame } from "../../tests/headless/render-harness.ts";
import { nodeGpuHost } from "../../runtime/backend/vgpu/node-gpu-host.ts";
import { encodePng } from "../../runtime/export/png.ts";
import { toRgba8At } from "../../runtime/export/image.ts";
import { birchwoodDocument } from "./document.ts";

/**
 * Render birchwood stills headless on Dawn.
 *
 *   node --import ./src/tooling/alias-hooks.ts src/projects/birchwood/render.ts -- [--at 4,4.1,4.2] [--out renders/birchwood]
 *     [--strip 8,2]   every frame from 8 s for 2 s
 *     [--luma]        print each frame's mean luma instead of writing PNGs
 *
 * Every animated thing runs on absTime from 0; the drives play the document's own beat.
 */
const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name: string): string | undefined => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const fps = 30;
const strip = flag("strip")?.split(",").map(Number);
const times = strip === undefined
  ? (flag("at") ?? "4").split(",").map(Number)
  : Array.from({ length: Math.round(strip[1]! * fps) }, (_, i) => strip[0]! + i / fps);
const outDir = flag("out") ?? "renders/birchwood";
const capture = times.map((seconds) => Math.round(seconds * fps));
const document = birchwoodDocument();
mkdirSync(outDir, { recursive: true });
const toRgba8 = (frame: RenderedFrame) =>
  toRgba8At({ ...frame, rowStride: frame.width * (frame.format === "rgba16float" ? 8 : 4) } as never, frame.width, frame.height, { space: "encoded" });
const result = await renderHeadless({
  host: nodeGpuHost(),
  graph: document.graph,
  settings: document.settings,
  frames: Math.max(...capture) + 1,
  capture,
  fps,
  outputNodeId: "output_frame",
  animate: true,
  strict: true,
});
for (const finding of result.findings) console.log(`${finding.diagnostic.severity} ${finding.diagnostic.code}: ${finding.diagnostic.message}`);
const lumaOnly = argv.includes("--luma");
for (const frame of result.frames) {
  const rgba = toRgba8(frame).data;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  if (lumaOnly) {
    console.log(`${(frame.frameIndex / fps).toFixed(2)}s mean luma ${(sum / (rgba.length / 4)).toFixed(2)}`);
    continue;
  }
  const path = `${outDir}/birchwood@${(frame.frameIndex / fps).toFixed(2)}s.png`;
  writeFileSync(path, encodePng(toRgba8(frame)).bytes);
  console.log(path);
}
