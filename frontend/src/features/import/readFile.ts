import { MAX_FILE_BYTES } from '../../api/imports'

export type LoadedFile = { name: string; size: number; text: string }

/** Bytes to text the way the server's decode() does: UTF-8, else Windows-1252. */
export function decodeBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Read a chosen statement file in the browser; the text travels as JSON (D-078). */
export async function readStatement(file: File): Promise<LoadedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('That file is over 5 MB. Export a shorter date range.')
  }
  const text = decodeBytes(await file.arrayBuffer())
  if (!text.trim()) throw new Error('That file is empty.')
  return { name: file.name, size: file.size, text }
}
