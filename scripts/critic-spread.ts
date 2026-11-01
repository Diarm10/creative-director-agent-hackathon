// Runs one finished ad through the critic several times and prints each part's score, to measure how consistent it is.
//   npx tsx --env-file=.env.local scripts/critic-spread.ts tmp/p1/mug-white-r1.jpg "Headline" "Subline" "Shop now" 3
import { readFileSync } from "node:fs";
import { critiqueImage } from "../src/lib/meta/loop.ts";
import { TYPE_BEHIND_NOTE } from "../src/lib/meta/prompts.ts";
import { createModelCaller, createRouterFromEnv } from "../src/lib/meta/providers.ts";
const [file, headline, subline, cta, n] = process.argv.slice(2);
const ai = createModelCaller(createRouterFromEnv(process.env), () => {});
const img = readFileSync(file);
const runs = Number(n ?? 3);
for (let i = 0; i < runs; i++) {
  ai.startRound(i + 1);
  const c = await critiqueImage(img, [headline, subline, cta, "Fernhill Home"].filter(Boolean), true, "online shoppers", [], { briefType: "product", previous: null, memory: null, hasFolio: false, supplied: ["the organiser \"Fernhill Home\""], measured: null, designNote: process.env.BEHIND ? TYPE_BEHIND_NOTE : null }, ai);
  console.log(`run ${i + 1}: overall ${c.score} (raw ${c.rawScore}) ${c.parts ? Object.entries(c.parts).map(([k, v]) => `${k} ${v.score}`).join(", ") : "no parts"} | ${c.weakness}`);
}
