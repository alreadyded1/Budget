import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import type { Account } from '../../api/accounts'
import type { Payee } from '../../api/payees'
import type { LedgerRow } from '../../api/transactions'
import { formatCents } from '../../lib/money'
import { gridTemplate } from './columns'
import { TRANSFER_PREFIX } from './draft'

type Props = {
  rows: LedgerRow[]
  showAccount: boolean
  accounts: Account[]
  payees: Payee[]
  categoryNames: Map<number, string>
  selectedId: number | null
  editingId: number | null
  renderEditor: () => ReactNode
  onSelect: (id: number) => void
  onOpen: (id: number) => void
  onToggleCleared: (id: number) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  header: ReactNode
}

const ROW_HEIGHT = 34

/** The ledger rows, virtualized so thousands scroll smoothly (SPEC §7).
 *
 * The header and the pinned entry row sit above the scroll area and never move.
 */
export function LedgerTable({
  rows,
  showAccount,
  accounts,
  payees,
  categoryNames,
  selectedId,
  editingId,
  renderEditor,
  onSelect,
  onOpen,
  onToggleCleared,
  hasMore,
  loadingMore,
  onLoadMore,
  header,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const count = rows.length + (hasMore ? 1 : 0)

  // The virtualizer hands back fresh functions each render; this component is not memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]?.transaction.id ?? 'more',
  })

  const items = virtualizer.getVirtualItems()
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= rows.length - 20) onLoadMore()
  }, [hasMore, loadingMore, lastIndex, rows.length, onLoadMore])

  // Keep the selected row on screen as j/k walk the ledger.
  useEffect(() => {
    if (selectedId === null) return
    const index = rows.findIndex((row) => row.transaction.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [selectedId, rows, virtualizer])

  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? '—'
  const payeeName = (id: number | null) =>
    id === null ? '' : (payees.find((payee) => payee.id === id)?.name ?? '')
  const template = gridTemplate(showAccount)

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div
        className="grid gap-1.5 border-b border-slate-200 px-2 py-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase dark:border-slate-800"
        style={{ gridTemplateColumns: template }}
        role="row"
      >
        {showAccount && <div>Account</div>}
        <div>Date</div>
        <div>Payee</div>
        <div>Category</div>
        <div>Memo</div>
        <div className="text-right">Outflow</div>
        <div className="text-right">Inflow</div>
        <div className="text-center" title="Cleared">
          C
        </div>
        <div className="text-right">Balance</div>
      </div>
      {header}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-testid="ledger-rows">
        {rows.length === 0 && !hasMore && (
          <p className="p-6 text-center text-sm text-slate-500">
            No transactions yet. Type one into the row above and press Enter.
          </p>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const row = rows[item.index]
            const style = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
            }
            if (row === undefined) {
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={style}
                >
                  <p className="p-2 text-center text-xs text-slate-400">Loading more…</p>
                </div>
              )
            }
            const tx = row.transaction
            if (tx.id === editingId) {
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={style}
                >
                  {renderEditor()}
                </div>
              )
            }
            const selected = tx.id === selectedId
            const pending = tx.id < 0
            const partner = accounts.find((account) => account.id === tx.transfer_account_id)
            const payee = partner
              ? `${TRANSFER_PREFIX}${partner.name}`
              : (tx.pending_payee_name ?? payeeName(tx.payee_id))
            let category: ReactNode
            if (tx.splits.length > 1) category = `Split (${tx.splits.length})`
            else if (tx.splits.length === 1 && tx.splits[0].category_id !== null)
              category = categoryNames.get(tx.splits[0].category_id) ?? '—'
            else if (tx.transfer_id !== null) category = ''
            else category = <span className="text-amber-600">Uncategorized</span>

            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={style}
              >
                <div
                  role="row"
                  aria-selected={selected}
                  data-testid="ledger-row"
                  data-id={tx.id}
                  onClick={() => onSelect(tx.id)}
                  onDoubleClick={() => onOpen(tx.id)}
                  className={[
                    'grid cursor-default items-center gap-1.5 border-b border-slate-100 px-2 text-sm dark:border-slate-800/70',
                    selected
                      ? 'bg-sky-100 dark:bg-sky-900/50'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    pending ? 'opacity-60' : '',
                  ].join(' ')}
                  style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
                >
                  {showAccount && (
                    <div className="truncate text-slate-500">{accountName(tx.account_id)}</div>
                  )}
                  <div className="tabular-nums">{tx.date}</div>
                  <div className="truncate">{payee}</div>
                  <div className="truncate">{category}</div>
                  <div className="truncate text-slate-500">{tx.memo}</div>
                  <div className="text-right tabular-nums">
                    {tx.amount_cents < 0 ? formatCents(-tx.amount_cents) : ''}
                  </div>
                  <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                    {tx.amount_cents > 0 ? formatCents(tx.amount_cents) : ''}
                  </div>
                  <div className="text-center">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Status: ${tx.status}`}
                      title={tx.status}
                      disabled={pending || tx.status === 'reconciled'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleCleared(tx.id)
                      }}
                      className={[
                        'h-5 w-5 rounded-full text-[10px] font-bold',
                        tx.status === 'uncleared'
                          ? 'border border-slate-300 text-slate-300 dark:border-slate-600'
                          : tx.status === 'cleared'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-500 text-white',
                      ].join(' ')}
                    >
                      {tx.status === 'reconciled' ? 'R' : 'C'}
                    </button>
                  </div>
                  <div
                    className={`text-right tabular-nums ${
                      (row.running_balance_cents ?? 0) < 0 ? 'text-rose-600' : ''
                    }`}
                  >
                    {row.running_balance_cents === null
                      ? ''
                      : formatCents(row.running_balance_cents)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
