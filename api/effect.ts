import type { VercelRequest, VercelResponse } from '@vercel/node'
import sharp from 'sharp'
import { restyle } from '../src/lib/meta/restyle.js'
import { cleanPlanCarry } from '../src/lib/meta/revision.js'
import { sanitizeFeedbackText } from '../src/lib/meta/feedbackSafety.js'
import { lookById } from '../src/lib/meta/looks.js'
import { themeById } from '../src/lib/meta/themes.js'
import { effectFromRequest } from '../src/lib/meta/style.js'
import { RunLimiter, checkDemoCode, clientIp } from './_lib/gate.js'

// "Try another effect": the same ad drawn again with a different effect from the cut-out the run already made. It makes no model
// call. The overlap guard and the claim words are checked again; the critic is not, so the picture comes back unscored.
export const maxDuration = 60

const MAX_CUTOUT_B64 = 2_500_000
const ARCHETYPES = ['behind', 'product'] as const
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i
const limiter = new RunLimiter({ ipPerHour: 120, dailyCap: 1500 })
const text = (v: unknown, max: number) => sanitizeFeedbackText(v, max)
const opt = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? text(v, max) : undefined)

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
  if (!archetype) return res.status(400).json({ error: 'Only the type-behind and studio layouts can take another effect.' })
  const effect = effectFromRequest(body.effect)
  if (effect === undefined) return res.status(400).json({ error: 'Unknown effect.' })
  const headline = text(c.headline, 60)
  if (!headline) return res.status(400).json({ error: 'The request needs a headline.' })
  if (typeof body.cutoutB64 !== 'string' || !body.cutoutB64 || body.cutoutB64.length > MAX_CUTOUT_B64) return res.status(400).json({ error: 'The cut-out is missing or too large.' })

  let cutoutPng: Buffer
  try {
    cutoutPng = Buffer.from(body.cutoutB64, 'base64')
    const meta = await sharp(cutoutPng).metadata()
    if (meta.format !== 'png' || !meta.hasAlpha || (meta.width ?? 0) > 1600 || (meta.height ?? 0) > 1600) throw new Error('not a cut-out')
  } catch {
    return res.status(400).json({ error: 'The cut-out is not a valid PNG with transparency.' })
  }
  const lookId = opt(b.look, 20)
  const themeId = opt(b.theme, 20)
  if ((lookId && !lookById(lookId)) || (themeId && !themeById(themeId))) return res.status(400).json({ error: 'Unknown look or theme.' })
  const carry = cleanPlanCarry(c.plan)
  try {
    const out = await restyle({
      archetype,
      plan: { headline, subline: text(c.body, 90), cta: text(c.cta, 64), badge: carry.badge, ctaScale: carry.ctaScale, gapScale: carry.gapScale, overlapGuard: carry.overlapGuard, productScale: carry.productScale, headScale: carry.headScale, colours: carry.colours },
      brief: {
        clientName: text(b.clientName, 80), offer: opt(b.offer, 140), facts: opt(b.facts, 500), look: lookId, theme: themeId,
        brandColours: (Array.isArray(b.brandColours) ? b.brandColours : []).filter((x): x is string => typeof x === 'string' && HEX.test(x.trim())).join(' '),
      },
      cutoutPng,
      effect,
    })
    const jpeg = await sharp(out.png).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer()
    res.status(200).json({ imageB64: jpeg.toString('base64'), imageMime: 'image/jpeg', effect, checks: out.checks, headlineVisible: out.layout?.headlineVisible ?? null })
  } catch (e) {
    res.status(422).json({ error: e instanceof Error && e.message ? e.message : 'The effect could not be applied.' })
  }
}
