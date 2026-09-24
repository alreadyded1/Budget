// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportBatchDetail, StagedRow } from '../../api/imports'
import { queryKeys } from '../../api/keys'
import type { Payee } from '../../api/payees'
import { ToastProvider } from '../../components/Toast'
import { guessProfile } from './csvGuess'
import { MappingStep } from './MappingStep'
import { ReviewStep } from './ReviewStep'
import { reviewSummary } from './review'

let calls: { method: string; url: string; body: unknown }[] = []

function respond(url: string, method: string, body: unknown): unknown {
  if (url === '/api/v1/imports/preview') {
    const profile = (body as { profile: { amount_mode: string } }).profile
    return {
      columns: ['Posting Date', 'Debit', 'Credit', 'Payee', 'Details'],
      rows:
        profile.amount_mode === 'debit_credit'
          ? [{ date: '2026-09-03', amount_cents: -8910, description: 'TARGET 00012', memo: '' }]
          : [],
      problems:
        profile.amount_mode === 'debit_credit' ? [] : [{ line: 3, reason: "unreadable amount ''" }],
    }
  }
  if (url.startsWith('/api/v1/imports/7/rows/') && method === 'PATCH') {
    const id = Number(url.split('/').pop())
    return { ...ROWS.find((row) => row.id === id), ...(body as object) }
  }
  return {}
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      return new Response(JSON.stringify(respond(url, method, body)))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function wrap(ui: React.ReactNode, client = new QueryClient()) {
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const TEXT = `Account Summary
Posting Date;Debit;Credit;Payee;Details
2026-09-03;89.10;;TARGET 00012;HOUSEHOLD
`

describe('MappingStep', () => {
  it('starts from the guess, previews through the server and saves the profile', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    wrap(
      <MappingStep
        file={{ name: 'bank.csv', size: TEXT.length, text: TEXT }}
        initialName=""
        initial={guessProfile(TEXT)}
        editing={false}
        busy={false}
        onSave={onSave}
        onBack={() => {}}
      />,
    )

    const preview = await screen.findByTestId('mapping-preview')
    await waitFor(() => expect(within(preview).getByText('TARGET 00012')).toBeTruthy())
    expect(within(preview).getByText('-$89.10')).toBeTruthy()
    expect((screen.getByLabelText('Money out column') as HTMLSelectElement).value).toBe('1')
    expect(screen.getByLabelText('Money out column').textContent).toContain('2. Debit')

    // Enter with no name asks for one instead of saving.
    await user.type(screen.getByLabelText('Bank format name'), '{Enter}')
    expect(screen.getByRole('alert').textContent).toMatch(/Name this bank format/)
    expect(onSave).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Bank format name'), 'Credit union{Enter}')
    expect(onSave).toHaveBeenCalledWith(
      'Credit union',
      expect.objectContaining({ delimiter: ';', skip_rows: 1, amount_mode: 'debit_credit' }),
    )
  })

  it('shows parse problems from the preview', async () => {
    const user = userEvent.setup()
    wrap(
      <MappingStep
        file={{ name: 'bank.csv', size: TEXT.length, text: TEXT }}
        initialName="x"
        initial={guessProfile(TEXT)}
        editing={false}
        busy={false}
        onSave={() => {}}
        onBack={() => {}}
      />,
    )
    await user.click(screen.getByLabelText('One column, spending negative'))
    expect((await screen.findByTestId('preview-problems')).textContent).toContain(
      "Line 3: unreadable amount ''",
    )
  })

  it('Esc goes back', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    wrap(
      <MappingStep
        file={{ name: 'bank.csv', size: TEXT.length, text: TEXT }}
        initialName=""
        initial={guessProfile(TEXT)}
        editing={false}
        busy={false}
        onSave={() => {}}
        onBack={onBack}
      />,
    )
    await user.type(screen.getByLabelText('Bank format name'), '{Escape}')
    expect(onBack).toHaveBeenCalled()
  })
})

function row(overrides: Partial<StagedRow>): StagedRow {
  return {
    id: 1,
    row_index: 0,
    date: '2026-09-02',
    amount_cents: -4520,
    raw_description: 'KROGER #0423',
    raw_memo: '',
    payee_id: null,
    new_payee_name: null,
    category_id: null,
    memo: null,
    disposition: 'import',
    is_duplicate: false,
    applied_rule_id: null,
    match: null,
    bill: null,
    link_bill: false,
    created_transaction_id: null,
    ...overrides,
  }
}

