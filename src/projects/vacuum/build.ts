import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serializeCheckedProject } from "../../examples/checked-project.ts";
import { vacuumDocument } from "./document.ts";

/**
 * Build the vacuum project through the real save path.
 *
 *   node --import ./src/tooling/alias-hooks.ts src/projects/vacuum/build.ts
 *
 * Writes projects/vacuum/vacuum.loom.json. Open that file in the app.
 */
const out = "projects/vacuum/vacuum.loom.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeCheckedProject(vacuumDocument()), "utf8");
console.log(`wrote ${out}`);
