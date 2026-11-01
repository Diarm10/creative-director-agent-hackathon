// The Creative Director engine as an MCP server (stdio). Three tools:
//   list_folios      the brand folios you can pass to generate_creative
//   generate_creative  a brief in, the final image and the critic breakdown out
//   submit_feedback    your score and reason for a round, kept for the next run (client memory)
// It runs the same engine as the web app, locally, with MODEL_API_KEY and an optional BASETEN_API_KEY from the
// environment. Nothing is written to stdout except protocol messages: logs go to stderr.
//
//   npm run mcp
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCreativeLoop } from "../src/lib/meta/loop.ts";
import { CHANNELS, type Brief, type CreativeResult } from "../src/lib/meta/brief.ts";
import { folioToInput, sanitiseFolio, type Folio } from "../src/lib/meta/folio.ts";
import { loadBuiltInFolios } from "../src/lib/meta/folioDisk.ts";
import { buildFeedbackRow, suggestDirection } from "../src/lib/meta/feedbackRow.ts";
import { buildWinnerRow, memoryFromClient, type FeedbackRow, type MemoryRow } from "../src/lib/meta/memory.ts";
import { sanitizeFeedbackText } from "../src/lib/meta/feedbackSafety.ts";

type RunFn = (brief: Brief) => Promise<CreativeResult>;

export interface McpDeps {
  run?: RunFn; // the engine; a fake in tests
  dataFile?: string; // where feedback and winners are kept between runs
  outDir?: string; // where final images are written
  folios?: Folio[];
}

interface Store {
  feedback: Array<FeedbackRow & Record<string, unknown>>;
  winners: MemoryRow[];
}

function readStore(file: string): Store {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as Partial<Store>;
    return { feedback: Array.isArray(j.feedback) ? j.feedback : [], winners: Array.isArray(j.winners) ? j.winners : [] };
  } catch {
    return { feedback: [], winners: [] };
  }
}

function writeStore(file: string, store: Store): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ feedback: store.feedback.slice(-200), winners: store.winners.slice(-60) }, null, 2));
}

interface RunRecord {
  folioId: string | null;
  brief: Brief;
  result: CreativeResult;
  paths: string[];
}

