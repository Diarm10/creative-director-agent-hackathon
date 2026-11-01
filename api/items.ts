import type { VercelRequest, VercelResponse } from '@vercel/node'
import sharp from 'sharp'
import { cutOutProduct } from '../src/lib/meta/segment.js'
import { cutoutSanity } from '../src/lib/meta/cutoutSanity.js'
import { ITEMS_PROMPT, MAX_ITEMS, parseItems, type FoundItem } from '../src/lib/meta/rescue.js'
import { RunLimiter, checkDemoCode, clientIp } from './_lib/gate.js'
import { askAboutPhoto, verifyRescuePhoto } from './_lib/vision.js'

// "Find items in this photo": for a collection style photo. The model lists up to four distinct products by name, then each one is cut out on
// its own with the segmentation model, checked by the same cut-out sanity check as any ad, and returned as a photo cropped round that item.
// Started only by a click. A photo with a person, a brand or a watermark is refused first, and a photo that cannot be checked is refused too.
export const maxDuration = 120

const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const limiter = new RunLimiter({ ipPerHour: 20, dailyCap: 150 })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const code = checkDemoCode(req.headers['x-demo-code'], process.env.DEMO_CODE)
  if (code === 'unset') return res.status(503).json({ error: 'The demo is switched off: no demo code is configured on the server.' })
  if (code === 'bad') return res.status(401).json({ error: 'That demo code is not right.' })
  if (!process.env.MODEL_API_KEY) return res.status(500).json({ error: 'Server misconfigured: no model key.' })

  const photo = (req.body as { photo?: unknown } | undefined)?.photo
  if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return res.status(400).json({ error: 'The photo must be sent as an image data URL' })
  const comma = photo.indexOf(',')
  if (Math.floor(((photo.length - comma - 1) * 3) / 4) > MAX_PHOTO_BYTES) return res.status(413).json({ error: 'Photo is too large.' })

  const limit = limiter.take(clientIp(req.headers, req.socket?.remoteAddress))
  if (!limit.ok) return res.status(429).json({ error: limit.error })

  const gate = await verifyRescuePhoto(photo)
  if (!gate.ok) return res.status(422).json({ error: gate.reason })

  let names: string[]
  try {
    names = parseItems(await askAboutPhoto(photo, ITEMS_PROMPT, 'You list the separate products in a photo for an online shop. Reply with JSON only.'))
  } catch {
    return res.status(502).json({ error: 'The items could not be listed from this photo.' })
  }
  if (names.length === 0) return res.status(200).json({ items: [] as FoundItem[] })

  const bytes = Buffer.from(photo.slice(comma + 1), 'base64')
  const items: FoundItem[] = []
  for (const name of names.slice(0, MAX_ITEMS)) {
    try {
      const cut = await cutOutProduct(name, bytes)
      if (!cut) { items.push({ name, ok: false, reason: 'the segmentation model found nothing by that name', photo: null }); continue }
      const verdict = await cutoutSanity({ cutoutPng: cut.png, box: cut.box, photoPng: cut.photoPng })
      if (!verdict.ok) { items.push({ name, ok: false, reason: verdict.reason, photo: null }); continue }
      // The photo cropped round the item, with a margin, so the ad for it starts from a cleaner picture.
      const meta = await sharp(cut.photoPng).metadata()
      const w = meta.width ?? 1
      const h = meta.height ?? 1
      const pad = Math.round(Math.max(cut.box.width, cut.box.height) * 0.12)
      const left = Math.max(0, cut.box.left - pad)
      const top = Math.max(0, cut.box.top - pad)
      const crop = await sharp(cut.photoPng).extract({ left, top, width: Math.min(w - left, cut.box.width + 2 * pad), height: Math.min(h - top, cut.box.height + 2 * pad) }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
      items.push({ name, ok: true, reason: null, photo: `data:image/jpeg;base64,${crop.toString('base64')}` })
    } catch (e) {
      items.push({ name, ok: false, reason: 'the cut-out failed', photo: null })
      console.warn('[items] could not cut out', name, e instanceof Error ? e.message : e)
    }
  }
  return res.status(200).json({ items })
}
