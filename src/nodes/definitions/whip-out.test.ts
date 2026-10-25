import { expect, it } from "vitest";
import { compileGraph } from "@compiler/compile.ts";
import { createAppRuntime } from "../../app/app-runtime.ts";
import { actsOnWorld } from "@domain/render/side-effects.ts";
import { whipOutNode } from "./whip-out.ts";

/** T955 — WHIP Out compiles to nothing of its own: the pump presents the upstream resource. */

it("is a world-acting sink with no destination until one is named", () => {
  expect(actsOnWorld(whipOutNode)).toBe(true);
  expect(whipOutNode.outputs).toEqual([]);
  expect(whipOutNode.sink).toBe(true);
});

it("keeps the upstream resource without allocating a sink target or an extra pass", async () => {
  const runtime = createAppRuntime({ identityStorage: null, actor: { kind: "human", id: "test", label: "Test" } });
  const result = await runtime.bus.execute("graph.applyPatch", {
    baseRevision: runtime.bus.store.getRevision(),
    label: "WHIP sink",
    operations: [
      { op: "addNode", ref: "$source", type: "checker", position: { x: 0, y: 0 } },
      { op: "setNodeResolution", nodeId: "$source", resolution: { mode: "fixed", width: 1024, height: 512 } },
      { op: "addNode", ref: "$sink", type: whipOutNode.type, position: { x: 300, y: 0 } },
      { op: "connect", source: { nodeId: "$source", portId: "out" }, target: { nodeId: "$sink", portId: "input" } },
    ],
  }, runtime.invocation);
  expect(result.status).toBe("applied");
  if (result.status !== "applied") return;
  const source = result.output.createdIds["$source"]!;
  const sink = result.output.createdIds["$sink"]!;
  const compiled = compileGraph({
    graph: runtime.bus.store.getGraph(),
    registry: runtime.registry,
    settings: runtime.settings,
    capabilities: { tier: "B", features: [], formats: ["rgba8unorm-srgb", "rgba8unorm", "rgba16float"], timestampQuery: false, limits: { maxTextureDimension2D: 8192 } },
  });
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ok).toBe(true);
  expect(compiled.order).toContain(sink);
  expect(compiled.outputs.find((output) => output.nodeId === source)?.size).toEqual([1024, 512]);
  expect(compiled.passes).toHaveLength(1);
  expect(compiled.outputs.some((output) => output.nodeId === sink)).toBe(false);
});
