import { describe, expect, it } from "vitest";
import {
  createWhipSender,
  preferH264,
  WHIP_MAX_BITRATE,
  WHIP_RETRY_MS,
  type WhipPeerConnection,
  type WhipSenderEnvironment,
  type WhipTransceiver,
} from "./whip-sender.ts";
import { GATHER_TIMEOUT_MS } from "./webrtc-http.ts";

/** T955 — the WHIP transport against a fake peer and a fake server. */

const codec = (mimeType: string, clockRate = 90000): RTCRtpCodec => ({ mimeType, clockRate }) as RTCRtpCodec;

class FakeTransceiver implements WhipTransceiver {
  preferred: readonly RTCRtpCodec[] | null = null;
  parameters: RTCRtpSendParameters = { encodings: [{}], transactionId: "t", codecs: [], headerExtensions: [], rtcp: {} } as unknown as RTCRtpSendParameters;
  set: RTCRtpSendParameters | null = null;
  setCodecPreferences(codecs: readonly RTCRtpCodec[]) {
    this.preferred = codecs;
  }
  readonly sender = {
    getParameters: () => this.parameters,
    setParameters: async (parameters: RTCRtpSendParameters) => {
      this.set = parameters;
    },
  };
}

class FakePeer implements WhipPeerConnection {
  connectionState = "new";
  iceGatheringState = "new";
  localDescription: { sdp: string } | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  readonly added: Array<{ track: MediaStreamTrack; direction: string; streams: MediaStream[] }> = [];
  readonly transceiver = new FakeTransceiver();
  remote: string | null = null;
  closed = false;
  addTransceiver(track: MediaStreamTrack, init: { direction: "sendonly"; streams: MediaStream[] }) {
    this.added.push({ track, ...init });
    return this.transceiver;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 send" };
  }
  async setLocalDescription(description: { sdp?: string }) {
    this.localDescription = { sdp: `${description.sdp ?? ""} +candidates` };
    this.iceGatheringState = "gathering";
  }
  async setRemoteDescription(description: { type: "answer"; sdp: string }) {
    this.remote = description.sdp;
  }
  close() {
    this.closed = true;
  }
  gather() {
    this.iceGatheringState = "complete";
    this.onicegatheringstatechange?.();
  }
  become(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function harness(answers: Array<{ status: number; location?: string; body?: string }>, codecs: readonly RTCRtpCodec[] | null = null) {
  const peers: FakePeer[] = [];
  const sent: Array<{ url: string; method: string; body?: string; type?: string }> = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const env: WhipSenderEnvironment = {
    createPeer() {
      const peer = new FakePeer();
      peers.push(peer);
      return peer;
    },
    async fetch(url, init) {
      sent.push({ url, method: init.method, ...(init.body === undefined ? {} : { body: init.body }), ...(init.headers ? { type: init.headers["Content-Type"] } : {}) });
      if (init.method === "DELETE") return { status: 200, headers: { get: () => null }, text: async () => "" };
      const answer = answers.shift() ?? { status: 503 };
      return {
        status: answer.status,
        headers: { get: (name: string) => (name.toLowerCase() === "location" ? (answer.location ?? null) : null) },
        text: async () => answer.body ?? "",
      };
    },
    later(run, ms) {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    videoCodecs: () => codecs,
  };
  const fire = (ms: number) => {
    for (const timer of timers.splice(0)) if (!timer.cancelled && timer.ms === ms) timer.run();
  };
  return { env, peers, sent, fire };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const URL_ = "http://127.0.0.1:8766/whip";
const track = { kind: "video" } as MediaStreamTrack;
const stream = { id: "canvas" } as unknown as MediaStream;

describe("preferH264", () => {
  it("puts H.264 first and keeps everything else in the browser's order", () => {
    const vp8 = codec("video/VP8");
    const h264a = codec("video/H264");
    const rtx = codec("video/rtx");
    const h264b = codec("video/h264");
    expect(preferH264([vp8, h264a, rtx, h264b])).toEqual([h264a, h264b, vp8, rtx]);
    expect(preferH264([vp8, rtx])).toEqual([vp8, rtx]);
  });
});

describe("createWhipSender", () => {
  it("sends the track send-only, prefers H.264, and POSTs the full offer as application/sdp", async () => {
    const vp8 = codec("video/VP8");
    const h264 = codec("video/H264");
    const h = harness([{ status: 201, location: "/whip/1", body: "v=0 answer" }], [vp8, h264]);
    const sender = createWhipSender(track, stream, URL_, h.env);
    await settle();
    expect(h.peers[0]?.added).toEqual([{ track, direction: "sendonly", streams: [stream] }]);
    expect(h.peers[0]?.transceiver.preferred).toEqual([h264, vp8]);
    expect(h.sent).toEqual([]);

    h.peers[0]?.gather();
    await settle();
    expect(h.sent).toEqual([{ url: URL_, method: "POST", body: "v=0 send +candidates", type: "application/sdp" }]);
    expect(h.peers[0]?.remote).toBe("v=0 answer");
    expect(sender.state()).toBe("connecting");
    h.peers[0]?.become("connected");
    expect(sender.state()).toBe("live");
    sender.close();
  });

  it("raises the bitrate ceiling and holds resolution once answered", async () => {
    const h = harness([{ status: 201, body: "v=0 answer" }]);
    const sender = createWhipSender(track, stream, URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    const set = h.peers[0]?.transceiver.set as unknown as { encodings: Array<{ maxBitrate: number }>; degradationPreference: string };
    expect(set.encodings).toEqual([{ maxBitrate: WHIP_MAX_BITRATE }]);
    expect(set.degradationPreference).toBe("maintain-resolution");
    sender.close();
  });

  it("sends what it has when gathering does not finish in time", async () => {
    const h = harness([{ status: 201, body: "a" }]);
    const sender = createWhipSender(track, stream, URL_, h.env);
    await settle();
    h.fire(GATHER_TIMEOUT_MS);
    await settle();
    expect(h.sent.map((request) => request.method)).toEqual(["POST"]);
    sender.close();
  });

  it("DELETEs the session at its Location when closed", async () => {
    const h = harness([{ status: 201, location: "/whip/abc", body: "a" }]);
    const sender = createWhipSender(track, stream, URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    sender.close();
    expect(h.peers[0]?.closed).toBe(true);
    expect(h.sent.at(-1)).toMatchObject({ url: "http://127.0.0.1:8766/whip/abc", method: "DELETE" });
  });

  it("retries a refusing endpoint, says why, and stops retrying once closed", async () => {
    const h = harness([{ status: 409 }, { status: 201, body: "a" }]);
    const sender = createWhipSender(track, stream, URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    expect(sender.state()).toBe("failed");
    expect(sender.reason()).toBe("the server answered 409");

    h.fire(WHIP_RETRY_MS);
    await settle();
    h.peers[1]?.gather();
    await settle();
    expect(h.peers[1]?.remote).toBe("a");
    h.peers[1]?.become("failed");
    expect(sender.reason()).toBe("the connection failed");
    sender.close();
    h.fire(WHIP_RETRY_MS);
    await settle();
    expect(h.peers).toHaveLength(2);
  });
});
