import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runCreativeLoop, runRevision } from '../src/lib/meta/loop.js'
import { CHANNELS, type Brief, type BriefType, type CreativeChannel, type CreativeDirectorEvent } from '../src/lib/meta/brief.js'
import { buildResultEvent } from '../src/lib/meta/creativeDirectorPure.js'
import { memoryFromClient } from '../src/lib/meta/memory.js'
import { sanitiseRevision } from '../src/lib/meta/revision.js'
import { folioToInput, sanitiseFolio, type Folio } from '../src/lib/meta/folio.js'
import { loadBuiltInFolios } from '../src/lib/meta/folioDisk.js'
import { sanitizeFeedbackText } from '../src/lib/meta/feedbackSafety.js'
import { lookById } from '../src/lib/meta/looks.js'
import { checkOffer, themeById } from '../src/lib/meta/themes.js'
import { effectFromRequest } from '../src/lib/meta/style.js'
import { verifyRescuePhoto } from './_lib/vision.js'
import { DEFAULT_DAILY_CAP, DEFAULT_IP_PER_HOUR, RunLimiter, checkDemoCode, clientIp, positiveInt } from './_lib/gate.js'

// Server side entry point. The Meta and Baseten keys are read from the environment here and nowhere else.
//
// Refusals return JSON with a status code. Once a run starts the response is NDJSON: one line per progress
// event, then a final {"type":"result"} line (or the loop's own {"type":"error"} line if it fails).
//
// Fluid compute gives a function up to 300 seconds; the loop stops starting rounds that could not finish
// inside 270. vercel.json sets the same maxDuration and ships assets/fonts and folios with the function.
export const maxDuration = 300

const MAX_RESPONSE_BYTES = 4_200_000 // headroom under Vercel's 4.5MB response limit
const MAX_PHOTO_BYTES = 3 * 1024 * 1024 // decoded; the page shrinks photos to well under this
const MAX_FACTS_LENGTH = 500
const MAX_BRAND_COLOURS_LENGTH = 100
const BRIEF_TYPES: readonly BriefType[] = ['product', 'event', 'promo']

// Short text fields: name -> max length. Longer input is refused, never silently cut.
const TEXT_LIMITS = { clientName: 80, title: 80, productNoun: 80, offer: 140, audience: 200, eventDate: 60, eventPlace: 100, cta: 80 } as const

const limiter = new RunLimiter({
  ipPerHour: positiveInt(process.env.IP_RUN_LIMIT, DEFAULT_IP_PER_HOUR),
  dailyCap: positiveInt(process.env.DAILY_RUN_CAP, DEFAULT_DAILY_CAP),
})

/** The openings the page says other ads in the batch use: a few short plain words, nothing else. */
const cleanAvoid = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const words = v.filter((w): w is string => typeof w === 'string' && /^[a-z]{2,20}$/i.test(w.trim())).map((w) => w.trim().toLowerCase())
  return words.length ? [...new Set(words)].slice(0, 12) : undefined
}

const decodedBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(',')
  return Math.floor(((comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length) * 3) / 4)
}