const briefShape = {
  brief_type: z.enum(["product", "event", "promo"]).default("product").describe("product ad, event poster or promo graphic"),
  client_name: z.string().max(80).describe("The brand, organiser or client"),
  audience: z.string().max(200),
  title: z.string().max(80).optional().describe("Event or promo title, for example Build for Your World"),
  product_noun: z.string().max(80).optional().describe("Product briefs: what the physical product is, as a short noun phrase"),
  product_image_path: z.string().optional().describe("Product briefs: path to your own product photo on this machine"),
  offer: z.string().max(140).optional(),
  event_date: z.string().max(60).optional(),
  event_place: z.string().max(100).optional(),
  cta: z.string().max(80).optional().describe("Call to action, used exactly as written"),
  facts: z.string().max(500).optional().describe("Facts the copy may use, when no folio is given"),
  brand_colours: z.string().max(100).optional().describe("Hex codes or words such as navy and gold"),
  channel: z.enum(["paid_social_square", "story_vertical", "in_store_poster"]).default("paid_social_square"),
  folio_id: z.string().optional().describe("An id from list_folios"),
};

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const run: RunFn = deps.run ?? ((brief) => runCreativeLoop(brief));
  const dataFile = deps.dataFile ?? process.env.CREATIVE_DIRECTOR_DATA ?? join(homedir(), ".creative-director-agent", "memory.json");
  const outDir = deps.outDir ?? process.env.CREATIVE_DIRECTOR_OUT ?? join(tmpdir(), "creative-director-agent");
  const folios = deps.folios ?? loadBuiltInFolios();
  const runs = new Map<string, RunRecord>();
  let counter = 0;

  const server = new McpServer({ name: "creative-director-agent", version: "0.1.0" });

  server.registerTool(
    "list_folios",
    { description: "List the brand folios (approved facts and banned claims) that generate_creative can use.", inputSchema: {} },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(folios.map((f) => ({ id: f.id, brand: f.brand_name, product: f.product_name, channels: f.channels.length ? f.channels : CHANNELS, approved_facts: f.approved_facts, banned_words: f.banned_words })), null, 2) }],
    }),
  );

  server.registerTool(
    "generate_creative",
    {
      description:
        "Run the Creative Director: two to three rounds of plan, design, critique and revision. Returns the final design as an image (and a file path) with the critic's six-part breakdown and which model ran each step.",
      inputSchema: briefShape,
    },
    async (args) => {
      const folio = args.folio_id ? folios.find((f) => f.id === args.folio_id) : undefined;
      if (args.folio_id && !folio) return { isError: true, content: [{ type: "text", text: `Unknown folio_id. Use list_folios.` }] };
      if (folio?.channels.length && !folio.channels.includes(args.channel)) return { isError: true, content: [{ type: "text", text: "That folio does not allow this channel." }] };
      let productImageUrl: string | undefined;
      if (args.brief_type === "product") {
        if (!args.product_noun || !args.product_image_path) return { isError: true, content: [{ type: "text", text: "A product brief needs product_noun and product_image_path." }] };
        try {
          productImageUrl = `data:image/jpeg;base64,${readFileSync(args.product_image_path).toString("base64")}`;
        } catch {
          return { isError: true, content: [{ type: "text", text: "Could not read the product photo at product_image_path." }] };
        }
      } else if (args.brief_type === "event" && (!args.title || !args.event_date)) {
        return { isError: true, content: [{ type: "text", text: "An event brief needs title and event_date." }] };
      } else if (args.brief_type === "promo" && (!args.title || !args.offer)) {
        return { isError: true, content: [{ type: "text", text: "A promo brief needs title and offer." }] };
      }

      const audience = sanitizeFeedbackText(args.audience, 200);
      const brief: Brief = {
        briefType: args.brief_type,
        clientName: sanitizeFeedbackText(args.client_name, 80),
        audience,
        title: args.title,
        productNoun: args.brief_type === "product" ? args.product_noun : undefined,
        productImageUrl,
        offer: args.offer,
        eventDate: args.event_date,
        eventPlace: args.event_place,
        cta: args.cta,
        facts: args.facts,
        brandColours: args.brand_colours,
        channel: args.channel,
        folio: folio ? folioToInput(sanitiseFolio(folio) ?? folio) : undefined,
      };
      const store = readStore(dataFile);
      brief.memory = memoryFromClient(store, { folioId: folio?.id ?? null, audience, briefType: args.brief_type, label: folio?.brand_name ?? brief.clientName });

      let result: CreativeResult;
      try {
        result = await run(brief);
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `The run stopped: ${e instanceof Error ? e.message : String(e)}` }] };
      }

      const runId = `run-${Date.now().toString(36)}-${++counter}`;
      mkdirSync(outDir, { recursive: true });
      const paths = result.concepts.map((c) => {
        const file = join(outDir, `${runId}-round${c.round}.jpg`);
        writeFileSync(file, Buffer.from(c.imageB64, "base64"));
        return file;
      });
      runs.set(runId, { folioId: folio?.id ?? null, brief, result, paths });

      const final = result.concepts[result.finalPickIndex];
      const finalPath = paths[result.finalPickIndex];
      const winners = [...store.winners, buildWinnerRow({ folioId: folio?.id ?? null, audience, briefType: args.brief_type, headline: final.headline, body: final.body, archetype: final.archetype, paletteSummary: final.paletteSummary, criticScore: final.score })];
      writeStore(dataFile, { feedback: store.feedback, winners });

      const summary = {
        run_id: runId,
        final_round_id: `${runId}:${final.round}`,
        final_image_path: finalPath,
        score: final.score,
        headline: final.headline,
        subline: final.body,
        call_to_action: final.cta,
        critic_breakdown: final.breakdown,
        critique: final.critique,
        models_by_step: Object.fromEntries(final.models.map((m) => [m.step, m.fellBack ? `${m.label} (fallback: ${m.reason ?? "error"})` : m.label])),
        rounds: result.concepts.map((c) => ({ round_id: `${runId}:${c.round}`, score: c.score, headline: c.headline, image_path: paths[c.round - 1] })),
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(summary, null, 2) },
          { type: "image", data: final.imageB64, mimeType: "image/jpeg" },
        ],
      };
    },
  );

  server.registerTool(
    "submit_feedback",
    {
      description: "Give your score and reason for a round of a finished run. It is kept in a local file and quoted to the critic as calibration the next time you make something for the same brand. It is not model training.",
      inputSchema: {
        round_id: z.string().describe("A round_id from generate_creative, such as run-abc-1:2"),
        score: z.number().int().min(1).max(10).describe("Your own score for that round"),
        reason: z.string().max(300).default("").describe("Why, for example: the date is too small"),
      },
    },
    async ({ round_id, score, reason }) => {
      const [runId, roundText] = round_id.split(":");
      const record = runs.get(runId ?? "");
      const concept = record?.result.concepts.find((c) => c.round === Number(roundText));
      if (!record || !concept) return { isError: true, content: [{ type: "text", text: "Unknown round_id. Use one returned by generate_creative in this session." }] };
      const row = buildFeedbackRow(
        { productFolioId: record.folioId, audience: record.brief.audience, briefType: record.brief.briefType ?? "product", channel: record.brief.channel ?? "paid_social_square" },
        concept,
        { score, direction: suggestDirection(concept.score, score), reason },
      );
      const store = readStore(dataFile);
      writeStore(dataFile, { feedback: [...store.feedback, row], winners: store.winners });
      return { content: [{ type: "text", text: `Saved. The critic scored this round ${concept.score}/10 and you scored it ${row.human_score}/10 (${row.direction.replace("_", " ")}).` }] };
    },
  );

  return server;
}

// Start on stdio when run directly (npm run mcp).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("creative-director-agent MCP server ready on stdio");
}
