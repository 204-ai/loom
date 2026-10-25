import type { NodeDefinition } from "../../domain/types/node-definition.ts";
import { RGBA_TEXTURE } from "./common-ports.ts";
import { SINK_TAG } from "./sink.ts";

/**
 * T955 — STREAM OUT: the first video-out that needs no helper and no desktop app. WHIP
 * (RFC 9725) is one HTTP POST of an SDP offer, then plain WebRTC, so a browser tab can feed
 * an engine (sd-webrtc's `/whip`) or a media server directly.
 *
 * The Syphon/NDI shape, not Window Out's: the session presents the UPSTREAM resource as it
 * is (`use-whip-out.ts`), so there is no sink target and no extra pass here. That makes the
 * colour the input's own — presentation is a raw blit (§V70a) — and the pump therefore
 * refuses an input that is not display-encoded rather than stream a linear picture.
 *
 * Its side effect is the world-acting kind (`emits`): a take or an offline render never
 * transmits, and an empty URL sends nothing (no default destination, as for OSC Out).
 */
export const WHIP_OUT_TYPE = "whipOut";
export const whipOutNode: NodeDefinition = {
  type: WHIP_OUT_TYPE, version: 1, title: "WHIP Out", category: "output",
  description:
    "Streams its input over WebRTC to a WHIP endpoint (an engine's /whip, a media server), at the input's resolution and preferring H.264. The input must be display-encoded: set the upstream node's Format to rgba8unorm-srgb (Common), or nothing is sent. Sends only in a live session: a take or an offline render transmits nothing, and an empty URL sends nothing.",
  tags: [SINK_TAG, "whip", "webrtc", "stream", "video", "network"], sink: true, sideEffect: "emits",
  previewInput: "input",
  inputs: [{ id: "input", label: "Input", type: RGBA_TEXTURE }], outputs: [],
  parameters: {
    url: {
      type: "string", label: "URL", default: "",
      description: "The WHIP endpoint the offer is POSTed to, e.g. http://127.0.0.1:8766/whip. Empty sends nothing: there is no default destination.",
    },
    fps: {
      type: "number", label: "FPS", default: 30, min: 1, max: 60, range: "soft", step: 1, precision: 0,
      description: "Frames per second the stream captures at. A frame is only sent when the input has a new one, so the project's frame rate is the ceiling.",
    },
    enabled: {
      type: "boolean", label: "Send", default: true,
      description: "Off closes the stream (and DELETEs the session); on opens it again.",
    },
  },
  // The session presents the upstream resource directly. No graph copy or sink target.
  compile: () => ({ passes: [] }),
};
