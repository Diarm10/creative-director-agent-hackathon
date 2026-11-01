// Checks the Meta Model API key and the two calls the engine relies on: one Muse Spark answer and one Muse Image
// picture (one image, about $0.01). Prints what came back, never the key.
//
//   npm run smoke:meta
import { mkdirSync, writeFileSync } from "node:fs";
import { ImageBudget, MODELS, generateImage, hasMetaKey, text } from "../src/lib/meta/client.ts";

if (!hasMetaKey()) {
  console.error("MODEL_API_KEY is not set. Put it in .env.local and run: npm run smoke:meta");
  process.exit(1);
}
const answer = await text("Reply with the single word: ready", undefined, {});
console.error(`${MODELS.text}: ${JSON.stringify(answer)}`);
const b64 = await generateImage("A plain pale grey wall with soft side light, no text, no objects.", new ImageBudget(1), { size: "1024x1024" });
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/smoke-image.png", Buffer.from(b64, "base64"));
console.error(`${MODELS.image}: wrote tmp/smoke-image.png (${Math.round((b64.length * 3) / 4 / 1024)} KB)`);
