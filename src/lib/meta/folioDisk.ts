// Reads the built-in folios from /folios. Server and MCP only: the page bundles the same files with Vite.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sanitiseFolio, type Folio } from "./folio.js";

function folioDir(): string {
  const beside = fileURLToPath(new URL("../../../folios/", import.meta.url));
  try {
    readdirSync(beside);
    return beside;
  } catch {
    return join(process.cwd(), "folios");
  }
}

export function loadBuiltInFolios(): Folio[] {
  const dir = folioDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const folio = sanitiseFolio(JSON.parse(readFileSync(join(dir, f), "utf8")));
      return folio ? [folio] : [];
    });
}
