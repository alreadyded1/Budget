import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'

import {
  ACCEPT,
  deleteAttachment,
  fetchAttachments,
  fileSize,
  fileUrl,
  uploadAttachment,
} from '../../api/attachments'
import type { Attachment } from '../../api/attachments'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { useToast } from '../../components/toastContext'

const DEFAULT_MAX = 10 * 1024 * 1024

type Props = {
  transactionId: number
  title: string
  onClose: () => void
  /** The transaction's new receipt count, for the ledger's paperclip. */
  onCount: (transactionId: number, count: number) => void
}

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'The upload failed.'
}

/** A transaction's receipts (SPEC §15): thumbnails, a preview, add by drop or picker, delete.
 *
 * Esc closes the preview, then the dialog. ← / → step through images in the preview.
 */
export function ReceiptsDialog({ transactionId, title, onClose, onCount }: Props) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = queryKeys.attachments(transactionId)
  const input = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [uploading, setUploading] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchAttachments(transactionId, signal),
  })
  const items = list.data?.items ?? []
  const images = items.filter((item) => item.mime_type.startsWith('image/'))
  const limit = list.data?.max_bytes ?? DEFAULT_MAX

  const remove = useMutation({
    mutationFn: (item: Attachment) => deleteAttachment(item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<{ items: Attachment[]; max_bytes: number }>(key)
      if (before) {
        queryClient.setQueryData(key, {
          ...before,
          items: before.items.filter((row) => row.id !== item.id),
        })
        onCount(transactionId, before.items.length - 1)
      }
      return { before }
    },
    onError: (error, _item, context) => {
      if (context?.before) {
        queryClient.setQueryData(key, context.before)
        onCount(transactionId, context.before.items.length)
      }
      toast(errorText(error))
    },
    onSuccess: (change) => onCount(change.transaction_id, change.attachment_count),
  })

  async function send(files: File[]) {
    for (const file of files) {
      if (file.size > limit) {
        toast(`${file.name} is over the ${Math.round(limit / (1024 * 1024))} MB limit.`)
        continue
      }
      setUploading((current) => [...current, file.name])
      try {
        const change = await uploadAttachment(transactionId, file)
        queryClient.setQueryData<{ items: Attachment[]; max_bytes: number }>(key, (current) =>
          current ? { ...current, items: [...current.items, change.attachment] } : current,
        )
        onCount(change.transaction_id, change.attachment_count)
      } catch (error) {
        toast(`${file.name}: ${errorText(error)}`)
      } finally {
        setUploading((current) => {
          const index = current.indexOf(file.name)
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
        })
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void send(Array.from(event.dataTransfer.files))
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (viewing !== null) setViewing(null)
      else onClose()
    } else if (viewing !== null && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      const index = images.findIndex((item) => item.id === viewing)
      const step = event.key === 'ArrowRight' ? 1 : -1
      const next = images[(index + step + images.length) % images.length]
      if (next) setViewing(next.id)
    }
  }

  const shown = images.find((item) => item.id === viewing)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Receipts for ${title}`}
        onKeyDown={onKeyDown}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`max-h-full w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900 ${dragging ? 'ring-4 ring-sky-400' : ''}`}
        data-testid="receipts-dialog"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Receipts · {title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {shown ? (
          <figure className="mt-3">
            <img
              src={fileUrl(shown.id, 'preview')}
              alt={shown.original_filename}
              className="mx-auto max-h-[70vh] rounded object-contain"
            />
            <figcaption className="mt-2 flex items-center justify-between text-sm text-slate-500">
              <span>{shown.original_filename}</span>
              <span className="flex gap-3">
                <a
                  href={fileUrl(shown.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 underline dark:text-sky-300"
                >
                  Original
                </a>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setViewing(null)}
                  className="text-sky-700 underline dark:text-sky-300"
                >
                  Back to all ({images.length > 1 ? '← → to step, ' : ''}Esc)
                </button>
              </span>
            </figcaption>
          </figure>
        ) : (
          <>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Receipts">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700"
                  data-testid="receipt"
                >
                  {item.mime_type.startsWith('image/') ? (
                    <button
                      type="button"
                      onClick={() => setViewing(item.id)}
                      className="block w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      aria-label={`View ${item.original_filename}`}
                    >
                      <img
                        src={fileUrl(item.id, 'thumbnail')}
                        alt=""
                        className="mx-auto h-28 w-full rounded object-contain"
                      />
                    </button>
                  ) : (
                    <a
                      href={fileUrl(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-28 items-center justify-center rounded bg-slate-100 text-2xl font-semibold text-slate-500 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-800"
                      aria-label={`Open ${item.original_filename}`}
                    >
                      PDF
                    </a>
                  )}
                  <div className="mt-1 truncate" title={item.original_filename}>
                    {item.original_filename}
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>{fileSize(item.size_bytes)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete ${item.original_filename}?`)) remove.mutate(item)
                      }}
                      className="rounded px-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                      aria-label={`Delete ${item.original_filename}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {uploading.map((name, index) => (
                <li
                  key={`${name}-${index}`}
                  className="flex h-40 items-center justify-center rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500 dark:border-slate-700"
                >
                  Uploading {name}…
                </li>
              ))}
            </ul>
            {list.isSuccess && items.length === 0 && uploading.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">No receipts yet.</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded border-2 border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
              <button
                type="button"
                autoFocus
                onClick={() => input.current?.click()}
                className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900"
              >
                Add files
              </button>
              <span>
                or drop them here. JPG, PNG, WEBP, HEIC or PDF, up to{' '}
                {Math.round(limit / (1024 * 1024))} MB each.
              </span>
              <input
                ref={input}
                type="file"
                multiple
                accept={ACCEPT}
                aria-label="Receipt files"
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void send(files)
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
