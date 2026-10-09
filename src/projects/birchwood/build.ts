import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serializeCheckedProject } from "../../examples/checked-project.ts";
import { birchwoodDocument } from "./document.ts";

/**
 * Build the birchwood project through the real save path.
 *
 *   node --import ./src/tooling/alias-hooks.ts src/projects/birchwood/build.ts
 *
 * Writes projects/birchwood/birchwood.loom.json. Open that file in the app.
 */
const out = "projects/birchwood/birchwood.loom.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeCheckedProject(birchwoodDocument()), "utf8");
console.log(`wrote ${out}`);
