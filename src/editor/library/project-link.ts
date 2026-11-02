/**
 * A LINK THAT OPENS A REPO PROJECT FILE (T1720b), modelled on the example link (T1278,
 * `example-link.ts`): `?project=projects/ciurlionis-mirror/mirror-whip.loom.json`.
 *
 * The owner's ask: a show that starts with no human load step — a kiosk browser pointed at
 * `http://localhost:5173/?project=…` lands on that project, the same document a person
 * would get by opening the file by hand. So this names a FILE THE SERVER SERVES, not a
 * shipped example: `pnpm dev` serves the repository root, which is also why the project's
 * own media (`projects/<name>/media/*.mp4`, repo-root relative) then load exactly as they do
 * after a manual open.
 *
 * This module is the CONTRACT, as `example-link.ts` is for examples: what a link may name,
 * how it is written, and the URL it is fetched from. No browser globals, no boot decision —
 * `src/app/project-link-boot.ts` owns the address bar and the fetch, and
 * `use-starter-project.ts` decides what the boot does with the answer.
 *
 * ## A QUERY, not a path — for the example link's reason
 *
 * A query survives the one-time cross-origin-isolation reload (T1048), which preserves
 * search and hash; a path route would need a server rule.
 *
 * ## WHAT A LINK MAY NAME, and why so little
 *
 * A repo-relative `projects/**\/*.loom.json` path on THIS server, and nothing else:
 *
 *   - no scheme, no `//host`, no leading `/` — a link is resolved against this app's own
 *     origin and base, so it can never fetch from somewhere else;
 *   - no `.` or `..` segment and no empty one — it may not climb out of `projects/`;
 *   - no `\`, `%`, `?`, `#` or control character — none occurs in a project path, and each
 *     is a way to make the string mean something other than what it shows;
 *   - and it must end in `.loom.json`.
 *
 * Anything else is REFUSED, with the reason, and the caller says so out loud: a link that
 * quietly fell through to the starter would hand somebody a plausible document and no sign
 * that the one they were sent never opened (the example link's whole argument).
 */

/** The query key. One spelling, shared by the producer, the reader and the strip. */
export const PROJECT_LINK_PARAM = "project";

const PROJECT_DIRECTORY = "projects";
const PROJECT_SUFFIX = ".loom.json";
/** A scheme (`http:`, `file:`, `javascript:`) — a link names a path, never a URL. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Characters no project path carries, each a way to make it mean something else. */
const FORBIDDEN = /[\\%?#]/;
/** A control character (C0 or DEL), which no path a person writes contains. */
const hasControl = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/** The URL that opens `path` on this app: `origin` and `base` passed in, as for examples. */
export function projectLinkUrl(path: string, origin: string, base: string): string {
  const params = new URLSearchParams([[PROJECT_LINK_PARAM, path]]);
  return `${origin}${base}?${params.toString()}`;
}

/**
 * The path a URL's query asks for, or null when it asks for none. A blank value
 * (`?project=`) is absent, not wrong — there is nothing to report back.
 */
export function readProjectLink(search: string): string | null {
  const requested = new URLSearchParams(search).get(PROJECT_LINK_PARAM);
  if (requested === null) return null;
  const trimmed = requested.trim();
  return trimmed === "" ? null : trimmed;
}

export type ProjectLinkResolution =
  /** `fileName` is the basename: what the top bar shows and a later save offers. */
  | { readonly kind: "path"; readonly path: string; readonly fileName: string }
  /** Carries the caller's OWN string back, and why it was refused. */
  | { readonly kind: "refused"; readonly requested: string; readonly reason: string };

/** The rules above. Never a partial acceptance: a path is opened as written or not at all. */
export function resolveProjectLink(requested: string): ProjectLinkResolution {
  const path = requested.trim();
  const refuse = (reason: string): ProjectLinkResolution => ({ kind: "refused", requested, reason });
  if (SCHEME.test(path) || path.startsWith("/")) {
    return refuse("it names another host or an absolute path, and a link opens only this server's projects/ files");
  }
  if (FORBIDDEN.test(path) || hasControl(path)) {
    return refuse("it carries characters no project path does (\\, %, ?, # or a control character)");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return refuse("it has an empty, . or .. segment, and a link may not leave projects/");
  }
  if (segments[0] !== PROJECT_DIRECTORY || segments.length < 2) return refuse("it is not a path under projects/");
  const fileName = segments[segments.length - 1] ?? "";
  if (!fileName.endsWith(PROJECT_SUFFIX) || fileName === PROJECT_SUFFIX) return refuse("it is not a .loom.json file");
  return { kind: "path", path, fileName };
}

/**
 * Where to fetch an accepted `path`: against this app's own origin and base, which is the
 * repository root under `pnpm dev` (`base` is `/`). Null if the result left `origin` —
 * impossible for a path `resolveProjectLink` accepted, and checked anyway, because this is
 * the one line that turns a string from a URL into a request.
 */
export function projectLinkFetchUrl(path: string, origin: string, base: string): string | null {
  const home = new URL(base, origin);
  const url = new URL(path, home);
  return url.origin === home.origin ? url.href : null;
}

/** `href` with the link removed, or null when there was none — as `withoutExampleLink`. */
export function withoutProjectLink(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(PROJECT_LINK_PARAM)) return null;
  url.searchParams.delete(PROJECT_LINK_PARAM);
  url.search = url.searchParams.toString();
  return url.toString();
}
