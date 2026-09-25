import { ApiRequestError, apiFetch } from './client'

/** Receipt attachments (SPEC §15). The file itself is the upload's body (D-099). */

export type Attachment = {
  id: number
  transaction_id: number
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  has_thumbnail: boolean
  has_preview: boolean
  created_at: string
}

export type AttachmentChange = {
  attachment: Attachment
  transaction_id: number
  attachment_count: number
}

/** The file types the server accepts; the picker offers these. */
export const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf'

/** What a 413 from NGINX Proxy Manager (an HTML page, not our JSON) means (D-102). */
export const PROXY_TOO_LARGE =
  'That file is too large for the server (check client_max_body_size in NPM).'

export function fileUrl(id: number, variant: '' | 'thumbnail' | 'preview' = ''): string {
  return `/api/v1/attachments/${id}${variant ? `/${variant}` : ''}`
}

export function fetchAttachments(
  transactionId: number,
  signal?: AbortSignal,
): Promise<{ items: Attachment[]; max_bytes: number }> {
  return apiFetch(`/transactions/${transactionId}/attachments`, { signal })
}

export async function uploadAttachment(
  transactionId: number,
  file: File,
): Promise<AttachmentChange> {
  const response = await fetch(`/api/v1/transactions/${transactionId}/attachments`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-PB-Request': '1',
      'X-Filename': encodeURIComponent(file.name),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string
      code?: string
    } | null
    if (payload?.detail) {
      throw new ApiRequestError(response.status, payload.code ?? 'error', payload.detail)
    }
    if (response.status === 413) throw new ApiRequestError(413, 'file_too_large', PROXY_TOO_LARGE)
    throw new ApiRequestError(response.status, 'error', response.statusText || 'The upload failed.')
  }
  return (await response.json()) as AttachmentChange
}

export function deleteAttachment(id: number): Promise<AttachmentChange> {
  return apiFetch(`/attachments/${id}`, { method: 'DELETE' })
}

/** 1536000 → "1.5 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
