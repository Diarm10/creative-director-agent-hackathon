// Re-runs chosen catalogue products one at a time in quick mode, on the live models, in this process (the same
// handler the deployed site runs). Saves every round's image, the cut-out the run produced and a JSON summary.
//
//   npx tsx --env-file=.env.local scripts/catalogue-rerun.ts --out=tmp/after pot-pilea stool-wooden
//
// Uses the shop and fact columns of the sample CSV, as the Catalogue page does.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import runHandler from "../api/run.ts";
import { readCatalogue } from "../src/lib/catalogue/csv.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = arg("out") ?? "tmp/rerun";
const skus = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tag = arg("tag") ? `${arg("tag")}-` : "";
const styleFields: Record<string, unknown> = {};
if (arg("look")) styleFields.look = arg("look");
if (arg("theme")) styleFields.theme = arg("theme");
if (arg("offer")) styleFields.offer = arg("offer");
if (arg("effect")) styleFields.effect = arg("effect") === "none" ? "none" : { id: arg("effect"), intensity: Number(arg("intensity") ?? 70), stylise: false };
mkdirSync(out, { recursive: true });

const rows = readCatalogue(readFileSync("demo-assets/catalogue/catalogue.csv", "utf8")).rows;
const code = process.env.DEMO_CODE ?? "";

const prep = async (name: string) =>
  `data:image/jpeg;base64,${(await sharp(`demo-assets/catalogue/${name}`).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer()).toString("base64")}`;

function fakeRes() {
  const res: Record<string, unknown> & { chunks: string[]; statusCode: number; jsonBody: unknown } = {
    chunks: [], statusCode: 200, jsonBody: null,
    status(c: number) { res.statusCode = c; return res; },
    setHeader() {}, flushHeaders() {},
    write(c: string) { res.chunks.push(c); return true; },
    json(b: unknown) { res.jsonBody = b; return res; },
    end() { return res; },
  };
  return res;
}

let ip = 0;
for (const sku of skus) {
  const row = rows.find((r) => r.sku === sku);
  if (!row) { console.log(`unknown sku ${sku}`); continue; }
  const res = fakeRes();
  const t0 = Date.now();
  await (runHandler as (a: unknown, b: unknown) => Promise<void>)(
    {
      method: "POST", headers: { "x-demo-code": code, "x-forwarded-for": `10.88.0.${++ip}` }, socket: {},
      body: { ...styleFields, briefType: "product", catalogue: true, quick: true, clientName: row.shop || undefined, facts: row.fact || undefined, productNoun: row.product, audience: row.audience || "online shoppers", channel: "paid_social_square", productImageUrl: await prep(row.image) },
    },
    res,
  );
  const seconds = Math.round((Date.now() - t0) / 1000);
  const events = res.chunks.join("").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  const result = events.find((e) => e.type === "result");
  const err = events.find((e) => e.type === "error");
  const notes = events.filter((e) => e.type === "fallback_note").map((e) => e.message);
  const cutout = events.find((e) => e.type === "cutout_full");
  if (cutout) writeFileSync(`${out}/${sku}-${tag}cutout.png`, Buffer.from(cutout.pngB64, "base64"));
  console.log(`\n== ${sku} (${row.product}): http ${res.statusCode}, ${seconds} s`);
  if (!result) { console.log(`  no result: ${JSON.stringify(err ?? res.jsonBody)}`); continue; }
  const concepts = result.result.concepts as Array<Record<string, any>>;
  const summary = concepts.map((c) => {
    writeFileSync(`${out}/${sku}-${tag}r${c.round}.jpg`, Buffer.from(c.imageB64, "base64"));
    const critic = (c.models ?? []).find((m: any) => m.step === "critic");
    return {
      round: c.round, direction: c.direction, archetype: c.archetype, score: c.score, headline: c.headline, body: c.body, layout: c.layout?.mode, product: c.layout ? `${c.layout.productTop}-${c.layout.productBottom}` : null,
      type: c.layout ? `${c.layout.textTop}-${c.layout.textBottom}` : null, weakness: c.weakness, capReason: c.breakdown?.capReason ?? null, defects: c.defects, critic: critic?.label, notes: c.notes, parts: c.breakdown?.parts ?? null, rawScore: c.breakdown?.overallBeforeCaps ?? null, fix: c.fix, critique: c.critique,
    };
  });
  for (const s of summary) console.log(`  round ${s.round} [${s.direction}] score ${s.score} "${s.headline}" layout ${s.layout} type ${s.type} product ${s.product}\n    parts: ${s.parts ? Object.entries(s.parts).map(([k, v]: [string, any]) => k + " " + v.score).join(", ") : "none"}; before caps ${s.rawScore}
    cap: ${s.capReason ?? "none"}; weakness: ${s.weakness}; defects: ${(s.defects ?? []).join("; ") || "none"}; notes: ${(s.notes ?? []).join("; ") || "none"}`);
  console.log(`  final pick: round ${concepts[result.result.finalPickIndex].round}; notes: ${notes.join(" | ") || "none"}`);
  writeFileSync(`${out}/${sku}-${tag}run.json`, JSON.stringify({ sku, seconds, finalPickIndex: result.result.finalPickIndex, notes, summary }, null, 2));
}
