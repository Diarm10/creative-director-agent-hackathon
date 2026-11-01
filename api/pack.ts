import type { VercelRequest, VercelResponse } from '@vercel/node'
import sharp from 'sharp'
import { renderPack, type PackBrief, type PackConcept } from '../src/lib/meta/pack.js'
import { cleanPlanCarry } from '../src/lib/meta/revision.js'
import { sanitizeFeedbackText } from '../src/lib/meta/feedbackSafety.js'
import { RunLimiter, checkDemoCode, clientIp } from './_lib/gate.js'

// The campaign pack: the chosen design at square, story and poster sizes, as one ZIP with the copy. It makes no
// model call, so it is cheap; it is still behind the demo code and a per-IP limit. Designs that need no new
// picture are drawn again at each size; designs built on a generated picture keep their one size, and the pack
// says so (see src/lib/meta/pack.ts).
export const maxDuration = 60

const MAX_IMAGE_B64 = 3_000_000
const MAX_CUTOUT_B64 = 2_500_000
const ARCHETYPES = ['typographic', 'artwork', 'product', 'behind'] as const
const BRIEF_TYPES = ['product', 'event', 'promo'] as const
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i

const limiter = new RunLimiter({ ipPerHour: 30, dailyCap: 400 })

const text = (v: unknown, max: number) => sanitizeFeedbackText(v, max)
const optText = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? text(v, max) : undefined)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const code = checkDemoCode(req.headers['x-demo-code'], process.env.DEMO_CODE)
  if (code === 'unset') return res.status(503).json({ error: 'The demo is switched off: no demo code is configured on the server.' })
  if (code === 'bad') return res.status(401).json({ error: 'That demo code is not right.' })
  const limit = limiter.take(clientIp(req.headers, req.socket?.remoteAddress))
  if (!limit.ok) return res.status(429).json({ error: limit.error })

  const body = (req.body ?? {}) as Record<string, unknown>
  const c = (body.concept ?? {}) as Record<string, unknown>
  const b = (body.brief ?? {}) as Record<string, unknown>
  const archetype = ARCHETYPES.find((a) => a === c.archetype)
  const briefType = BRIEF_TYPES.find((t) => t === b.briefType)
  if (!archetype || !briefType) return res.status(400).json({ error: 'The pack request is not valid.' })
  const imageB64 = typeof c.imageB64 === 'string' ? c.imageB64 : ''
  if (!imageB64 || imageB64.length > MAX_IMAGE_B64) return res.status(400).json({ error: 'The design image is missing or too large.' })
  const headline = text(c.headline, 60)
  if (!headline) return res.status(400).json({ error: 'The pack request needs a headline.' })

  let cutoutPng: Buffer | undefined
  if (typeof body.cutoutB64 === 'string' && body.cutoutB64) {
    if (body.cutoutB64.length > MAX_CUTOUT_B64) return res.status(413).json({ error: 'The cut-out is too large.' })
    try {
      const png = Buffer.from(body.cutoutB64, 'base64')
      const meta = await sharp(png).metadata()
      if (meta.format !== 'png' || !meta.hasAlpha || (meta.width ?? 0) > 1600 || (meta.height ?? 0) > 1600) throw new Error('not a cut-out')
      cutoutPng = png
    } catch {
      return res.status(400).json({ error: 'The cut-out is not a valid PNG with transparency.' })
    }
  }

  const concept: PackConcept = {
    round: Number.isInteger(c.round) ? Math.max(1, Math.min(12, c.round as number)) : 1,
    archetype,
    headline,
    body: text(c.body, 90),
    cta: text(c.cta, 64),
    plan: cleanPlanCarry(c.plan),
    imageB64,
  }
  const brief: PackBrief = {
    briefType,
    clientName: text(b.clientName, 80),
    offer: optText(b.offer, 140),
    eventDate: optText(b.eventDate, 60),
    eventPlace: optText(b.eventPlace, 100),
    brandColours: (Array.isArray(b.brandColours) ? b.brandColours : []).filter((x): x is string => typeof x === 'string' && HEX.test(x.trim())).map((x) => x.trim()).slice(0, 6),
  }

  try {
    const { zip, sizes } = await renderPack({ concept, brief, cutoutPng })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="campaign-pack.zip"')
    res.setHeader('X-Pack-Sizes', JSON.stringify(sizes.map((s) => ({ id: s.id, how: s.how, reason: s.reason }))).slice(0, 1500))
    res.status(200).end(zip)
  } catch (e) {
    console.warn('[pack] could not render the pack:', e instanceof Error ? e.message : e)
    res.status(500).json({ error: 'The pack could not be made. Please try again.' })
  }
}
