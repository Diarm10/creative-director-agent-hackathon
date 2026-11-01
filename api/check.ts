import type { VercelRequest, VercelResponse } from '@vercel/node'
import sharp from 'sharp'
import { createRouterFromEnv } from '../src/lib/meta/providers.js'
import { PHOTO_CHECK_PROMPT, PHOTO_CHECK_SYSTEM, parsePhotoCheck } from '../src/lib/meta/photoCheck.js'
import { RunLimiter, checkDemoCode, clientIp } from './_lib/gate.js'

// The quick photo check for Catalogue mode: one vision question set per photo, through the same provider route as
// a run (Baseten first, Meta if Baseten cannot answer). It makes no image, so it is cheap, but it is still behind
// the demo code and its own per-IP limit.
export const maxDuration = 60

const MAX_PHOTO_BYTES = 3 * 1024 * 1024 // decoded; the page shrinks photos before sending
const limiter = new RunLimiter({ ipPerHour: 120, dailyCap: 800 })

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

  let width = 0
  let height = 0
  let forModel: string
  try {
    const bytes = Buffer.from(photo.slice(comma + 1), 'base64')
    const meta = await sharp(bytes).metadata()
    width = meta.width ?? 0
    height = meta.height ?? 0
    if (!width || !height) throw new Error('no size')
    const small = await sharp(bytes).resize({ width: 1024, height: 1024, fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
    forModel = `data:image/jpeg;base64,${small.toString('base64')}`
  } catch {
    return res.status(400).json({ error: 'That file is not a picture the check can read.' })
  }

  const limit = limiter.take(clientIp(req.headers, req.socket?.remoteAddress))
  if (!limit.ok) return res.status(429).json({ error: limit.error })

  try {
    const router = createRouterFromEnv(process.env)
    const { text, record } = await router.run({ step: 'fidelity', input: PHOTO_CHECK_PROMPT, instructions: PHOTO_CHECK_SYSTEM, images: [forModel], temperature: 0, expectJson: true })
    const flags = parsePhotoCheck(text)
    if (!flags) return res.status(502).json({ error: 'The photo check gave an answer that could not be read.' })
    return res.status(200).json({ flags, width, height, via: record.label, fellBack: record.fellBack })
  } catch {
    return res.status(502).json({ error: 'The photo check could not be completed.' })
  }
}
