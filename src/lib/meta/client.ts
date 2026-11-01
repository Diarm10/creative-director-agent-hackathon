// Meta Model API client, written for this repo from the public docs (https://dev.meta.ai/docs).
//
// The API is OpenAI SDK compatible: base URL https://api.meta.ai/v1, bearer key in MODEL_API_KEY.
//   text and vision   POST /v1/responses          (muse-spark-1.3, images as input_image parts)
//   images            POST /v1/images/generations and /v1/images/edits   (muse-image-1.0)
//   segmentation      POST /v1/responses          (sam-3.1, see sam.ts)
// Rate limits from the pricing page: Muse Image 150 requests a minute, Muse Spark and SAM 3000.
// Server side only: never import this from browser code.
import OpenAI from "openai";

export const MODELS = {
  text: "muse-spark-1.3",
  image: "muse-image-1.0",
  segment: "sam-3.1",
} as const;

const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";

// The key is read when the module loads. A missing key does not stop the import (tests and the page
// bundle can import types safely); the first real call says what is missing.
export const meta = new OpenAI({
  baseURL: BASE_URL,
  apiKey: process.env.MODEL_API_KEY ?? "missing-key",
  maxRetries: 4, // the SDK backs off on 429 and 5xx, and waits for Retry-After when it is sent
});

function assertKey(): void {
  if (!process.env.MODEL_API_KEY) throw new Error("MODEL_API_KEY is not set");
}

/** Whether the Meta key is configured, for the API gate. */
export const hasMetaKey = (): boolean => !!process.env.MODEL_API_KEY;

export interface TextOptions {
  temperature?: number;
}

/** One text answer from Muse Spark. Throws when the answer is empty. */
export async function text(input: string, instructions?: string, opts: TextOptions = {}): Promise<string> {
  assertKey();
  const res = await meta.responses.create({
    model: MODELS.text,
    input,
    ...(instructions ? { instructions } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  const out = res.output_text?.trim();
  if (!out) throw new Error("Muse Spark returned an empty answer");
  return out;
}

/**
 * A hard cap on Muse Image calls for one run, with a small gap between them so a burst stays well
 * under 150 requests a minute. take() throws once the cap is used up.
 */
export class ImageBudget {
  private used = 0;
  private lastCall = 0;
  private readonly max: number;
  private readonly gapMs: number;

  constructor(max = 4, gapMs = 450) {
    this.max = max;
    this.gapMs = gapMs;
  }

  async take(): Promise<void> {
    if (this.used >= this.max) throw new Error(`Image budget of ${this.max} reached for this run`);
    this.used += 1;
    const wait = this.lastCall + this.gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
  }

  get count(): number {
    return this.used;
  }
}

type ImageParams = { model: string; prompt: string; n: number; size?: string; response_format: "b64_json"; output_format: "png" };

function firstImage(res: { data?: Array<{ b64_json?: string | null }> }): string {
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("Muse Image returned no image");
  return b64;
}

/** A new image from a prompt. Returns it as base64 PNG. */
export async function generateImage(prompt: string, budget: ImageBudget, opts: { size?: string } = {}): Promise<string> {
  assertKey();
  await budget.take();
  const params: ImageParams = { model: MODELS.image, prompt, n: 1, response_format: "b64_json", output_format: "png", ...(opts.size ? { size: opts.size } : {}) };
  return firstImage(await meta.images.generate(params as never));
}

/** An edit built from one or more reference images (for example a product cut-out). Returns base64 PNG. */
export async function editImage(prompt: string, images: Awaited<ReturnType<typeof OpenAI.toFile>>[], budget: ImageBudget, opts: { size?: string } = {}): Promise<string> {
  assertKey();
  await budget.take();
  const params = { model: MODELS.image, prompt, image: images.length === 1 ? images[0] : images, n: 1, response_format: "b64_json", output_format: "png", ...(opts.size ? { size: opts.size } : {}) };
  return firstImage(await meta.images.edit(params as never));
}

