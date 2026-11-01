import sharp from 'sharp'
import { createRouterFromEnv } from '../../src/lib/meta/providers.js'
import { verifyRescue, type Decision } from '../../src/lib/meta/rescue.js'

// One yes or no style vision question about a photo sent as a data URL, through the same provider route the photo check uses.

/** The photo as a small JPEG data URL for a model, or null when it cannot be read. */
export async function photoForModel(photo: string): Promise<string | null> {
  try {
    const bytes = Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64')
    const small = await sharp(bytes).resize({ width: 1024, height: 1024, fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
    return `data:image/jpeg;base64,${small.toString('base64')}`
  } catch {
    return null
  }
}

export async function askAboutPhoto(photo: string, prompt: string, system: string): Promise<string> {
  const forModel = await photoForModel(photo)
  if (!forModel) throw new Error('unreadable photo')
  const router = createRouterFromEnv(process.env)
  const { text } = await router.run({ step: 'fidelity', input: prompt, instructions: system, images: [forModel], temperature: 0, expectJson: true })
  return text
}

/** The server's own check before a rescue: refuses a photo with a person, a brand or a watermark, and one it cannot check. */
export function verifyRescuePhoto(photo: string): Promise<Decision> {
  return verifyRescue((prompt, system) => askAboutPhoto(photo, prompt, system))
}