const ROWS: StagedRow[] = [
  row({ id: 1 }),
  row({
    id: 2,
    row_index: 1,
    raw_description: 'NETFLIX.COM',
    amount_cents: -1599,
    payee_id: 5,
    applied_rule_id: 3,
    bill: { occurrence_id: 9, name: 'Netflix', due_date: '2026-09-05' },
    link_bill: true,
  }),
  row({
    id: 3,
    row_index: 2,
    raw_description: 'SHELL',
    amount_cents: -3800,
    disposition: 'match',
    match: { transaction_id: 40, date: '2026-09-01', amount_cents: -3800, payee_id: 6, memo: null },
  }),
  row({ id: 4, row_index: 3, raw_description: 'OLD', is_duplicate: true, disposition: 'skip' }),
]

const PAYEES = [
  { id: 5, name: 'Netflix', is_hidden: false },
  { id: 6, name: 'Shell', is_hidden: false },
] as Payee[]

const BATCH: ImportBatchDetail = {
  id: 7,
  account_id: 1,
  filename: 'checking.ofx',
  format: 'ofx',
  profile_id: null,
  status: 'staged',
  row_count: 4,
  imported_count: 0,
  duplicate_count: 1,
  matched_count: 1,
  parse_errors: [],
  created_at: '2026-09-24T10:00:00Z',
  committed_at: null,
  undone_at: null,
  rows: ROWS,
}

function renderReview(onCommit = vi.fn()) {
  const client = new QueryClient()
  client.setQueryData(queryKeys.importBatch(7), BATCH)
  const utils = wrap(
    <ReviewStep
      batch={BATCH}
      account={undefined}
      accounts={[]}
      payees={PAYEES}
      categories={[{ id: 11, name: 'Groceries', groupName: 'Food' }]}
      categoryNames={new Map([[11, 'Groceries']])}
      busy={false}
      onCommit={onCommit}
      onDiscard={() => {}}
    />,
    client,
  )
  return { ...utils, client }
}

describe('ReviewStep', () => {
  it('shows duplicates, rules, matches and bills', () => {
    renderReview()
    const rows = screen.getAllByTestId('review-row')
    expect(within(rows[3]).getByText('already imported')).toBeTruthy()
    expect(within(rows[1]).getByText('rule')).toBeTruthy()
    expect((within(rows[1]).getByLabelText('Payee for row 2') as HTMLInputElement).value).toBe(
      'Netflix',
    )
    expect((within(rows[1]).getByLabelText('Mark Netflix paid') as HTMLInputElement).checked).toBe(
      true,
    )
    expect(within(rows[2]).getByTestId('match-note').textContent).toContain(
      'Marks your entry of 2026-09-01 to Shell as cleared',
    )
    expect(screen.getByTestId('review-summary').textContent).toContain(
      '2 new, 1 matched, 1 skipped',
    )
  })

  it('saves a payee pick, a new payee and a bill untick', async () => {
    const user = userEvent.setup()
    const { client } = renderReview()

    await user.type(screen.getByLabelText('Payee for row 1'), 'Kroger')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/v1/imports/7/rows/1')?.body).toEqual({
        new_payee_name: 'Kroger',
        payee_id: null,
      }),
    )
    expect(
      client.getQueryData<ImportBatchDetail>(queryKeys.importBatch(7))?.rows[0].new_payee_name,
    ).toBe('Kroger')

    await user.click(screen.getByLabelText('Mark Netflix paid'))
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/v1/imports/7/rows/2')?.body).toEqual({
        link_bill: false,
      }),
    )
  })

  it('skipping a row sends the disposition', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.selectOptions(screen.getByLabelText('Action for row 1'), 'skip')
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ disposition: 'skip' }),
    )
  })

  it('opens a rule form prefilled from the row', async () => {
    const user = userEvent.setup()
    renderReview()
    const rows = screen.getAllByTestId('review-row')
    await user.click(within(rows[1]).getByText('Create rule from this'))
    const form = screen.getByTestId('rule-form')
    expect((within(form).getByLabelText('Match text') as HTMLInputElement).value).toBe(
      'NETFLIX.COM',
    )
    expect((within(form).getByLabelText('Rule payee') as HTMLInputElement).value).toBe('Netflix')
  })

  it('commits from the button', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    renderReview(onCommit)
    await user.click(screen.getByText('Commit import'))
    expect(onCommit).toHaveBeenCalled()
  })
})

describe('reviewSummary', () => {
  it('nets only the rows that become new transactions', () => {
    expect(reviewSummary(ROWS)).toEqual({ imported: 2, matched: 1, skipped: 1, netCents: -6119 })
  })
})
