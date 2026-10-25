import { describe, expect, it } from "vitest";
import { whepCameraUrl } from "@nodes/definitions/index.ts";
import type { MediaElement } from "./media-sources.ts";
import {
  openWhepCamera,
  WHEP_GATHER_TIMEOUT_MS,
  WHEP_RETRY_MS,
  type WhepCameraEnvironment,
  type WhepPeerConnection,
  type WhepResponse,
} from "./whep-camera.ts";

class FakePeer implements WhepPeerConnection {
  connectionState = "new";
  iceGatheringState = "new";
  localDescription: { sdp: string } | null = null;
  ontrack: WhepPeerConnection["ontrack"] = null;
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  readonly transceivers: Array<{ kind: string; direction: string }> = [];
  remote: string | null = null;
  closed = false;
  addTransceiver(kind: "video", init: { direction: "recvonly" }): unknown {
    this.transceivers.push({ kind, direction: init.direction });
    return {};
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
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

interface Sent {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function harness(answers: Array<Partial<WhepResponse> & { status: number; location?: string; body?: string }>) {
  const peers: FakePeer[] = [];
  const sent: Sent[] = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const shown: Array<MediaStream | null> = [];
  let stopped = 0;
  const element = { videoWidth: 0, videoHeight: 0, addEventListener() {}, removeEventListener() {} } as MediaElement;
  const env: WhepCameraEnvironment = {
    createPeer() {
      const peer = new FakePeer();
      peers.push(peer);
      return peer;
    },
    createVideo: () => ({
      element,
      show: (stream) => shown.push(stream),
      stop: () => {
        stopped += 1;
      },
    }),
    async fetch(url, init) {
      sent.push({ url, method: init.method, ...(init.headers ? { headers: init.headers } : {}), ...(init.body !== undefined ? { body: init.body } : {}) });
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
  };
  /** Run the timers that are due now (the gather timeout or a retry), once each. */
  const fire = (ms: number): void => {
    for (const timer of timers.splice(0)) if (!timer.cancelled && timer.ms === ms) timer.run();
  };
  return { env, peers, sent, timers, shown, element, fire, stopped: () => stopped };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const URL_ = "http://127.0.0.1:8766/whep";

describe("a whep: device", () => {
  it("names its URL, and only with the prefix and a URL", () => {
    expect(whepCameraUrl("whep:http://box:8889/cam/whep")).toBe("http://box:8889/cam/whep");
    expect(whepCameraUrl("whep:  http://box/whep  ")).toBe("http://box/whep");
    expect(whepCameraUrl("whep:")).toBeNull();
    expect(whepCameraUrl("phone:desk")).toBeNull();
    expect(whepCameraUrl("4f2a…")).toBeNull();
    expect(whepCameraUrl(undefined)).toBeNull();
  });
});

describe("openWhepCamera", () => {
  it("offers receive-only, waits for ICE gathering, then POSTs the full offer as application/sdp", async () => {
    const h = harness([{ status: 201, location: "/whep/abc", body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    expect(h.peers[0]?.transceivers).toEqual([{ kind: "video", direction: "recvonly" }]);
    expect(h.sent).toEqual([]); // still gathering: nothing sent yet

    h.peers[0]?.gather();
    await settle();
    expect(h.sent).toEqual([
      { url: URL_, method: "POST", headers: { "Content-Type": "application/sdp" }, body: "v=0 offer +candidates" },
    ]);
    expect(h.peers[0]?.remote).toBe("v=0 answer");
    expect(camera.waiting?.()).toBe(`The WHEP stream at ${URL_} is connecting.`);

    h.peers[0]?.become("connected");
    expect(camera.waiting?.()).toBeNull();
    camera.stop();
  });

  it("sends what it has when gathering does not finish in time", async () => {
    const h = harness([{ status: 201, body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.fire(WHEP_GATHER_TIMEOUT_MS);
    await settle();
    expect(h.sent.map((request) => request.method)).toEqual(["POST"]);
    camera.stop();
  });

  it("shows the arriving stream on its element", async () => {
    const h = harness([{ status: 201, body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    expect(camera.element).toBe(h.element);
    const stream = { id: "remote" } as unknown as MediaStream;
    h.peers[0]?.ontrack?.({ streams: [stream] });
    expect(h.shown).toEqual([stream]);
    camera.stop();
  });

  it("DELETEs the session at its Location, resolved against the URL, when stopped", async () => {
    const h = harness([{ status: 201, location: "/whep/abc", body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    camera.stop();
    expect(h.peers[0]?.closed).toBe(true);
    expect(h.stopped()).toBe(1);
    expect(h.sent.at(-1)).toEqual({ url: "http://127.0.0.1:8766/whep/abc", method: "DELETE" });
  });

  it("without a readable Location it closes the connection and sends no DELETE", async () => {
    const h = harness([{ status: 201, body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    camera.stop();
    expect(h.peers[0]?.closed).toBe(true);
    expect(h.sent.map((request) => request.method)).toEqual(["POST"]);
  });

  it("retries a server that is not answering, and says so meanwhile", async () => {
    const h = harness([{ status: 503 }, { status: 201, body: "v=0 answer" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    expect(camera.waiting?.()).toBe(`The WHEP stream at ${URL_} is not playing (the server answered 503); retrying.`);
    expect(h.peers[0]?.closed).toBe(true);

    h.fire(WHEP_RETRY_MS);
    await settle();
    h.peers[1]?.gather();
    await settle();
    expect(h.sent.filter((request) => request.method === "POST")).toHaveLength(2);
    expect(h.peers[1]?.remote).toBe("v=0 answer");
    h.peers[1]?.become("connected");
    expect(camera.waiting?.()).toBeNull();
    camera.stop();
  });

  it("reconnects when an established connection fails", async () => {
    const h = harness([{ status: 201, location: "/whep/1", body: "a1" }, { status: 201, location: "/whep/2", body: "a2" }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    h.peers[0]?.become("connected");
    h.peers[0]?.become("failed");
    expect(camera.waiting?.()).toContain("the connection failed");
    // The dead session is released at once.
    expect(h.sent.at(-1)).toEqual({ url: "http://127.0.0.1:8766/whep/1", method: "DELETE" });

    h.fire(WHEP_RETRY_MS);
    await settle();
    h.peers[1]?.gather();
    await settle();
    expect(h.peers[1]?.remote).toBe("a2");
    camera.stop();
  });

  it("does nothing more once stopped: a pending retry is cancelled", async () => {
    const h = harness([{ status: 500 }]);
    const camera = openWhepCamera(URL_, h.env);
    await settle();
    h.peers[0]?.gather();
    await settle();
    camera.stop();
    h.fire(WHEP_RETRY_MS);
    await settle();
    expect(h.peers).toHaveLength(1);
    expect(h.sent.filter((request) => request.method === "POST")).toHaveLength(1);
  });
});
