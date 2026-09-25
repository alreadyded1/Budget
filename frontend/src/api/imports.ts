import { apiFetch } from './client'
import type { Balance } from './transactions'

/** Bank imports, CSV profiles and rules (SPEC §11). Amounts are integer cents. */

export const DATE_FORMATS = [
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY-MM-DD',
  'MM/DD/YY',
  'DD/MM/YY',
  'DD.MM.YYYY',
  'YYYYMMDD',
  'MM-DD-YYYY',
] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export type ProfileFields = {
  delimiter: string
  has_header: boolean
  skip_rows: number
  date_column: number
  date_format: DateFormat
  amount_mode: 'single' | 'debit_credit'
  amount_column: number | null
  debit_column: number | null
  credit_column: number | null
  invert_sign: boolean
  description_column: number
  memo_column: number | null
}

export type ImportProfile = ProfileFields & {
  id: number
  name: string
  account_id: number | null
}

export type ProfileInput = ProfileFields & { name: string; account_id: number | null }

export type PreviewRow = { date: string; amount_cents: number; description: string; memo: string }
export type Problem = { line: number; reason: string }
export type Preview = { columns: string[]; rows: PreviewRow[]; problems: Problem[] }

export type Disposition = 'import' | 'skip' | 'match'

export type StagedRow = {
  id: number
  row_index: number
  date: string
  amount_cents: number
  raw_description: string
  raw_memo: string
  payee_id: number | null
  new_payee_name: string | null
  category_id: number | null
  memo: string | null
  disposition: Disposition
  is_duplicate: boolean
  applied_rule_id: number | null
  match: {
    transaction_id: number
    date: string
    amount_cents: number
    payee_id: number | null
    memo: string | null
  } | null
  bill: { occurrence_id: number; name: string; due_date: string } | null
  link_bill: boolean
  created_transaction_id: number | null
}

export type RowPatch = Partial<
  Pick<
    StagedRow,
    'payee_id' | 'new_payee_name' | 'category_id' | 'memo' | 'disposition' | 'link_bill'
  >
>

export type ImportBatch = {
  id: number
  account_id: number
  filename: string
  format: 'csv' | 'ofx' | 'qfx'
  profile_id: number | null
  status: 'staged' | 'committed' | 'undone'
  row_count: number
  imported_count: number
  duplicate_count: number
  matched_count: number
  parse_errors: string[]
  created_at: string
  committed_at: string | null
  undone_at: string | null
}

export type ImportBatchDetail = ImportBatch & { rows: StagedRow[] }
export type BatchResult = { batch: ImportBatch; balances: Balance[] }

export const DEFAULT_PROFILE: ProfileFields = {
  delimiter: ',',
  has_header: true,
  skip_rows: 0,
  date_column: 0,
  date_format: 'MM/DD/YYYY',
  amount_mode: 'single',
  amount_column: 2,
  debit_column: null,
  credit_column: null,
  invert_sign: false,
  description_column: 1,
  memo_column: null,
}

/** Largest file the server takes (D-078). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

export function isOfx(filename: string, text: string): boolean {
  return /\.(ofx|qfx)$/i.test(filename) || /<OFX>|OFXHEADER/i.test(text.slice(0, 4096))
}

export function fetchProfiles(signal?: AbortSignal): Promise<{ items: ImportProfile[] }> {
  return apiFetch('/import-profiles', { signal })
}

export function createProfile(body: ProfileInput): Promise<ImportProfile> {
  return apiFetch('/import-profiles', { method: 'POST', body })
}

export function updateProfile(id: number, body: ProfileInput): Promise<ImportProfile> {
  return apiFetch(`/import-profiles/${id}`, { method: 'PUT', body })
}

export function deleteProfile(id: number): Promise<void> {
  return apiFetch(`/import-profiles/${id}`, { method: 'DELETE' })
}

export function previewCsv(
  content: string,
  profile: ProfileFields,
  signal?: AbortSignal,
): Promise<Preview> {
  return apiFetch('/imports/preview', { method: 'POST', body: { content, profile }, signal })
}

export function stageImport(body: {
  account_id: number
  filename: string
  content: string
  profile_id: number | null
}): Promise<ImportBatchDetail> {
  return apiFetch('/imports', { method: 'POST', body })
}

export function fetchImports(
  accountId: number,
  signal?: AbortSignal,
): Promise<{ items: ImportBatch[] }> {
  return apiFetch(`/imports?account_id=${accountId}`, { signal })
}

export function fetchImport(id: number, signal?: AbortSignal): Promise<ImportBatchDetail> {
  return apiFetch(`/imports/${id}`, { signal })
}

export function patchRow(batchId: number, rowId: number, body: RowPatch): Promise<StagedRow> {
  return apiFetch(`/imports/${batchId}/rows/${rowId}`, { method: 'PATCH', body })
}

export function commitImport(id: number): Promise<BatchResult> {
  return apiFetch(`/imports/${id}/commit`, { method: 'POST' })
}

export function undoImport(id: number): Promise<BatchResult> {
  return apiFetch(`/imports/${id}/undo`, { method: 'POST' })
}

export function discardImport(id: number): Promise<void> {
  return apiFetch(`/imports/${id}`, { method: 'DELETE' })
}

export function applyRules(id: number): Promise<ImportBatchDetail> {
  return apiFetch(`/imports/${id}/apply-rules`, { method: 'POST' })
}
