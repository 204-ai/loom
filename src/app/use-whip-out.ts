import { useEffect, useMemo, useRef, useState } from "react";
import type { CompiledGraph } from "@compiler/index.ts";
import type { FlatGraph } from "@domain/types/graph.ts";
import type { DiagnosticSeverity, RuntimeDiagnostic } from "@domain/types/diagnostics.ts";
import { isSilencedSource } from "@domain/graph/bypass.ts";
import { parameterReadOptions, resolveParameters, resolveStored } from "@domain/parameters/index.ts";
import { EMISSION_PUMPS } from "@domain/render/emission-pumps.ts";
import { emissionRefusal } from "@domain/render/side-effects.ts";
import { createWhipSender } from "@devices/whip-sender.ts";
import type { LoomBackend } from "@runtime/backend/index.ts";
import type { PresentableCanvas } from "@runtime/backend/backend-types.ts";
import type { AppRuntime } from "./app-runtime.ts";
import { renderRangeHolderFor } from "./render-range.ts";

/**
 * T955 — THE WHIP PUMP: the only place a WHIP Out node's picture leaves the process.
 *
 * Per live node: the upstream resource is presented into a canvas outside the document
 * (the Syphon/NDI shape — no sink target, no extra pass), the canvas is captured at the
 * node's FPS, and the track goes to `src/devices/whip-sender.ts`, which POSTs the offer and
 * keeps the connection up. Everything about WHETHER to send is decided here, every frame:
 *
 *  - `emissionRefusal` — a take (and so every offline render the app runs) closes every
 *    stream and says why; `suspend` closes them before a take's first frame is encoded,
 *    since a presentation keeps painting during a take. A headless export or a gate never
 *    mounts this hook at all (§V840).
 *  - Send off, or no URL: nothing is opened. There is no default destination.
 *  - An input that is not display-encoded is REFUSED rather than streamed: presentation is a
 *    raw blit (§V70a), so a linear texture would leave as a dark picture. The fix is one
 *    knob, and the diagnostic names it.
 *
 * The node set is derived from the ledger by this file's own path (§T1006), never a
 * hand-list.
 */
const PUMP_PATH = "src/app/use-whip-out.ts";
const TYPES = new Set(
  Object.entries(EMISSION_PUMPS)
    .filter(([, path]) => path === PUMP_PATH)
    .map(([type]) => type),
);

/** What a stream presents: one compiled texture. */
export interface WhipSelection {
  readonly resourceId: string;
  readonly size: readonly [number, number];
}

/** One node's live stream, as the pump drives it. */
export interface WhipStream {
  update(selection: WhipSelection): void;
  state(): "connecting" | "live" | "failed";
  reason(): string;
  close(): void;
}

export type OpenWhipStream = (backend: LoomBackend, selection: WhipSelection, url: string, fps: number) => WhipStream;

/** The browser door: present into a canvas, capture it at `fps`, send the track. */
export const openWhipStream: OpenWhipStream = (backend, selection, url, fps) => {
  const canvas = document.createElement("canvas");
  canvas.width = selection.size[0];
  canvas.height = selection.size[1];
  // "source": a canvas outside the document has no layout box to size it by.
  const presentation = backend.present(canvas as unknown as PresentableCanvas, {
    outputId: selection.resourceId,
    label: "whip",
    sizing: "source",
  });
  const captured = canvas.captureStream(fps);
  const track = captured.getVideoTracks()[0];
  if (track === undefined) {
    presentation.dispose();
    throw new Error("this browser cannot capture a canvas as a video track");
  }
  const sender = createWhipSender(track, captured, url);
  return {
    update: (next) => presentation.setOutput(next.resourceId),
    state: () => sender.state(),
    reason: () => sender.reason(),
    close() {
      sender.close();
      track.stop();
      presentation.dispose();
    },
  };
};

