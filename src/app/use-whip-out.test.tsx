// @vitest-environment jsdom
import { flatDocument } from "@compiler/test-support.ts";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { CompiledGraph } from "@compiler/index.ts";
import type { GraphDocument } from "@domain/types/graph.ts";
import type { LoomBackend } from "@runtime/backend/index.ts";
import { createAppRuntime } from "./app-runtime.ts";
import { renderRangeHolderFor } from "./render-range.ts";
import { useWhipOut, type OpenWhipStream, type WhipSelection, type WhipStream } from "./use-whip-out.ts";

/**
 * T955 — the WHIP pump's decisions, with the browser door (canvas, capture, WebRTC) faked:
 * what opens, at what URL and rate, what refuses and why, and what closes.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface FakeStream extends WhipStream {
  readonly url: string;
  readonly fps: number;
  readonly selection: WhipSelection;
  readonly updates: WhipSelection[];
  closed: number;
  now: "connecting" | "live" | "failed";
}

function setup(parameters: Record<string, unknown>, format = "rgba8unorm-srgb", space = "linear") {
  const runtime = createAppRuntime({ identityStorage: null, actor: { kind: "human", id: "test", label: "Test" } });
  const graph: GraphDocument = {
    revision: 1,
    groups: {},
    nodes: {
      source: { id: "source", type: "checker", definitionVersion: 1, position: { x: 0, y: 0 }, parameters: {} },
      sink: { id: "sink", type: "whipOut", definitionVersion: 1, position: { x: 0, y: 0 }, parameters },
    },
    edges: { wire: { id: "wire", source: { nodeId: "source", portId: "out" }, target: { nodeId: "sink", portId: "input" } } },
  } as unknown as GraphDocument;
  const compiled = {
    order: ["source", "sink"],
    outputs: [{ nodeId: "source", portId: "out", resourceId: "source:out", size: [1024, 512], format, space }],
  } as unknown as CompiledGraph;
  const streams: FakeStream[] = [];
  const open: OpenWhipStream = (_backend, selection, url, fps) => {
    const stream: FakeStream = {
      url,
      fps,
      selection,
      updates: [],
      closed: 0,
      now: "live",
      update: (next) => void stream.updates.push(next),
      state: () => stream.now,
      reason: () => "the server answered 503",
      close: () => {
        stream.closed += 1;
      },
    };
    streams.push(stream);
    return stream;
  };
  let callback: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", vi.fn((fn: FrameRequestCallback) => { callback = fn; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const tick = () => act(async () => { callback(0); });
  const backend = {} as LoomBackend;
  const view = renderHook(
    ({ graph, compiled }) => useWhipOut(runtime, backend, flatDocument(graph), compiled, open),
    { initialProps: { graph, compiled } },
  );
  const messages = () => view.result.current.diagnostics.map((entry) => entry.message);
  return { runtime, graph, compiled, streams, tick, view, messages };
}

const URL_ = "http://127.0.0.1:8766/whip";

it("streams a display-encoded input at its URL and rate, follows a new resource, and closes when deleted", async () => {
  const h = setup({ url: URL_, fps: 24 });
  await h.tick();
  expect(h.streams).toHaveLength(1);
  expect(h.streams[0]).toMatchObject({ url: URL_, fps: 24, selection: { resourceId: "source:out", size: [1024, 512] } });
  expect(h.messages()).toEqual([]);

  const moved = { ...h.compiled, outputs: h.compiled.outputs.map((output) => ({ ...output, resourceId: "source:out#2" })) };
  h.view.rerender({ graph: h.graph, compiled: moved });
  await h.tick();
  expect(h.streams).toHaveLength(1);
  expect(h.streams[0]?.updates).toEqual([{ resourceId: "source:out#2", size: [1024, 512] }]);

  h.view.rerender({ graph: { ...h.graph, nodes: { source: h.graph.nodes["source"]! } }, compiled: moved });
  await h.tick();
  expect(h.streams[0]?.closed).toBe(1);
});

it("refuses a linear input rather than stream a dark picture, and names the fix", async () => {
  const h = setup({ url: URL_ }, "rgba16float", "linear");
  await h.tick();
  expect(h.streams).toHaveLength(0);
  expect(h.messages()[0]).toContain("rgba16float in linear light");
  expect(h.messages()[0]).toContain("rgba8unorm-srgb");
});

it("takes an input the compiler marks display-encoded, whatever its format", async () => {
  const h = setup({ url: URL_ }, "rgba16float", "encoded");
  await h.tick();
  expect(h.streams).toHaveLength(1);
});

it("sends nothing without a URL: there is no default destination", async () => {
  const h = setup({ url: "  " });
  await h.tick();
  expect(h.streams).toHaveLength(0);
  expect(h.view.result.current.diagnostics[0]).toMatchObject({ severity: "info", code: "whip.output" });
});

it("closes on Send off and opens again on Send on", async () => {
  const h = setup({ url: URL_, enabled: true });
  await h.tick();
  const off = { ...h.graph, revision: 2, nodes: { ...h.graph.nodes, sink: { ...h.graph.nodes["sink"]!, parameters: { url: URL_, enabled: false } } } };
  h.view.rerender({ graph: off, compiled: h.compiled });
  await h.tick();
  expect(h.streams[0]?.closed).toBe(1);
  h.view.rerender({ graph: { ...h.graph, revision: 3 }, compiled: h.compiled });
  await h.tick();
  expect(h.streams).toHaveLength(2);
});

it("a take closes every stream and says why; the stream comes back after it", async () => {
  const h = setup({ url: URL_ });
  await h.tick();
  let busy = true;
  renderRangeHolderFor(h.runtime.bus).current = { busy: () => busy, render: vi.fn() } as never;
  await h.tick();
  expect(h.streams[0]?.closed).toBe(1);
  expect(h.messages()[0]).toContain("only a live session");
  expect(h.view.result.current.diagnostics[0]?.code).toBe("sideEffect.blocked");
  busy = false;
  await h.tick();
  expect(h.streams).toHaveLength(2);
  expect(h.messages()).toEqual([]);
});

it("suspend closes the streams at once, before a take's first frame", async () => {
  const h = setup({ url: URL_ });
  await h.tick();
  act(() => h.view.result.current.suspend());
  expect(h.streams[0]?.closed).toBe(1);
});

it("says when the endpoint is not answering, and when it is still connecting", async () => {
  const h = setup({ url: URL_ });
  await h.tick();
  h.streams[0]!.now = "failed";
  await h.tick();
  expect(h.messages()).toEqual([`WHIP Out cannot reach ${URL_} (the server answered 503); retrying.`]);
  h.streams[0]!.now = "connecting";
  await h.tick();
  expect(h.view.result.current.diagnostics[0]).toMatchObject({ severity: "info", message: `WHIP Out is connecting to ${URL_}.` });
});
