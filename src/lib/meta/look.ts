// The look of a finished ad: a 256 bit difference hash, as 64 hex digits, for lookCompare.ts. Server side.
import sharp from "sharp";

export async function lookOf(image: Buffer): Promise<string> {
  const { data } = await sharp(image).flatten({ background: "#ffffff" }).greyscale().resize({ width: 17, height: 16, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += data[y * 17 + x] > data[y * 17 + x + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 256; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
