// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage, installDomStubs } from "@ui/testing/install-dom-stubs.ts";
import { installFlowStubs } from "@editor/graph-canvas/testing.tsx";
import { starterPreferenceStore } from "@editor/inspect/index.ts";
import { projectLinkUrl } from "@editor/library/index.ts";
import { serializeProjectDocument } from "@domain/project/index.ts";
import type { SnapshotMeta, SnapshotRecord, SnapshotStore } from "@domain/project/index.ts";
import type { ProjectDocument } from "@domain/types/graph.ts";
import { App } from "./app.tsx";
import type { AppRuntime } from "./app-runtime.ts";
import { newProjectDocument, PROJECT_STORAGE_KEY } from "./app-runtime.ts";
import type { AddressBar } from "./example-link-boot.ts";
import { consumeProjectLink, currentProjectLink, loadProjectLink, startProjectLink } from "./project-link-boot.ts";
import type { GpuStatus } from "./gpu-status.ts";

/**
 * A LINK THAT OPENS A REPO PROJECT (T1720b) — the example link's guarantees, for a file the
 * server serves (`example-link-boot.test.tsx` is the model). What can go wrong, one test
 * each: a plausible-but-wrong document (the starter) on a bad or unserved link; the starter
 * landing FIRST because the file is fetched; work lost under an autosave or unsaved edits;
 * and the link sticking in the address bar.
 */

beforeAll(() => {
  installDomStubs();
  installFlowStubs();
});

const NO_GPU: GpuStatus = { kind: "unavailable", reason: "No WebGPU in this environment." };
const PROJECT_ID = "project-project-link-test";
const LINKED_PATH = "projects/demo/linked.loom.json";
const LINKED_FILE = "linked.loom.json";
/** Not the starter (E6), so "the link worked" cannot be confused with "it fell through". */
const LINKED_NODE_TYPES = ["lookup", "ramp"];
const LINKED_PROJECT_ID = "linked-project-fixture";

function linkedDocument(): ProjectDocument {
  const node = (id: string, type: string, x: number) => ({ id, type, definitionVersion: 1, position: { x, y: 0 }, parameters: {} });
  return {
    ...newProjectDocument(LINKED_PROJECT_ID),
    name: "a repo project",
    graph: { revision: 1, nodes: { a: node("a", "ramp", 0), b: node("b", "lookup", 200) }, edges: {}, groups: {} },
  };
}

