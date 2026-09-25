const LINK =
  'inline-block rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900'

/** Settings → Data (SPEC §17): every transaction as CSV, and the whole database as JSON. */
export function DataSettingsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold">All transactions (CSV)</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Every transaction on every account, oldest first, one line per split, for a spreadsheet.
          Amounts are plain numbers with spending negative.
        </p>
        <a href="/api/v1/export/transactions.csv" download className={`${LINK} mt-3`}>
          Download transactions.csv
        </a>
      </section>
      <section>
        <h2 className="text-sm font-semibold">Everything (JSON)</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          A complete snapshot of the household's data: accounts, transactions, plans, bills, goals,
          rules and settings. Passwords, sign-in sessions and the ntfy token are left out, and
          receipt files stay in the nightly backups. To restore, use a backup, not this file.
        </p>
        <a href="/api/v1/export/json" download className={`${LINK} mt-3`}>
          Download the JSON export
        </a>
      </section>
    </div>
  )
}
