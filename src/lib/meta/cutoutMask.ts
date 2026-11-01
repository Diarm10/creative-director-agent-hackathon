// NEW FOR HACKATHON. Turns a SAM mask into a clean, solid product cut-out. Pure image maths, no
// network, unit tested.
//
// Root cause this replaces: the old code resized the 1-channel mask with sharp and called .raw(),
// but sharp returned 3 bytes per pixel. joinChannel then read the first third of those bytes as a
// 1-channel alpha, so the alpha was a skewed, stretched copy of the mask: parts of the product were
// transparent and background survived as a lighter block around it.
//
// What it does now:
//   1. keep only the largest connected component of the mask (drops stray islands)
//   2. fill interior holes (a clear lid or glossy highlight must not punch through the product)
//   3. upscale the mask smoothly and harden it, pulling the edge in about a pixel so no photo
//      background fringes around the outline
//   4. read alpha with the channel count sharp really returns
//   5. trim to the alpha bounding box
import sharp from "sharp";

export interface MaskInput {
  photoPng: Buffer; // the normalised photo SAM saw
  raster: Uint8Array; // 0 or 1 per pixel, maskW * maskH
  maskW: number;
  maskH: number;
  bounds: { left: number; top: number; right: number; bottom: number }; // source pixels the mask covers
  imgW: number;
  imgH: number;
}

export interface CutoutResult {
  png: Buffer;
  box: { left: number; top: number; width: number; height: number };
}

/**
 * Morphological opening: erode by r, then dilate by r. Anything thinner than 2r + 1 pixels disappears (slivers and ragged
 * pieces of background that hang into a handle opening or along an edge), and anything wider keeps its shape.
 */
export function openMask(raster: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return raster;
  const pass = (src: Uint8Array, want: number): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let all = true;
        let any = false;
        for (let dy = -r; dy <= r && (want ? all : !any); dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : src[ny * w + nx];
            if (!v) all = false;
            else any = true;
          }
        }
        out[y * w + x] = want ? (all ? 1 : 0) : any ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(raster, 1), 0);
}

/** Largest 4-connected component of foreground pixels. Returns a new 0/1 raster. */
export function largestComponent(raster: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!raster[start] || label[start]) continue;
    next++;
    let size = 0;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && raster[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && raster[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && raster[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && raster[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(w * h);
  if (best === 0) return out;
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/**
 * Fills background pixels that cannot reach the border (holes inside the product). A hole bigger than
 * maxFraction of the whole mask is a real opening, such as the loop of a mug handle, and stays open.
 */
export function fillHoles(raster: Uint8Array, w: number, h: number, maxFraction = 1): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => {
    if (!raster[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  if (maxFraction >= 1) return out;
  // Look at each enclosed hole on its own: small ones are filled, large ones are put back as openings.
  const limit = maxFraction * w * h;
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (raster[start] || outside[start] || seen[start]) continue;
    const members: number[] = [start];
    seen[start] = 1;
    for (let k = 0; k < members.length; k++) {
      const q = members[k];
      const x = q % w;
      const y = (q - x) / w;
      for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) {
        if (n >= 0 && !raster[n] && !outside[n] && !seen[n]) { seen[n] = 1; members.push(n); }
      }
    }
    if (members.length > limit) for (const q of members) out[q] = 0;
  }
  return out;
}

/** Reads an image's first channel as a tightly packed w*h buffer, whatever channel count sharp returns. */
async function firstChannel(img: ReturnType<typeof sharp>): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return { data, width: info.width, height: info.height };
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0, j = 0; i < out.length; i++, j += info.channels) out[i] = data[j];
  return { data: out, width: info.width, height: info.height };
}

export async function buildCutout(input: MaskInput): Promise<CutoutResult | null> {
  const left = Math.max(0, Math.floor(input.bounds.left));
  const top = Math.max(0, Math.floor(input.bounds.top));
  const right = Math.min(input.imgW, Math.ceil(input.bounds.right));
  const bottom = Math.min(input.imgH, Math.ceil(input.bounds.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;

  // Slivers of background caught inside a handle opening or along an edge are opened away first, so a large opening is clean.
  const r = Math.max(1, Math.round(Math.max(input.maskW, input.maskH) * 0.004));
  const opened = openMask(input.raster, input.maskW, input.maskH, r);
  const base = opened.some((v) => v) ? opened : input.raster; // never open a small product out of existence
  const solid = fillHoles(largestComponent(base, input.maskW, input.maskH), input.maskW, input.maskH, 0.035);
  if (!solid.some((v) => v)) return null;
  const small = Buffer.alloc(solid.length);
  for (let i = 0; i < solid.length; i++) small[i] = solid[i] ? 255 : 0;

  // Smooth upscale, then harden: 2.5x contrast around a threshold above the midpoint, so the edge
  // is about one pixel wide and sits slightly inside the true outline.
  const alphaImg = sharp(small, { raw: { width: input.maskW, height: input.maskH, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .linear(2.5, -297.5);
  const alpha = await firstChannel(alphaImg);
  if (alpha.width !== width || alpha.height !== height) return null;

  // Trim to the alpha bounding box.
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha.data[y * width + x] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const cropAlpha = Buffer.alloc(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    alpha.data.copy(cropAlpha, y * cropW, (minY + y) * width + minX, (minY + y) * width + minX + cropW);
  }
  const rgb = await sharp(input.photoPng)
    .extract({ left: left + minX, top: top + minY, width: cropW, height: cropH })
    .removeAlpha()
    .raw()
    .toBuffer();
  const png = await sharp(rgb, { raw: { width: cropW, height: cropH, channels: 3 } })
    .joinChannel(cropAlpha, { raw: { width: cropW, height: cropH, channels: 1 } })
    .png()
    .toBuffer();
  return { png, box: { left: left + minX, top: top + minY, width: cropW, height: cropH } };
}
