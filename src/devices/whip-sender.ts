import { browserLater, endSession, exchangeSdp, gathered, type Later, type SdpFetch } from "./webrtc-http.ts";

/**
 * T955 — ONE VIDEO TRACK OUT TO A WHIP ENDPOINT (RFC 9725).
 *
 * A send-only offer carrying the track, complete after ICE gathering, POSTed once
 * (`webrtc-http.ts`); the answer comes back with the session's Location, which `close`
 * DELETEs. A server that is not up yet, refuses, or drops the connection is retried every
 * few seconds until `close`, and `state`/`reason` say where it stands, for the pump's
 * diagnostic.
 *
 * H.264 is preferred when the browser can send it (sd-webrtc and most media servers decode
 * it in hardware; VP8 is what WebRTC falls back to), and the bitrate ceiling is raised from
 * the browser's default to 12 Mbps with resolution held — what realtime-client's engine
 * uplink uses, so a 1024×512 control-packed frame is not blurred into the skeleton half.
 *
 * LAN only: `iceServers: []`, as for the WHEP camera and the phone camera.
 *
 * This module is the transport and nothing else: it knows no node, no ledger and no policy.
 * Whether to send at all is the pump's question (`use-whip-out.ts`).
 */

/** The members of `RTCRtpTransceiver` used here. */
export interface WhipTransceiver {
  setCodecPreferences?(codecs: readonly RTCRtpCodec[]): void;
  readonly sender?: {
    getParameters?(): RTCRtpSendParameters;
    setParameters?(parameters: RTCRtpSendParameters): Promise<void>;
  };
}

/** The members of `RTCPeerConnection` used here. Structural, so a test hands in a fake. */
export interface WhipPeerConnection {
  readonly connectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: { readonly sdp: string } | null;
  onconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  addTransceiver(track: MediaStreamTrack, init: { direction: "sendonly"; streams: MediaStream[] }): WhipTransceiver;
  createOffer(): Promise<{ readonly type: string; readonly sdp?: string }>;
  setLocalDescription(description: { readonly type: string; readonly sdp?: string }): Promise<void>;
  setRemoteDescription(description: { readonly type: "answer"; readonly sdp: string }): Promise<void>;
  close(): void;
}

export interface WhipSenderEnvironment {
  createPeer(): WhipPeerConnection;
  fetch: SdpFetch;
  later: Later;
  /** The browser's sendable video codecs, for the H.264 preference. Null where none are reported. */
  videoCodecs(): readonly RTCRtpCodec[] | null;
}

export function browserWhipSenderEnvironment(): WhipSenderEnvironment {
  return {
    createPeer: () => new RTCPeerConnection({ iceServers: [] }) as unknown as WhipPeerConnection,
    fetch: (url, init) => fetch(url, init),
    later: browserLater,
    videoCodecs: () => RTCRtpSender.getCapabilities?.("video")?.codecs ?? null,
  };
}

/** How long after a failure (or a lost connection) the next attempt starts. */
export const WHIP_RETRY_MS = 2000;
/** The send ceiling, in bits per second. */
export const WHIP_MAX_BITRATE = 12_000_000;

/** The same codecs, H.264 first, the rest (VP8, RTX, FEC) in the browser's own order. */
export function preferH264(codecs: readonly RTCRtpCodec[]): RTCRtpCodec[] {
  const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264");
  return [...h264, ...codecs.filter((codec) => !h264.includes(codec))];
}

export type WhipSenderState = "connecting" | "live" | "failed";

export interface WhipSender {
  state(): WhipSenderState;
  /** Why the last attempt failed; empty while connecting or live. */
  reason(): string;
  /** Close the connection and DELETE the session. Idempotent. */
  close(): void;
}

export function createWhipSender(
  track: MediaStreamTrack,
  stream: MediaStream,
  url: string,
  env: WhipSenderEnvironment = browserWhipSenderEnvironment(),
): WhipSender {
  let peer: WhipPeerConnection | null = null;
  let resource: string | null = null;
  let state: WhipSenderState = "connecting";
  let reason = "";
  let closed = false;
  let cancelRetry: (() => void) | null = null;
  let attempt = 0;

  const release = (): void => {
    if (peer !== null) {
      peer.onconnectionstatechange = null;
      peer.onicegatheringstatechange = null;
      peer.close();
      peer = null;
    }
    endSession(env.fetch, resource);
    resource = null;
  };

  const retry = (why: string): void => {
    if (closed) return;
    state = "failed";
    reason = why;
    release();
    cancelRetry?.();
    cancelRetry = env.later(() => {
      cancelRetry = null;
      void connect();
    }, WHIP_RETRY_MS);
  };

  async function connect(): Promise<void> {
    if (closed) return;
    attempt += 1;
    const mine = attempt;
    const current = env.createPeer();
    peer = current;
    const transceiver = current.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    const codecs = env.videoCodecs();
    if (codecs !== null && codecs.length > 0) {
      // Best effort: a browser that rejects the list sends its default codec instead.
      try {
        transceiver.setCodecPreferences?.(preferH264(codecs));
      } catch {
        /* the default order stands */
      }
    }
    current.onconnectionstatechange = () => {
      if (mine !== attempt) return;
      const now = current.connectionState;
      if (now === "connected") {
        state = "live";
        reason = "";
      } else if (now === "failed" || now === "closed") {
        retry(`the connection ${now}`);
      }
    };
    try {
      await current.setLocalDescription(await current.createOffer());
      await gathered(current, env.later);
      if (mine !== attempt || closed) return;
      const { answer, resource: session } = await exchangeSdp(env.fetch, url, current.localDescription?.sdp ?? "");
      if (mine !== attempt || closed) {
        endSession(env.fetch, session);
        return;
      }
      resource = session;
      await current.setRemoteDescription({ type: "answer", sdp: answer });
      raiseCeiling(transceiver);
    } catch (error) {
      if (mine !== attempt) return;
      retry(error instanceof Error ? error.message : String(error));
    }
  }

  void connect();

  return {
    state: () => state,
    reason: () => reason,
    close() {
      if (closed) return;
      closed = true;
      cancelRetry?.();
      cancelRetry = null;
      release();
    },
  };
}

/** 12 Mbps, resolution held. Best effort: a browser without the knob keeps its defaults. */
function raiseCeiling(transceiver: WhipTransceiver): void {
  const sender = transceiver.sender;
  const parameters = sender?.getParameters?.();
  if (sender?.setParameters === undefined || parameters === undefined) return;
  const encodings = parameters.encodings.length > 0 ? parameters.encodings : [{}];
  void sender
    .setParameters({
      ...parameters,
      encodings: encodings.map((encoding) => ({ ...encoding, maxBitrate: WHIP_MAX_BITRATE })),
      degradationPreference: "maintain-resolution",
    } as RTCRtpSendParameters)
    .catch(() => undefined);
}
