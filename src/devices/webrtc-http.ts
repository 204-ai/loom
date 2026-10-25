/**
 * T955 — THE HTTP HALF OF WHIP AND WHEP (RFC 9725 and its receive-side twin): one `POST` of a
 * complete SDP offer as `application/sdp`, a `201 Created` carrying the answer as its body and
 * the session as its `Location`, and a `DELETE` of that Location to end it. Non-trickle: the
 * offer waits for ICE gathering, so no PATCH ever follows — on a LAN the host candidates in
 * the one offer are the whole story, and the servers this talks to (sd-webrtc, mediamtx)
 * answer a full offer without one.
 *
 * Shared by the WHEP camera (`whep-camera.ts`, receive) and the WHIP sender
 * (`whip-sender.ts`, send); each keeps its own peer connection.
 */

/** What a WHIP/WHEP server's reply is read for. A subset of `Response`, so a test can fake it. */
export interface SdpExchangeResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface SdpExchangeRequest {
  readonly method: "POST" | "DELETE";
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly keepalive?: boolean;
}

/** `fetch`, narrowed to what is used here. */
export type SdpFetch = (url: string, init: SdpExchangeRequest) => Promise<SdpExchangeResponse>;

/** Calls `run` after `ms`; returns a cancel. Injectable, so a test owns the clock. */
export type Later = (run: () => void, ms: number) => () => void;

/** The two members of `RTCPeerConnection` gathering is read through. */
export interface GatheringPeer {
  readonly iceGatheringState: string;
  onicegatheringstatechange: (() => void) | null;
}

/** How long to wait for ICE gathering before sending what there is. */
export const GATHER_TIMEOUT_MS = 2000;

export const browserLater: Later = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/** Gathering done, or the timeout passed: a full offer, or the best one there is. */
export function gathered(peer: GatheringPeer, later: Later, timeoutMs = GATHER_TIMEOUT_MS): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      cancel();
      peer.onicegatheringstatechange = null;
      resolve();
    };
    const cancel = later(finish, timeoutMs);
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
  });
}

/**
 * POSTs the offer. Resolves to the answer and the session's URL — null when the server
 * named none, or named it in a header CORS does not expose (then closing the connection is
 * what ends the session). Throws, with a sentence, on anything but 201 or 200.
 */
export async function exchangeSdp(
  fetchSdp: SdpFetch,
  url: string,
  offer: string,
): Promise<{ readonly answer: string; readonly resource: string | null }> {
  const response = await fetchSdp(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer });
  if (response.status !== 201 && response.status !== 200) throw new Error(`the server answered ${String(response.status)}`);
  const location = response.headers.get("Location");
  return { answer: await response.text(), resource: location === null ? null : new URL(location, url).href };
}

/** DELETEs a session. `keepalive`, so one sent while the tab closes still goes out. */
export function endSession(fetchSdp: SdpFetch, resource: string | null): void {
  if (resource === null) return;
  void fetchSdp(resource, { method: "DELETE", keepalive: true }).catch(() => undefined);
}
