// View-once photos and videos: prepared on the phone, then encrypted and kept only until opened or expired.
import type { MediaInfo } from './types'

/** Leaves headroom under the Free plan's 50 MB per-file limit for encryption overhead. */
export const MAX_MEDIA_BYTES = 45 * 1024 * 1024
/** Unopened photos and videos are deleted after this long. */
export const MEDIA_TTL_HOURS = 24
const MS_PER_HOUR = 60 * 60_000
const MAX_IMAGE_EDGE = 1600
const JPEG_QUALITY = 0.82

export const mediaPath = (spaceId: string, messageId: string) => `${spaceId}/${messageId}`

export function isExpired(createdAt: string, now = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > MEDIA_TTL_HOURS * MS_PER_HOUR
}

/** Size check for a file that's sent as-is. Exported for tests. */
export function checkSize(size: number, what: 'photo' | 'video') {
  if (size <= MAX_MEDIA_BYTES) return
  // One decimal under 10 MB ("4.5 MB"), whole megabytes above.
  const toMegabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)
  const sizeMb = toMegabytes(size)
  const limitMb = toMegabytes(MAX_MEDIA_BYTES)
  throw new Error(
    what === 'video'
      ? `That video is ${sizeMb} MB. Videos can be up to ${limitMb} MB, so trim it and try again.`
      : `That photo is ${sizeMb} MB, over the ${limitMb} MB limit.`,
  )
}

/** Fits width×height inside a square of `edge`, never scaling up. Exported for tests. */
export function fitWithin(width: number, height: number, edge = MAX_IMAGE_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function shrinkImage(file: File): Promise<{ bytes: ArrayBuffer; info: MediaInfo }> {
  // createImageBitmap applies the photo's EXIF rotation, so it comes out upright.
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error("Couldn't process that photo")
  return { bytes: await blob.arrayBuffer(), info: { kind: 'image', mime: 'image/jpeg', size: blob.size, width, height } }
}

/** The only types a photo or video is sent or opened as: never SVG or a page, which could carry code. */
export const PLAYABLE_TYPE = /^(image\/(?!svg)[\w.+-]+|video\/[\w.+-]+)$/i

/** Shrinks photos to a sensible size; checks videos against the size limit. */
export async function prepareMedia(file: File): Promise<{ bytes: ArrayBuffer; info: MediaInfo }> {
  if (!PLAYABLE_TYPE.test(file.type)) throw new Error('Only photos and videos can be sent.')
  if (file.type.startsWith('image/')) {
    try {
      return await shrinkImage(file)
    } catch {
      // A format the browser can't draw (some HEIC on desktop): send it as it is.
      checkSize(file.size, 'photo')
      return { bytes: await file.arrayBuffer(), info: { kind: 'image', mime: file.type, size: file.size } }
    }
  }
  checkSize(file.size, 'video')
  return { bytes: await file.arrayBuffer(), info: { kind: 'video', mime: file.type, size: file.size } }
}