type Answer = { ok: boolean; status: number; text: () => Promise<string> };
const served = (): Answer => ({ ok: true, status: 200, text: async () => serializeProjectDocument(linkedDocument()) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PROJECT_STORAGE_KEY, PROJECT_ID);
  starterPreferenceStore().set(true);
  history.replaceState(null, "", "/");
  fetchMock = vi.fn(async () => served());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

/** The link, written by the producer, so this file cannot test a shape nobody writes. */
function arriveByLink(path: string): void {
  const url = new URL(projectLinkUrl(path, location.origin, "/"));
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function memorySnapshotStore(seedRecords: SnapshotRecord[] = []) {
  const records = new Map<string, SnapshotRecord>(seedRecords.map((record) => [`${record.projectId}/${record.key}`, record]));
  const puts: SnapshotRecord[] = [];
  const store: SnapshotStore = {
    async list(projectId: string): Promise<SnapshotMeta[]> {
      return [...records.values()]
        .filter((record) => record.projectId === projectId)
        .map(({ key, revision, savedAt, pinned }) => ({ key, revision, savedAt, pinned }));
    },
    async get(projectId: string, key: string) {
      return records.get(`${projectId}/${key}`);
    },
    async put(record: SnapshotRecord) {
      puts.push(record);
      records.set(`${record.projectId}/${record.key}`, record);
    },
    async delete(projectId: string, key: string) {
      records.delete(`${projectId}/${key}`);
    },
  };
  return { store, puts, records };
}

function snapshotOf(document: ProjectDocument): SnapshotRecord {
  return {
    key: `1-r${document.graph.revision}`,
    projectId: document.projectId,
    revision: document.graph.revision,
    savedAt: 1,
    pinned: false,
    body: serializeProjectDocument(document),
  };
}

function autosavedWork(projectId: string): ProjectDocument {
  return {
    ...newProjectDocument(projectId),
    name: "an evening of real work",
    graph: {
      revision: 12,
      nodes: { theirNode: { id: "theirNode", type: "solid", definitionVersion: 1, position: { x: 10, y: 20 }, parameters: {} } },
      edges: {},
      groups: {},
    },
  };
}

const nodeTypesOf = (runtime: AppRuntime | null): string[] =>
  runtime === null ? [] : Object.values(runtime.bus.store.getGraph().nodes).map((node) => node.type).sort();

async function mountApp(store: SnapshotStore | undefined) {
  let live: AppRuntime | null = null;
  const swaps: AppRuntime[] = [];
  await act(async () => {
    render(
      <App
        storage={createMemoryStorage()}
        gpuProbe={() => Promise.resolve(NO_GPU)}
        createSnapshotStore={() => store}
        onRuntimeChange={(next) => {
          live = next;
          swaps.push(next);
        }}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { runtime: () => live as AppRuntime | null, swaps };
}

describe("a project link opens the repo file it names, as a picked file opens", () => {
  it("fetches it from this server and opens it rather than the starter", async () => {
    arriveByLink(LINKED_PATH);
    const app = await mountApp(memorySnapshotStore().store);

    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(nodeTypesOf(app.runtime())).toEqual(LINKED_NODE_TYPES);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${location.origin}/${LINKED_PATH}`);
  });

  it("keeps the file's own project id, as opening it by hand does", async () => {
    arriveByLink(LINKED_PATH);
    const { store, puts } = memorySnapshotStore();
    const app = await mountApp(store);

    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(app.runtime()?.invocation.projectId).toBe(LINKED_PROJECT_ID);
    // Following a link commits nothing until somebody edits the document.
    expect(puts).toEqual([]);
  });

  it("waits for the file: the starter never lands first", async () => {
    let answer: (value: Answer) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Answer>((resolve) => { answer = resolve; }));
    arriveByLink(LINKED_PATH);
    const app = await mountApp(memorySnapshotStore().store);

    // The launch lookup has answered; the boot still has not decided.
    expect(app.runtime()).toBeNull();
    await act(async () => {
      answer(served());
    });
    await waitFor(() => expect(app.runtime()).not.toBeNull());
    // One document swap, and it is the linked project: nothing opened before it.
    expect(app.swaps).toHaveLength(1);
    expect(nodeTypesOf(app.runtime())).toEqual(LINKED_NODE_TYPES);
  });
});

describe("a link outranks an autosave — and costs it nothing", () => {
  it("opens the linked project over a boot that had a snapshot waiting, which stays where it was", async () => {
    const { store, puts, records } = memorySnapshotStore([snapshotOf(autosavedWork(PROJECT_ID))]);
    const before = records.size;
    arriveByLink(LINKED_PATH);
    const app = await mountApp(store);

    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(nodeTypesOf(app.runtime())).toEqual(LINKED_NODE_TYPES);
    expect(puts).toEqual([]);
    expect(records.size).toBe(before);
  });

  it("offers an autosave of THAT project back over it", async () => {
    // Edits made to the repo project in this browser before: newer than the file.
    const edited = { ...linkedDocument(), graph: { ...autosavedWork(LINKED_PROJECT_ID).graph } };
    const { store } = memorySnapshotStore([snapshotOf(edited)]);
    arriveByLink(LINKED_PATH);
    const app = await mountApp(store);

    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(await screen.findByText(/is newer than what is open/i)).toBeDefined();
  });

  it("over unsaved work, asks first and opens on the answer", async () => {
    let releaseLookup = (): void => {};
    const gate = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const store: SnapshotStore = {
      async list(): Promise<SnapshotMeta[]> {
        await gate;
        return [];
      },
      async get() { return undefined; },
      async put() {},
      async delete() {},
    };
    arriveByLink(LINKED_PATH);
    let live: AppRuntime | null = null;
    await act(async () => {
      render(
        <App storage={createMemoryStorage()} gpuProbe={() => Promise.resolve(NO_GPU)} createSnapshotStore={() => store}
          onRuntimeChange={(next) => { live = next; }} />,
      );
    });
    const library = screen.getByRole("region", { name: "generator" });
    await act(async () => {
      fireEvent.click(within(library).getByText("Noise"), { detail: 1 });
    });
    await act(async () => {
      releaseLookup();
      await gate;
      await Promise.resolve();
      await Promise.resolve();
    });

    const notice = await screen.findByText(/wants to open the project/i);
    expect(notice.textContent).toContain(LINKED_FILE);
    expect(live).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open project" }));
    });
    await waitFor(() => expect(nodeTypesOf(live)).toEqual(LINKED_NODE_TYPES));
  });
});

describe("a link that cannot be opened fails LOUDLY, and opens nothing", () => {
  it("refuses a path outside projects/ without fetching anything", async () => {
    history.replaceState(null, "", "/?project=../secrets.loom.json");
    const app = await mountApp(memorySnapshotStore().store);

    const notice = await screen.findByText(/will not open/i);
    expect(notice.textContent).toContain("../secrets.loom.json");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(app.runtime()).toBeNull();
  });

  it("says when this server does not serve the file (the hosted build's case)", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404, text: async () => "" }));
    arriveByLink(LINKED_PATH);
    const app = await mountApp(memorySnapshotStore().store);

    const notice = await screen.findByText(/could not be loaded/i);
    expect(notice.textContent).toContain(LINKED_PATH);
    expect(notice.textContent).toContain("404");
    expect(app.runtime()).toBeNull();
  });

  it("boots normally when the link names nothing at all", async () => {
    history.replaceState(null, "", "/?project=");
    const app = await mountApp(memorySnapshotStore().store);

    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(nodeTypesOf(app.runtime())).toContain("checker");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the link does not outlive the visit it arrived on", () => {
  it("is gone from the address bar once the boot has answered it", async () => {
    arriveByLink(LINKED_PATH);
    const app = await mountApp(memorySnapshotStore().store);
    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(location.search).toBe("");
    expect(currentProjectLink()).toBeNull();
  });

  it("answers the project link when an example link rides along, and strips both", async () => {
    history.replaceState(null, "", `/?example=E11&project=${encodeURIComponent(LINKED_PATH)}`);
    const app = await mountApp(memorySnapshotStore().store);
    await waitFor(() => expect(app.runtime()).not.toBeNull());
    expect(nodeTypesOf(app.runtime())).toEqual(LINKED_NODE_TYPES);
    expect(location.search).toBe("");
  });
});

/** A stand-in address bar, so the strip needs no navigation. */
function fakeAddress(initial: string): AddressBar {
  let href = initial;
  return {
    get href() { return href; },
    get search() { return new URL(href).search; },
    replace(next: string) { href = next; },
  };
}

describe("the one-time isolation reload does not eat the link (T1048)", () => {
  it("leaves the link in place while the reload is still coming, and strips it after", () => {
    const address = fakeAddress(`https://host.example/loom/?project=${encodeURIComponent(LINKED_PATH)}`);
    expect(consumeProjectLink(address, () => true)).toBe(false);
    expect(currentProjectLink(address)).toBe(LINKED_PATH);
    expect(consumeProjectLink(address, () => false)).toBe(true);
    expect(address.href).toBe("https://host.example/loom/");
  });
});

describe("the fetch", () => {
  it("names the dev server's page-for-a-missing-file as a missing file, not a parse error", async () => {
    // `pnpm dev` answers a path it has no file for with the app's own page and a 200.
    const start = startProjectLink(LINKED_PATH);
    if (start.kind !== "loading") throw new Error("expected a loading link");
    const settled = await loadProjectLink(start, "http://localhost:5173", "/", async () => ({ ok: true, status: 200, text: async () => "<!doctype html><html></html>" }));
    expect(settled).toEqual({ kind: "failed", path: LINKED_PATH, reason: "this server has no such file (it answered with a web page)" });
  });

  it("refuses an answer that is not JSON", async () => {
    const start = startProjectLink(LINKED_PATH);
    if (start.kind !== "loading") throw new Error("expected a loading link");
    const settled = await loadProjectLink(start, "http://localhost:5173", "/", async () => ({ ok: true, status: 200, text: async () => "not json" }));
    expect(settled).toEqual({ kind: "failed", path: LINKED_PATH, reason: "the server's answer is not JSON" });
  });

  it("reports a network failure as a reason, not a throw", async () => {
    const start = startProjectLink(LINKED_PATH);
    if (start.kind !== "loading") throw new Error("expected a loading link");
    const settled = await loadProjectLink(start, "http://localhost:5173", "/", async () => {
      throw new Error("Failed to fetch");
    });
    expect(settled).toEqual({ kind: "failed", path: LINKED_PATH, reason: "Failed to fetch" });
  });
});
