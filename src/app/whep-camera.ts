import {
  browserLater,
  endSession,
  exchangeSdp,
  gathered,
  GATHER_TIMEOUT_MS,
  type Later,
  type SdpExchangeResponse,
  type SdpFetch,
} from "@devices/webrtc-http.ts";
import { cameraGrantOf, type CameraGrant, type CameraTrackSettings } from "./camera-request.ts";
import type { MediaElement } from "./media-sources.ts";
import type { OpenedCamera } from "./use-media-sources.ts";

/**
 * A WHEP STREAM IS A WEBCAM DEVICE. `device: "whep:<url>"` (`media.ts`) plays whatever a
 * WHEP endpoint serves — an engine's output, a camera re-published by a media server —
 * through the Webcam node's own element path, the way `phone:<name>` does for a phone. One
 * camera node rather than a stream node, by the same owner's rule: fewer concepts.
 *
 * The handshake is `webrtc-http.ts`: a receive-only offer, complete after ICE gathering,
 * POSTed once; the answer comes back with the session's Location.
 *
 * ## Never refuses, keeps trying
 *
 * Opening hands the element back at once, like a phone. A server that is not up yet, or
 * one that restarts, is retried every few seconds for as long as the node lives, and
 * meanwhile `waiting` says which URL and why — the inspector's Camera line shows it. The
 * node's texture keeps its last frame.
 *
 * ## Teardown
 *
 * `stop` closes the connection and `DELETE`s the session. A cross-origin server that does
 * not expose `Location` (CORS hides it unless listed in Expose-Headers) gets no DELETE;
 * closing the connection ends the session on its side anyway.
 *
 * ## LAN only: `iceServers: []`
 *
 * No STUN, no TURN — the same rule as the phone camera (`phone-camera-receiver.ts`).
 */

/** The members of `RTCPeerConnection` used here. Structural, so a test hands in a fake. */
export interface WhepPeerConnection {
  readonly connectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: { readonly sdp: string } | null;
  ontrack: ((event: { readonly streams: readonly MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  addTransceiver(kind: "video", init: { readonly direction: "recvonly" }): unknown;
  createOffer(): Promise<{ readonly type: string; readonly sdp?: string }>;
  setLocalDescription(description: { readonly type: string; readonly sdp?: string }): Promise<void>;
  setRemoteDescription(description: { readonly type: "answer"; readonly sdp: string }): Promise<void>;
  close(): void;
}

export type WhepResponse = SdpExchangeResponse;

/** A `<video>` the camera points at the stream that arrived. */
export interface WhepVideo {
  readonly element: MediaElement;
  show(stream: MediaStream | null): void;
  stop(): void;
}

/** Where the camera meets the browser. Injectable: jsdom has no WebRTC, no fetch to a server. */
export interface WhepCameraEnvironment {
  createPeer(): WhepPeerConnection;
  createVideo(): WhepVideo;
  fetch: SdpFetch;
  later: Later;
}

export function browserWhepCameraEnvironment(): WhepCameraEnvironment {
  return {
    createPeer: () => new RTCPeerConnection({ iceServers: [] }) as unknown as WhepPeerConnection,
    createVideo() {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      return {
        element: video as unknown as MediaElement,
        show(stream) {
          video.srcObject = stream;
          // Kicked, never awaited (T493): a stream that never produces a frame must not hang this.
          if (stream !== null) void video.play().catch(() => undefined);
        },
        stop() {
          video.pause();
          video.srcObject = null;
        },
      };
    },
    fetch: (url, init) => fetch(url, init),
    later: browserLater,
  };
}

/** How long to wait for ICE gathering before sending what there is. */
export const WHEP_GATHER_TIMEOUT_MS = GATHER_TIMEOUT_MS;
/** How long after a failure (or a lost connection) the next attempt starts. */
export const WHEP_RETRY_MS = 2000;

export type WhepCameraState = "connecting" | "live" | "failed";

/**
 * Opens `url` as a camera. Never throws and never waits: the element comes back at once and
 * shows the stream from the moment it arrives.
 */
export function openWhepCamera(url: string, env: WhepCameraEnvironment = browserWhepCameraEnvironment()): OpenedCamera {
  const video = env.createVideo();
  let peer: WhepPeerConnection | null = null;
  let resource: string | null = null;
  let stream: MediaStream | null = null;
  let state: WhepCameraState = "connecting";
  let reason = "";
  let stopped = false;
  let cancelRetry: (() => void) | null = null;
  /** Bumped per attempt, so a late answer to an abandoned attempt changes nothing. */
  let attempt = 0;

  const release = (): void => {
    if (peer !== null) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.onicegatheringstatechange = null;
      peer.close();
      peer = null;
    }
    endSession(env.fetch, resource);
    resource = null;
  };

  const retry = (why: string): void => {
    if (stopped) return;
    state = "failed";
    reason = why;
    release();
    cancelRetry?.();
    cancelRetry = env.later(() => {
      cancelRetry = null;
      void connect();
    }, WHEP_RETRY_MS);
  };

  async function connect(): Promise<void> {
    if (stopped) return;
    attempt += 1;
    const mine = attempt;
    const current = env.createPeer();
    peer = current;
    current.addTransceiver("video", { direction: "recvonly" });
    current.ontrack = (event) => {
      const arrived = event.streams[0];
      if (arrived === undefined || arrived === stream) return;
      stream = arrived;
      video.show(arrived);
    };
    current.onconnectionstatechange = () => {
      if (mine !== attempt) return;
      const now = current.connectionState;
      if (now === "connected") {
        state = "live";
        reason = "";
      } else if (now === "failed" || now === "closed") {
        retry(`the connection ${now}`);
      }
      // `disconnected` is often a moment ICE recovers from on its own; `failed` follows if not.
    };
    try {
      await current.setLocalDescription(await current.createOffer());
      await gathered(current, env.later);
      if (mine !== attempt || stopped) return;
      const { answer, resource: session } = await exchangeSdp(env.fetch, url, current.localDescription?.sdp ?? "");
      if (mine !== attempt || stopped) {
        endSession(env.fetch, session);
        return;
      }
      resource = session;
      await current.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (mine !== attempt) return;
      retry(error instanceof Error ? error.message : String(error));
    }
  }

  void connect();

  return {
    element: video.element,
    // Read per call (§V986): the element's decoded size over whatever the track reports.
    grant(): CameraGrant | null {
      const track = stream?.getVideoTracks?.()[0];
      const settings: CameraTrackSettings = { ...(track?.getSettings?.() ?? {}) };
      const { videoWidth, videoHeight } = video.element;
      return cameraGrantOf(videoWidth > 0 && videoHeight > 0 ? { ...settings, width: videoWidth, height: videoHeight } : settings);
    },
    limits: () => null,
    waiting: () => {
      if (state === "live") return null;
      if (state === "connecting") return `The WHEP stream at ${url} is connecting.`;
      return `The WHEP stream at ${url} is not playing (${reason}); retrying.`;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelRetry?.();
      cancelRetry = null;
      release();
      video.stop();
    },
  };
}
