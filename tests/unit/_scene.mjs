// A synthetic product scene for layout tests: a calm wall on top, a textured surface (like denim) below it, and a
// product-like rounded block sitting low on the surface. Returns the scene and where the product is in it.
import sharp from 'sharp';

export async function makeScene({ size = 1024, wallEnd = 0.45, product = { left: 0.3, top: 0.58, right: 0.7, bottom: 0.86 }, height = size, vignette = false } = {}) {
  const W = size;
  const H = height;
  const wall = { create: { width: W, height: H, channels: 3, background: { r: 222, g: 216, b: 206 } } };
  const textured = await sharp({ create: { width: W, height: Math.round(H * (1 - wallEnd)), channels: 3, noise: { type: 'gaussian', mean: 70, sigma: 38 } } })
    .tint({ r: 40, g: 70, b: 120 })
    .png()
    .toBuffer();
  const p = { left: Math.round(product.left * W), top: Math.round(product.top * H), width: Math.round((product.right - product.left) * W), height: Math.round((product.bottom - product.top) * H) };
  const block = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}"><rect width="${p.width}" height="${p.height}" rx="${Math.round(p.width * 0.22)}" fill="#4d7389"/></svg>`);
  const scene = await sharp(wall)
    .composite([{ input: textured, top: Math.round(H * wallEnd), left: 0 }, { input: await sharp(block).png().toBuffer(), top: p.top, left: p.left }])
    .png()
    .toBuffer();
  if (vignette) {
    // Dark edge shading on a shaded wall, as in generated scenes: the surface does not change, only the light does.
    const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.12" stop-color="#000" stop-opacity="0"/><stop offset="0.88" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs><rect width="${W}" height="${Math.round(H * 0.7)}" fill="url(#l)"/></svg>`);
    return { scene: await sharp(scene).composite([{ input: shade }]).png().toBuffer(), productBox: p, wallEndPx: Math.round(H * wallEnd) };
  }
  return { scene, productBox: p, wallEndPx: Math.round(H * wallEnd) };
}

/** The lowest row (and highest) where a design differs from the plain scene: where the type block ends, in pixels. */
export async function typeExtent(design, plainScene, W, H) {
  const a = await sharp(design).resize(W, H).removeAlpha().raw().toBuffer();
  const b = await sharp(plainScene).resize(W, H).removeAlpha().raw().toBuffer();
  let first = -1;
  let last = -1;
  for (let y = 0; y < H; y++) {
    let diff = 0;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) diff++;
    }
    if (diff > 3) {
      if (first < 0) first = y;
      last = y;
    }
  }
  return { first, last };
}