interface Entry {
  readonly key: string;
  selectionKey: string;
  readonly stream: WhipStream;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function useWhipOut(
  runtime: AppRuntime,
  backend: LoomBackend | null,
  graph: FlatGraph,
  compiled: CompiledGraph | null,
  open: OpenWhipStream = openWhipStream,
) {
  const [diagnostics, setDiagnostics] = useState<readonly RuntimeDiagnostic[]>([]);
  const requests = useMemo(() => {
    const demanded = new Set(compiled?.order);
    return Object.values(graph.nodes)
      .filter((node) => TYPES.has(node.type) && !isSilencedSource(node))
      .map((node) => {
        const definition = runtime.registry.get(node.type)!;
        // The document (`resolveStored`): a stream is keyed on these, per revision.
        const values = resolveStored(node, definition).values;
        const url = String(values["url"] ?? "").trim();
        const fps = Math.max(1, Math.round(Number(values["fps"]) || 30));
        // Send follows a driven value, read once per frame by the tick (as Publish does, §T1559b).
        const enabled = () =>
          resolveParameters(node, definition, parameterReadOptions({ ...runtime.bus.readScope(), graph })).values["enabled"] === true;
        const edge = Object.values(graph.edges).find((candidate) => candidate.target.nodeId === node.id && candidate.target.portId === "input");
        const source = compiled?.outputs.find((output) => output.nodeId === edge?.source.nodeId && output.portId === edge.source.portId);
        const selection: WhipSelection | null = source && demanded.has(node.id) ? { resourceId: source.resourceId, size: source.size } : null;
        const encoded = source === undefined || source.space === "encoded" || source.format === "rgba8unorm-srgb";
        return {
          id: node.id,
          definition,
          url,
          fps,
          enabled,
          selection,
          encoded,
          format: source?.format ?? "",
          selectionKey: JSON.stringify(selection),
          key: JSON.stringify([url, fps]),
        };
      });
  }, [graph, compiled, runtime.registry, runtime.bus]);
  const latest = useRef(requests);
  latest.current = requests;
  const controller = useRef<{ suspend(): void } | null>(null);

  useEffect(() => {
    if (!backend) return;
    const entries = new Map<string, Entry>();
    const messages = new Map<string, RuntimeDiagnostic>();
    let disposed = false;
    let frame = 0;
    // The backend's frames: a perform window's while it drives the show (T1409b).
    const frames = backend.frames ?? window;
    const report = (id: string, message: string | null, code = "whip.output", severity: DiagnosticSeverity = "warning") => {
      if (disposed) return;
      const was = messages.get(id);
      if (message === null) {
        if (was === undefined) return;
        messages.delete(id);
      } else {
        if (was?.message === message && was.code === code && was.severity === severity) return;
        messages.set(id, { nodeId: id, severity, code, message });
      }
      setDiagnostics([...messages.values()]);
    };
    const close = (id: string, entry: Entry) => {
      entries.delete(id);
      entry.stream.close();
    };
    const owned = {
      suspend() {
        for (const [id, entry] of entries) close(id, entry);
      },
    };
    controller.current = owned;
    setDiagnostics([]);

    const tick = () => {
      if (disposed) return;
      const wanted = latest.current;
      const policy = renderRangeHolderFor(runtime.bus).current?.busy() === true ? "blocked" : "live-session";
      const enabled = new Map(wanted.map((request) => [request.id, request.enabled()]));
      for (const [id, entry] of entries) {
        const request = wanted.find((candidate) => candidate.id === id);
        if (
          !request ||
          request.key !== entry.key ||
          policy === "blocked" ||
          !enabled.get(id) ||
          request.url === "" ||
          !request.selection ||
          !request.encoded
        ) {
          close(id, entry);
        }
      }
      for (const id of messages.keys()) if (!wanted.some((request) => request.id === id)) report(id, null);
      for (const request of wanted) {
        const refusal = emissionRefusal(request.definition, policy);
        if (refusal) {
          report(request.id, refusal, "sideEffect.blocked");
          continue;
        }
        if (!enabled.get(request.id)) {
          report(request.id, null);
          continue;
        }
        if (request.url === "") {
          report(request.id, "WHIP Out sends nothing until its URL names a WHIP endpoint.", "whip.output", "info");
          continue;
        }
        if (!request.selection) {
          report(request.id, "Connect a compiled texture to WHIP Out.");
          continue;
        }
        if (!request.encoded) {
          report(
            request.id,
            `WHIP Out sends the bytes it is given, and its input is ${request.format} in linear light: set the upstream node's Format to rgba8unorm-srgb (Common) so the stream carries display colour.`,
          );
          continue;
        }
        let entry = entries.get(request.id);
        if (entry === undefined) {
          try {
            entry = { key: request.key, selectionKey: request.selectionKey, stream: open(backend, request.selection, request.url, request.fps) };
            entries.set(request.id, entry);
          } catch (error) {
            report(request.id, `WHIP Out could not start: ${messageOf(error)}.`);
            continue;
          }
        } else if (entry.selectionKey !== request.selectionKey) {
          entry.selectionKey = request.selectionKey;
          entry.stream.update(request.selection);
        }
        const state = entry.stream.state();
        if (state === "live") report(request.id, null);
        else if (state === "connecting") report(request.id, `WHIP Out is connecting to ${request.url}.`, "whip.output", "info");
        else report(request.id, `WHIP Out cannot reach ${request.url} (${entry.stream.reason()}); retrying.`);
      }
      frame = frames.requestAnimationFrame(tick);
    };
    frame = frames.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      frames.cancelAnimationFrame(frame);
      if (controller.current === owned) controller.current = null;
      for (const [id, entry] of entries) close(id, entry);
    };
  }, [backend, runtime.bus, runtime.documentIdentity, open]);

  return { diagnostics, suspend: () => controller.current?.suspend() };
}
