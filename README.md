# Creative Director Agent

Turns a messy product catalogue into clean, true, human-approved ads in minutes.

Built for the Meta Global AI Developer Hackathon (Startup track, theme Build for Your World), 26 Oct to 4 Nov 2026.

**Live demo:** https://creative-director-agent.vercel.app

Access needs a demo code. The code is given to the judges separately and is never stored in this repository: the server reads it from the `DEMO_CODE` environment variable and refuses every run when it is not set.

## What it does

You load a small catalogue (up to 12 products, a CSV and one photo each). The agent checks each photo, cuts each product out, writes a short headline, draws the ad with a layout engine, reviews it like an art director, and shows it to you. Nothing is approved until you click **Approve**, and nothing is added to your photos.

- **Catalogue mode:** photo check, Held back cards for photos that are not safe to use, Try anyway and Find items rescues, approve or reject each ad, download the approved ones as a ZIP with a results file.
- **Looks, Themes and Effects:** seven Looks (including Magazine Cover and Sticker Pack), thirteen Themes, four effects. A finished ad can be redrawn with a new Look or effect in seconds, with no model call.
- **Single ad mode:** an event poster, a promo graphic or a product ad from one photo, with revision notes and a campaign pack.
- **MCP server:** the same engine as three tools for any MCP client.

## Models used

| Model | Where | Used for |
|---|---|---|
| Muse Spark Open (`meta-models/muse-spark-open-1026`) on Baseten | Baseten | Primary reviewer: the critic, the product fidelity check, the brand rules check, the photo check, and the line sense check |
| Muse Spark 1.3 (`muse-spark-1.3`) on Meta's Model API | Meta | Planning and headlines, and the fallback for every reviewer step when Baseten is missing, slow or fails |
| SAM 3.1 (`sam-3.1`) on Meta's Model API | Meta | Cutting each product out of its photo |
| Muse Image 1.0 (`muse-image-1.0`) on Meta's Model API | Meta | Text-free artwork, and product scenes built around the cut-out |

No other vendor's model is used. If `BASETEN_API_KEY` is not set, every step runs on Muse Spark 1.3 on Meta. The page shows on each card which model did the reviewing and when the fallback stepped in.

## How the copy rules work

The aim is ads that read like ads, and that never say something untrue.

