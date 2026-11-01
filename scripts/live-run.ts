// A real run, from the command line, against a deployed URL or in this process. Saves each round's image and
// prints how long the run took against the 300 second function limit.
//
//   npx tsx scripts/live-run.ts --url=https://your-app.vercel.app --job=event
//   npx tsx scripts/live-run.ts --url=https://your-app.vercel.app --job=sparks --revise
//   npx tsx scripts/live-run.ts --url=https://your-app.vercel.app --job=mug    (the bundled mug example)
//   npm run live -- --job=event            (runs the engine here; needs MODEL_API_KEY in .env.local)
//
// The demo code is read from DEMO_CODE or from the gitignored file .demo-code.local, and is never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { unzipSync } from "fflate";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const url = arg("url");
const job = arg("job") ?? "event";
const out = arg("out") ?? "tmp/live";
mkdirSync(out, { recursive: true });

const NOTE = "The gap between the text and the button is too big. Make the button larger.";

const briefs: Record<string, Record<string, unknown>> = {
  event: { briefType: "event", clientName: "Another World Events", title: "Build for Your World", eventDate: "Thu 20 Nov, 7pm", audience: "programmers", brandColours: "blue deep", channel: "paid_social_square" },
  promo: { briefType: "promo", clientName: "Cloudline Studio", title: "Autumn Sale", offer: "20% off all workshops until 30 November", audience: "freelancers who want to learn a new skill", channel: "paid_social_square" },
  mug: { briefType: "product", clientName: "Harbour Mugs", productNoun: "mug", audience: "people who work from home", channel: "paid_social_square" },
  sparks: { briefType: "product", clientName: "Sparks Audio", productNoun: "earbuds case", audience: "commuters who lose earbuds", channel: "paid_social_square", folio: { id: "sparks-audio" } },
};

function demoCode(): string {
  if (process.env.DEMO_CODE) return process.env.DEMO_CODE;
  if (existsSync(".demo-code.local")) return readFileSync(".demo-code.local", "utf8").trim();
  return "";
}

interface Concept { round: number; score: number; headline: string; body: string; cta: string; imageB64: string; plan?: unknown; weakness?: string; fix?: string; method: string; models?: Array<{ step: string; label: string; fellBack: boolean; reason?: string | null }>; breakdown?: { parts: Record<string, { score: number }>; capReason?: string | null }; defects?: string[]; layout?: { mode: string; zoom: number; gapPx: number; productGapPx: number; textTop: number; textBottom: number; productTop: number; productBottom: number; headSize: number; keptLabel?: boolean; keptSubline?: boolean }; critique?: string }
type Event = { type: string; [k: string]: unknown };

async function post(body: Record<string, unknown>): Promise<{ events: Event[]; ms: number; status: number }> {
  const t0 = Date.now();
  const res = await fetch(`${url}/api/run`, { method: "POST", headers: { "content-type": "application/json", "x-demo-code": demoCode() }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) return { events: [{ type: "http_error", status: res.status, message: (await res.text()).slice(0, 300) }], ms: Date.now() - t0, status: res.status };
  const events: Event[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) events.push(JSON.parse(l) as Event);
  }
  return { events, ms: Date.now() - t0, status: res.status };
}

function report(label: string, events: Event[], ms: number): Concept[] {
  const concepts = events.filter((e) => e.type === "round_done").map((e) => e.concept as Concept);
  const fin = events.find((e) => e.type === "run_finished");
  const err = events.find((e) => e.type === "error" || e.type === "http_error");
  console.log(`\n== ${label}: ${(ms / 1000).toFixed(0)} s of the 300 s limit`);
  for (const c of concepts) {
    const file = `${out}/${job}-${label}-round${c.round}.jpg`;
    writeFileSync(file, Buffer.from(c.imageB64, "base64"));
    const models = (c.models ?? []).map((m) => `${m.step}:${m.fellBack ? `FALLBACK(${m.reason ?? "?"}) ` : ""}${m.label.replace("Muse Spark ", "")}`).join(", ");
    console.log(`  round ${c.round}: score ${c.score}  "${c.headline}" / "${c.body}" / [${c.cta}]  ${c.method}  -> ${file}`);
    console.log(`           ${models}`);
    if (c.layout) console.log(`           layout ${c.layout.mode}: type ${c.layout.textTop}-${c.layout.textBottom}, product ${c.layout.productTop}-${c.layout.productBottom}, gap to product ${c.layout.productGapPx} px, zoom ${c.layout.zoom}, headline ${c.layout.headSize} px, label ${c.layout.keptLabel ?? "-"} subline ${c.layout.keptSubline ?? "-"}, gapScale ${(c.plan as { gapScale?: number } | undefined)?.gapScale ?? 1}`);
    if (c.breakdown?.capReason) console.log(`           CAP: ${c.breakdown.capReason}`);
    if (c.critique) console.log(`           critic: ${c.critique.slice(0, 230)}`);
  }
  if (!concepts.length) console.log(`  no round came back. Events: ${events.map((e) => e.type).join(", ") || "none"}`);
  if (fin) console.log(`  ${fin.message as string}`);
  if (err) console.log(`  ERROR ${(err.message as string) ?? ""} ${err.status ?? ""}`);
  return concepts;
}

