// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Attachment } from '../../api/attachments'
import { ToastProvider } from '../../components/Toast'
import { ReceiptsDialog } from './ReceiptsDialog'

function attachment(id: number, name: string, mime: string): Attachment {
  return {
    id,
    transaction_id: 7,
    original_filename: name,
    mime_type: mime,
    size_bytes: 150_000,
    sha256: 'x',
    has_thumbnail: mime.startsWith('image/'),
    has_preview: false,
    created_at: '2026-09-24T10:00:00Z',
  }
}

let calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = []
let uploadResponse: () => Response

beforeEach(() => {
  calls = []
  uploadResponse = () =>
    new Response(
      JSON.stringify({
        attachment: attachment(3, 'new.jpg', 'image/jpeg'),
        transaction_id: 7,
        attachment_count: 3,
      }),
      { status: 201 },
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({
        method,
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body,
      })
      if (method === 'POST') return uploadResponse()
      if (method === 'DELETE')
        return new Response(
          JSON.stringify({
            attachment: attachment(1, 'a.jpg', 'image/jpeg'),
            transaction_id: 7,
            attachment_count: 1,
          }),
        )
      return new Response(
        JSON.stringify({
          items: [
            attachment(1, 'a.jpg', 'image/jpeg'),
            attachment(2, 'bill.pdf', 'application/pdf'),
          ],
          max_bytes: 1024 * 1024,
        }),
      )
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog(onClose = vi.fn(), onCount = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ReceiptsDialog transactionId={7} title="Kroger" onClose={onClose} onCount={onCount} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onClose, onCount }
}

describe('ReceiptsDialog', () => {
  it('shows thumbnails and opens a PDF in its own tab', async () => {
    renderDialog()
    const receipts = await screen.findAllByTestId('receipt')
    expect(receipts).toHaveLength(2)
    expect(receipts[0].querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/attachments/1/thumbnail',
    )
    expect(
      within(receipts[1]).getByRole('link', { name: 'Open bill.pdf' }).getAttribute('href'),
    ).toBe('/api/v1/attachments/2')
  })

  it('uploads the raw file with its name and reports the new count', async () => {
    const user = userEvent.setup()
    const { onCount } = renderDialog()
    await screen.findAllByTestId('receipt')
    const file = new File(['jpeg-bytes'], 'café receipt.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Receipt files'), file)
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(7, 3))
    const post = calls.find((call) => call.method === 'POST')
    expect(post?.url).toBe('/api/v1/transactions/7/attachments')
    expect(post?.headers['X-Filename']).toBe('caf%C3%A9%20receipt.jpg')
    expect(post?.headers['X-PB-Request']).toBe('1')
    expect(post?.body).toBe(file)
    expect(await screen.findByText('new.jpg')).toBeTruthy()
  })

  it('checks the size before sending and explains a proxy 413', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findAllByTestId('receipt')
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Receipt files'), big)
    expect(await screen.findByText(/huge\.jpg is over the 1 MB limit/)).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    uploadResponse = () =>
      new Response('<html>413 Request Entity Too Large</html>', { status: 413 })
    await user.upload(
      screen.getByLabelText('Receipt files'),
      new File(['x'], 'small.jpg', { type: 'image/jpeg' }),
    )
    expect(await screen.findByText(/client_max_body_size in NPM/)).toBeTruthy()
  })

  it('deletes after confirming and Esc steps out of the preview, then closes', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onClose, onCount } = renderDialog()
    await screen.findAllByTestId('receipt')
    await user.click(screen.getByRole('button', { name: 'Delete bill.pdf' }))
    await waitFor(() => expect(screen.getAllByTestId('receipt')).toHaveLength(1))
    expect(onCount).toHaveBeenCalledWith(7, 1)

    await user.click(screen.getByRole('button', { name: 'View a.jpg' }))
    expect(screen.getByRole('img', { name: 'a.jpg' }).getAttribute('src')).toBe(
      '/api/v1/attachments/1/preview',
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('receipt')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