- **The model writes headlines only.** It is told to leave the subline empty, and anything it sends for the subline is dropped.
- **A subline is only one of three things:** a fact or offer you supplied (the CSV `fact` column, the offer box, a folio's approved claims), one safe occasion line from a gifting theme (Christmas, Valentine's Day, Mother's Day) for a plausible gift, or empty. A headline plus a button is a finished ad.
- **Plain code checks every line,** headlines and alternatives included. It rejects colour, material and part words, any word of the product name or the photo description beyond its noun, flaw and filler words ("plain", "basic", "no text", "chipped"), broken English ("Sit A While"), and headlines that are only a verb and "something".
- **Claim words are rejected** ("warm", "cold", "lasts", "keeps", "seals", "holds" and the rest) unless your own facts or offer say them, because a photo cannot show them.
- **One rewrite, then a safe line.** A rejected set is rewritten once with the reason in the prompt. If it fails again, a plain safe headline for the product type is used.
- **Invented figures are blocked.** An ad may only quote a percentage, price, date or code that is in the offer or the facts. A sale theme will not run without an offer you type.
- **A human approves every ad.** Nothing goes into the download until you click Approve.

## How an ad is scored

The critic scores six parts (legibility, hierarchy, composition, brand fit, fidelity, originality). Then the score is moved by what can be measured, with no extra model call: a product that touches the headline, headline contrast under 4.5 to 1, a product under 35 percent of the frame height or a mostly empty frame cost points, and a clean, high-contrast layout earns one. A product never covers its headline: it starts at least about 3 percent of the frame height below the last line. Caps apply on top: a product that does not match the real one, a blocked claim, or copy that breaks a rule is held down.

## Pre-existing before the hackathon

This is from the author's own log, which cannot be checked from this repository. Firepack is the author's live CRM SaaS, a separate private product that is not in this repository and is not needed to run it. Before kickoff, Firepack already had early drafts of a Meta API client, a SAM wrapper, two smoke scripts and a first agent loop. **None of those files were copied here.** Their replacements were written fresh from Meta's public Model API docs.

Code first written in a Firepack branch on 26 and 27 Oct 2026 (after kickoff) and then ported here, with the database, login and marketplace features removed:

- the layout and type engine (`src/lib/meta/design/`), the provider layer (`providers.ts`), the critic breakdown and parsing (`creativeDirectorPure.ts`), cut-out mask handling (`cutoutMask.ts`), revision (`revision.ts`), run-end rules (`runEnd.ts`), client memory (`memory.ts`), feedback safety, rows and export, and the single-ad run page components (`src/components/creative-director/`).

Third party: the fonts in `assets/fonts` (Barlow Condensed and Inter, SIL Open Font Licence, licence files included) and the npm packages in `package.json`.

## Built during the hackathon (26 Oct to 4 Nov 2026)

- **26 and 27 Oct:** the agent loop on Meta's Model API (plan, make, check, critique, revise), the Meta client and the SAM 3.1 cut-out wrapper (written fresh), the demo code gate and rate limits, folios without a database, browser-side feedback memory, the revise flow, the MCP server.
- **28 Oct:** Catalogue mode (photo check, groups, Held back cards, approve and download), the cut-out sanity check, the overlap guard for type behind the product, the campaign pack, Looks, Themes and Effects.
- **29 Oct:** the copy engine and its validators, editable headline and button text, Effect for all ads, nine more Themes and two more Looks, and the two rescues for held-back photos (Try anyway, Find items in this photo).
- **1 Nov onwards:** the rewritten copy rules above, the measured part of the score, Look redraw (per card and for all finished ads), a Magazine Cover masthead, readable small type on effect backgrounds, the whole-photo fallback for a cut-out that lost part of the product, the Demo set, a run timer, and four ads at a time.

## Run it locally

Needs Node 22.9 or newer.

```bash
npm install
cp .env.example .env.local        # then fill in MODEL_API_KEY, DEMO_CODE and optionally BASETEN_API_KEY
npm run dev:api                   # the API on port 3001
npm run dev                       # the page on http://localhost:5173
```

Type the value of `DEMO_CODE` into the box at the top right of the page. The code is yours to choose for a local run.

The sample catalogue (the Demo set and **Load the sample catalogue**) uses simple illustrations drawn by `scripts/make-demo-assets.ts`, so no third-party photo is needed. They are enough to try the page. For real ads, use your own product photos.

Other commands:

```bash
npm run typecheck      # tsc for the page, the engine and the API
npm test               # unit tests (no model calls)
npm run build          # the production build
npm run test:ui        # headless Chrome against the built page with a scripted stream
npm run demo-assets    # redraws the demo illustrations and test cut-outs if they are missing
npm run smoke:meta     # one text call and one image call against the real API
npm run smoke:sam      # a real SAM cut-out of the placeholder
npm run mcp            # the MCP server on stdio
```

## Tests

- **Unit tests** (`tests/unit/`, about 480): copy rules and validators, the layout engine and overlap guard, the headline gap test (a two-line headline over a tote and a notebook in every Look), the measured score, Looks, Themes and Effects, Catalogue mode, cut-out checks, providers and fallback, the API gate, the MCP server. No test calls a model.
- **Browser checks** (`tests/ui/smoke.cjs`, about 180): the whole page driven in headless Chrome against a scripted stream, including the Demo set, Held back cards, Look and effect redraws and the timer.

## MCP server

`npm run mcp` starts a stdio MCP server that runs the same engine locally. It reads `MODEL_API_KEY` and the optional `BASETEN_API_KEY` from the environment.

- `list_folios`: the brand folios you can pass to `generate_creative`.
- `generate_creative`: a brief in; the final design out as an image and a file path, with the critic's breakdown and which model ran each step.
- `submit_feedback`: a round id, a score and a reason, saved to a local file and quoted to the critic next time for the same brand.

For Claude Code: `claude mcp add creative-director --env MODEL_API_KEY=your-key -- npx tsx /full/path/to/creative-director-agent/mcp/server.ts`

## Access and cost control

- `DEMO_CODE` gates the API. If it is not set, every run is refused.
- Per-IP and daily limits, held in memory (best effort, per serverless instance): 40 runs an hour and 150 a day by default for ad runs, with their own limits for the photo check, redraws, the campaign pack and Find items.
- Hard limits per run: at most 4 Muse Image calls (2 for a revision), 3 rounds, and a 270 second guard inside the 300 second function limit.

## Known limits

- Scores cluster around 7 because the critic is a model. Treat the score as a rough guide and read each ad before approving it.
- The photo check is a yes or no model call and is not perfectly consistent. That is what Try anyway is for.
- A model check for a cut-out that lost part of the product (a plant without its pot) can miss.
- A photo with a person or hand, a visible brand or logo, or a watermark is refused for good, on the page and on the server.
- There is no logo support: folios hold facts, claims, colours and tone, not logos.
- Rate limits are per serverless instance, not global.

## Licence

MIT. See `LICENSE`. Fonts are under the SIL Open Font Licence (`assets/fonts`).