type Body = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const code = checkDemoCode(req.headers['x-demo-code'], process.env.DEMO_CODE)
  if (code === 'unset') return res.status(503).json({ error: 'The demo is switched off: no demo code is configured on the server.' })
  if (code === 'bad') return res.status(401).json({ error: 'That demo code is not right.' })
  if (!process.env.MODEL_API_KEY) return res.status(500).json({ error: 'Server misconfigured: no model key.' })

  const body = (req.body ?? {}) as Body
  const briefType = (str(body.briefType) ?? 'product') as BriefType
  if (!BRIEF_TYPES.includes(briefType)) return res.status(400).json({ error: 'Unknown brief type' })
  // Catalogue mode sends catalogue: true, and the shop name is then optional. quick: true means two rounds, not three.
  const catalogue = body.catalogue === true
  const quick = body.quick === true
  if ((!catalogue && !str(body.clientName)) || !str(body.audience)) return res.status(400).json({ error: 'clientName and audience are required' })
  if (briefType === 'product' && (!str(body.productNoun) || !str(body.productImageUrl))) return res.status(400).json({ error: 'A product brief needs a product name and a photo' })
  if (briefType === 'event' && (!str(body.title) || !str(body.eventDate))) return res.status(400).json({ error: 'An event brief needs a title and a date' })
  if (briefType === 'promo' && (!str(body.title) || !str(body.offer))) return res.status(400).json({ error: 'A promo brief needs a title and an offer' })
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const v = body[field]
    if (typeof v === 'string' && v.length > max) return res.status(400).json({ error: `${field} must be ${max} characters or fewer` })
  }
  const facts = str(body.facts)
  if (facts && facts.length > MAX_FACTS_LENGTH) return res.status(400).json({ error: `facts must be ${MAX_FACTS_LENGTH} characters or fewer` })
  const brandColours = str(body.brandColours)
  if (brandColours && brandColours.length > MAX_BRAND_COLOURS_LENGTH) return res.status(400).json({ error: `brandColours must be ${MAX_BRAND_COLOURS_LENGTH} characters or fewer` })
  const channel = (str(body.channel) ?? 'paid_social_square') as CreativeChannel
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' })
  const photo = briefType === 'product' ? str(body.productImageUrl) : undefined
  if (photo && !photo.startsWith('data:image/')) return res.status(400).json({ error: 'The photo must be sent as an image data URL' })
  if (photo && decodedBytes(photo) > MAX_PHOTO_BYTES) return res.status(413).json({ error: `Photo is too large. Please use one under ${MAX_PHOTO_BYTES / (1024 * 1024)}MB.` })

  // Look, Theme and Effect. A sale theme will not run without an offer the person typed, and the offer is never a scarcity or delivery claim.
  const lookId = str(body.look)
  if (lookId && !lookById(lookId)) return res.status(400).json({ error: 'Unknown look' })
  const themeId = str(body.theme)
  const theme = themeId ? themeById(themeId) : null
  if (themeId && !theme) return res.status(400).json({ error: 'Unknown theme' })
  const offerCheck = briefType === 'product' || theme ? checkOffer(theme, str(body.offer)) : { ok: true, offer: str(body.offer) ?? '', error: null }
  if (!offerCheck.ok) return res.status(400).json({ error: offerCheck.error })
  const effect = effectFromRequest(body.effect)
  if (body.effect !== undefined && body.effect !== null && body.effect !== 'none' && effect === undefined) return res.status(400).json({ error: 'Unknown effect' })

  const revision = body.revise === undefined ? null : sanitiseRevision(body.revise)
  if (body.revise !== undefined && !revision) return res.status(400).json({ error: 'The revision request is not valid' })

  // A built-in folio always comes from the repo's own copy; only a folio you made is read from the request.
  let folio: Folio | null = null
  const sent = body.folio as { id?: unknown } | undefined
  if (sent && typeof sent === 'object') {
    folio = loadBuiltInFolios().find((f) => f.id === sent.id) ?? sanitiseFolio(sent)
    if (!folio) return res.status(400).json({ error: 'The folio is not valid' })
    if (folio.channels.length && !folio.channels.includes(channel)) return res.status(400).json({ error: 'This folio does not allow that channel' })
  }

  // "Try anyway" on a held-back photo: only for a product photo, and only after the server has looked for a person, a brand or a watermark itself.
  const rescue = body.rescue === true
  if (rescue && briefType !== 'product') return res.status(400).json({ error: 'Try anyway is only for a product photo' })

  const limit = limiter.take(clientIp(req.headers, req.socket?.remoteAddress))
  if (!limit.ok) return res.status(429).json({ error: limit.error })

  if (rescue && photo) {
    const gate = await verifyRescuePhoto(photo)
    if (!gate.ok) return res.status(422).json({ error: gate.reason })
  }

  const brief: Brief = {
    briefType,
    clientName: str(body.clientName) ? sanitizeFeedbackText(body.clientName, TEXT_LIMITS.clientName) : '',
    title: str(body.title),
    productNoun: briefType === 'product' ? str(body.productNoun) : undefined,
    productImageUrl: photo,
    offer: offerCheck.offer || undefined,
    audience: sanitizeFeedbackText(body.audience, TEXT_LIMITS.audience),
    eventDate: str(body.eventDate),
    eventPlace: str(body.eventPlace),
    cta: str(body.cta),
    facts,
    brandColours,
    channel,
    folio: folio ? folioToInput(folio) : undefined,
    maxRounds: quick ? 2 : undefined,
    copyAvoid: cleanAvoid(body.copyAvoid),
    copyIndex: typeof body.copyIndex === 'number' && Number.isInteger(body.copyIndex) ? Math.max(0, Math.min(99, body.copyIndex)) : undefined,
    look: lookId,
    theme: themeId,
    effect,
    rescue: rescue || undefined,
  }
  // Client memory: the saved feedback and past winners the browser sent, cleaned and capped again here.
  brief.memory = memoryFromClient(body.memory, { folioId: folio?.id ?? null, audience: brief.audience, briefType, label: folio?.brand_name ?? brief.clientName })

  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  // A run always ends with a terminal line: a result, or an error that says what happened. The page treats a stream
  // that ends without one as a dropped connection and offers to run again.
  let bytesWritten = 0
  let terminal = false
  let closed = false
  const send = (event: CreativeDirectorEvent | (ReturnType<typeof buildResultEvent> & { revision?: boolean })) => {
    if (closed) return
    if (event.type === 'error' || event.type === 'result') terminal = true
    const line = `${JSON.stringify(event)}\n`
    bytesWritten += Buffer.byteLength(line)
    res.write(line)
  }
  const close = () => {
    if (closed) return
    closed = true
    res.end()
  }
  // If the platform limit is close and the run has not ended (a model call that never returns), say so and close.
  const watchdog = setTimeout(() => {
    if (!terminal) send({ type: 'error', message: 'Stopped: the run took longer than the 300 second limit. Please run again.' })
    close()
  }, positiveInt(process.env.RUN_WATCHDOG_MS, 292_000))

  try {
    const result = revision ? await runRevision(brief, revision, send) : await runCreativeLoop(brief, send)
    send({ ...buildResultEvent(result, bytesWritten, MAX_RESPONSE_BYTES), ...(revision ? { revision: true } : {}) })
  } catch (e) {
    // The loop streams its own error line before rethrowing. If it could not (or the result could not be built), say so here.
    if (!terminal) send({ type: 'error', message: e instanceof Error && e.message ? e.message : 'The run stopped unexpectedly. Please run again.' })
  } finally {
    clearTimeout(watchdog)
    close()
  }
}