async function main() {
  const brief = { ...briefs[job] };
  if (!brief) throw new Error(`unknown job ${job}`);
  if (job === "sparks" || job === "mug") {
    const photo = arg("photo") ?? (job === "mug" ? "demo-assets/mug.jpg" : "tmp/placeholder-product.jpg");
    brief.productImageUrl = `data:image/jpeg;base64,${readFileSync(photo).toString("base64")}`;
  }

  if (!url) {
    // In process: the same engine the API route and the MCP server run.
    const { runCreativeLoop, runRevision } = await import("../src/lib/meta/loop.ts");
    const { folioToInput } = await import("../src/lib/meta/folio.ts");
    const { loadBuiltInFolios } = await import("../src/lib/meta/folioDisk.ts");
    const { sanitiseRevision } = await import("../src/lib/meta/revision.ts");
    const folio = loadBuiltInFolios().find((f) => f.id === (brief.folio as { id?: string } | undefined)?.id);
    const local = { ...brief, folio: folio ? folioToInput(folio) : undefined, ...(arg("max-rounds") ? { maxRounds: Number(arg("max-rounds")) } : {}) } as never;
    const events: Event[] = [];
    const t0 = Date.now();
    await runCreativeLoop(local, (e) => events.push(e as unknown as Event)).catch(() => undefined);
    const concepts = report("run", events, Date.now() - t0);
    if (flag("revise") && concepts.length) {
      const base = concepts.at(-1)!;
      const rev = sanitiseRevision({ fromRound: base.round, round: base.round + 1, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note: NOTE, weakness: base.weakness, fix: base.fix });
      const revEvents: Event[] = [];
      const t1 = Date.now();
      await runRevision(local, rev!, (e) => revEvents.push(e as unknown as Event)).catch(() => undefined);
      report("revision", revEvents, Date.now() - t1);
    }
    return;
  }

  if (flag("revise-only")) {
    // One revision on a made-up earlier round, to time and check the revise path on its own.
    const plan = { artPrompt: "On a denim surface against a plain wall, soft light", pattern: "grid", variant: null, colours: [], badge: [], ctaScale: 1, gapScale: 1 };
    const only = await post({ ...brief, revise: { fromRound: 1, round: 2, headline: "Fits in a jeans pocket", subline: "Up to 24 hours of listening with the case", cta: "Learn more", plan, note: NOTE, weakness: "The gap above the button is tight", fix: "Add space" } });
    report("revision", only.events, only.ms);
    return;
  }
  const first = await post(brief);
  const concepts = report("run", first.events, first.ms);
  if (flag("pack") && concepts.length) {
    // The campaign pack of the final pick, from the deployed API: no model call is made for it.
    const finalIndex = (first.events.find((e) => e.type === "final_picked")?.index as number | undefined) ?? concepts.length - 1;
    const c = concepts[finalIndex] as Concept & { archetype?: string };
    const cutout = first.events.find((e) => e.type === "cutout_full")?.pngB64 as string | undefined;
    const hex = String(brief.brandColours ?? "").match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/gi) ?? [];
    const t0 = Date.now();
    const res = await fetch(`${url}/api/pack`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-code": demoCode() },
      body: JSON.stringify({
        concept: { round: c.round, archetype: c.archetype, headline: c.headline, body: c.body, cta: c.cta, plan: c.plan, imageB64: c.imageB64 },
        brief: { briefType: brief.briefType, clientName: brief.clientName, offer: brief.offer, eventDate: brief.eventDate, eventPlace: brief.eventPlace, brandColours: hex },
        cutoutB64: c.archetype === "behind" || c.archetype === "product" ? cutout : undefined,
      }),
    });
    console.log(`
== pack for round ${c.round} (${c.archetype}): HTTP ${res.status} in ${Date.now() - t0} ms, sizes ${res.headers.get("x-pack-sizes")}`);
    if (res.ok) {
      const zip = Buffer.from(await res.arrayBuffer());
      writeFileSync(`${out}/${job}-pack.zip`, zip);
      for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) {
        if (name.endsWith(".jpg")) {
          const m = await sharp(Buffer.from(data)).metadata();
          writeFileSync(`${out}/${job}-pack-${name}`, data);
          console.log(`   ${name}: ${m.width} x ${m.height}, ${Math.round(data.length / 1024)} KB`);
        } else console.log(`   ${name}: ${data.length} bytes`);
      }
    } else console.log("   ", (await res.text()).slice(0, 200));
  }
  if (flag("revise") && concepts.length) {
    const base = concepts.reduce((a, b) => (b.score >= a.score ? b : a));
    const second = await post({ ...brief, revise: { fromRound: base.round, round: Math.max(...concepts.map((c) => c.round)) + 1, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note: NOTE, weakness: base.weakness, fix: base.fix } });
    report("revision", second.events, second.ms);
  }
}

await main();
