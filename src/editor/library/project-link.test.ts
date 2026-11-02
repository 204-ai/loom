import { describe, expect, it } from "vitest";
import {
  PROJECT_LINK_PARAM,
  projectLinkFetchUrl,
  projectLinkUrl,
  readProjectLink,
  resolveProjectLink,
  withoutProjectLink,
} from "./project-link.ts";

/**
 * T1720b — the repo-project link's contract: which paths a link may name, the URL they are
 * fetched from, and the strip. The boot half is `src/app/project-link-boot.test.tsx`.
 */

const MIRROR = "projects/ciurlionis-mirror/mirror-whip.loom.json";

describe("a project link names a projects/**/*.loom.json path on this server", () => {
  it("round-trips the producer through the reader and the resolver", () => {
    const url = projectLinkUrl(MIRROR, "http://localhost:5173", "/");
    expect(url).toBe("http://localhost:5173/?project=projects%2Fciurlionis-mirror%2Fmirror-whip.loom.json");
    const requested = readProjectLink(new URL(url).search);
    expect(requested).toBe(MIRROR);
    expect(resolveProjectLink(requested ?? "")).toEqual({ kind: "path", path: MIRROR, fileName: "mirror-whip.loom.json" });
  });

  it("also reads the path written unencoded, as a person types it", () => {
    expect(readProjectLink(`?${PROJECT_LINK_PARAM}=${MIRROR}`)).toBe(MIRROR);
  });

  it("reads a blank value as no link at all, not a wrong one", () => {
    expect(readProjectLink("?project=")).toBeNull();
    expect(readProjectLink("?project=%20")).toBeNull();
    expect(readProjectLink("?example=E11")).toBeNull();
  });

  it("takes a project at any depth under projects/", () => {
    expect(resolveProjectLink("projects/a.loom.json")).toMatchObject({ kind: "path", fileName: "a.loom.json" });
    expect(resolveProjectLink(" projects/a/b/c.loom.json ")).toMatchObject({ kind: "path", path: "projects/a/b/c.loom.json" });
  });
});

describe("anything else is refused, with the reason", () => {
  it.each([
    ["../secrets.loom.json", "empty, . or .."],
    ["projects/../examples/E11.loom.json", "empty, . or .."],
    ["projects/./a.loom.json", "empty, . or .."],
    ["projects//a.loom.json", "empty, . or .."],
    ["/projects/a.loom.json", "absolute path"],
    ["//evil.example/projects/a.loom.json", "absolute path"],
    ["https://evil.example/projects/a.loom.json", "another host"],
    ["javascript:alert(1)", "another host"],
    ["projects\\a.loom.json", "characters"],
    ["projects/%2e%2e/a.loom.json", "characters"],
    ["projects/a.loom.json?x=1", "characters"],
    ["projects/a.loom.json#top", "characters"],
    ["projects/a\u0000.loom.json", "characters"],
    ["examples/E11-Gradient-Remap.loom.json", "not a path under projects/"],
    ["projects", "not a path under projects/"],
    ["projects/a.json", "not a .loom.json file"],
    ["projects/a.loom.json.txt", "not a .loom.json file"],
    ["projects/.loom.json", "not a .loom.json file"],
  ])("%s", (requested, why) => {
    const resolution = resolveProjectLink(requested);
    expect(resolution.kind).toBe("refused");
    if (resolution.kind !== "refused") return;
    expect(resolution.requested).toBe(requested);
    expect(resolution.reason).toContain(why);
  });
});

describe("the fetch URL stays on this origin, under this base", () => {
  it("resolves against the dev server's root", () => {
    expect(projectLinkFetchUrl(MIRROR, "http://localhost:5173", "/")).toBe(`http://localhost:5173/${MIRROR}`);
  });

  it("resolves under a hosted base, where the server answers for itself", () => {
    expect(projectLinkFetchUrl(MIRROR, "https://host.example", "/loom/")).toBe(`https://host.example/loom/${MIRROR}`);
  });

  it("refuses a result that left the origin, should one ever get this far", () => {
    expect(projectLinkFetchUrl("//evil.example/x.loom.json", "http://localhost:5173", "/")).toBeNull();
  });
});

describe("the strip", () => {
  it("takes the link out and leaves the rest of the address alone", () => {
    expect(withoutProjectLink(`http://localhost:5173/?project=${encodeURIComponent(MIRROR)}`)).toBe("http://localhost:5173/");
    expect(withoutProjectLink(`http://localhost:5173/?project=${encodeURIComponent(MIRROR)}&debug=1#x`)).toBe("http://localhost:5173/?debug=1#x");
  });

  it("reports when there was nothing to strip", () => {
    expect(withoutProjectLink("http://localhost:5173/?example=E11")).toBeNull();
  });
});
