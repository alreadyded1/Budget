import type { StagedRow } from '../../api/imports'

/** Totals the Commit button describes; skipped and matched rows add nothing new. */
export function reviewSummary(rows: StagedRow[]) {
  const imported = rows.filter((row) => row.disposition === 'import')
  return {
    imported: imported.length,
    matched: rows.filter((row) => row.disposition === 'match').length,
    skipped: rows.filter((row) => row.disposition === 'skip').length,
    netCents: imported.reduce((sum, row) => sum + row.amount_cents, 0),
  }
}
