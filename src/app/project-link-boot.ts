import {
  projectLinkFetchUrl,
  readProjectLink,
  resolveProjectLink,
  withoutProjectLink,
} from "@editor/library/project-link.ts";
import { isolationReloadPending } from "./cross-origin-isolation.ts";
import { browserAddress, type AddressBar } from "./example-link-boot.ts";

/**
 * THE ADDRESS BAR AND THE FETCH, for the repo-project link (T1720b).
 *
 * `@editor/library/project-link.ts` is the contract — which paths a link may name and the
 * URL they are fetched from. This is the half that touches the browser, built exactly as
 * `example-link-boot.ts` is: the link is read ONCE at mount, and stripped once the boot has
 * taken responsibility for it — never before the hosted build's one-time isolation reload,
 * which preserves the query and would otherwise eat it.
 *
 * Unlike an example, the document is not in the app chunk: it is FETCHED from the server
 * the app came from. So the link has a state between "asked" and "answered", and the boot
 * decision (`use-starter-project.ts`, rule zero) waits for it to settle rather than letting
 * the starter land first and the linked project land on top of it.
 */

/** The project path this load was linked to, or null. Frozen at mount by the caller. */
export function currentProjectLink(address: AddressBar = browserAddress()): string | null {
  return readProjectLink(address.search);
}

/** Takes the link back out of the address bar, as `consumeExampleLink` does, with its rule. */
export function consumeProjectLink(
  address: AddressBar = browserAddress(),
  reloadPending: () => boolean = isolationReloadPending,
): boolean {
  if (reloadPending()) return false;
  const stripped = withoutProjectLink(address.href);
  if (stripped === null) return false;
  address.replace(stripped);
  return true;
}

/** Where a project link stands. `loading` is the only unsettled state. */
export type ProjectLinkLoad =
  | { readonly kind: "loading"; readonly path: string; readonly fileName: string }
  | { readonly kind: "loaded"; readonly path: string; readonly fileName: string; readonly text: string }
  /** Not a path a link may name. Nothing was fetched. */
  | { readonly kind: "refused"; readonly requested: string; readonly reason: string }
  /** An accepted path the server did not give us as JSON. */
  | { readonly kind: "failed"; readonly path: string; readonly reason: string };

/** The link's first state: refused on its face, or ready to fetch. */
export function startProjectLink(requested: string): ProjectLinkLoad {
  const resolution = resolveProjectLink(requested);
  return resolution.kind === "refused"
    ? resolution
    : { kind: "loading", path: resolution.path, fileName: resolution.fileName };
}

/** What `loadProjectLink` needs of `fetch`. Injectable, so a test needs no server. */
export type ProjectLinkFetch = (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

const browserFetch: ProjectLinkFetch = (url) => fetch(url, { cache: "no-store" });

/**
 * Fetches a `loading` link from this app's own server. The bytes are only checked to be
 * JSON here; whether they are a project is `project.open`'s question, asked when it opens.
 *
 * `base` is `import.meta.env.BASE_URL`: `/` under `pnpm dev`, which serves the repository
 * root. The hosted build (`/loom/` on Pages) ships no `projects/`, so there the server
 * answers 404 and the link reports exactly that.
 */
export async function loadProjectLink(
  load: Extract<ProjectLinkLoad, { kind: "loading" }>,
  origin: string = globalThis.location.origin,
  base: string = import.meta.env.BASE_URL,
  fetchText: ProjectLinkFetch = browserFetch,
): Promise<ProjectLinkLoad> {
  const url = projectLinkFetchUrl(load.path, origin, base);
  if (url === null) return { kind: "failed", path: load.path, reason: "it resolved to another origin" };
  try {
    const response = await fetchText(url);
    if (!response.ok) return { kind: "failed", path: load.path, reason: `the server answered ${String(response.status)}` };
    const text = await response.text();
    // `pnpm dev` answers a path it has no file for with the APP's page and a 200 (the SPA
    // fallback), so a missing project arrives as HTML rather than as a 404.
    if (text.trimStart().startsWith("<")) {
      return { kind: "failed", path: load.path, reason: "this server has no such file (it answered with a web page)" };
    }
    try {
      JSON.parse(text);
    } catch {
      return { kind: "failed", path: load.path, reason: "the server's answer is not JSON" };
    }
    return { kind: "loaded", path: load.path, fileName: load.fileName, text };
  } catch (error) {
    return { kind: "failed", path: load.path, reason: error instanceof Error ? error.message : String(error) };
  }
}
