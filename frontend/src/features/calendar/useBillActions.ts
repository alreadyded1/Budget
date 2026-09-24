import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { reopenBill, skipBill } from '../../api/subscriptions'
import type { Bill } from '../../api/subscriptions'
import { useToast } from '../../components/toastContext'

/** Where "Mark paid" goes: the paying account's ledger with the entry row prefilled. */
export function markPaidPath(bill: Bill): string {
  const base = bill.account_id === null ? '/transactions' : `/transactions/${bill.account_id}`
  return `${base}?bill=${bill.occurrence_id}`
}

/** Skip, reopen and Mark paid, shared by the calendar and the dashboard. */
export function useBillActions() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const refresh = () => {
    for (const key of [
      queryKeys.bills,
      queryKeys.subscriptions,
      queryKeys.budgets,
      queryKeys.dashboard,
    ]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const change = useMutation({
    mutationFn: ({ bill, to }: { bill: Bill; to: 'skip' | 'reopen' }) =>
      to === 'skip' ? skipBill(bill.occurrence_id) : reopenBill(bill.occurrence_id),
    onMutate: async ({ bill, to }) => {
      // Optimistic: every cached bill list shows the new status at once.
      await queryClient.cancelQueries({ queryKey: queryKeys.bills })
      const snapshots = queryClient.getQueriesData<{ items: Bill[] }>({ queryKey: queryKeys.bills })
      const status = to === 'skip' ? 'skipped' : 'upcoming'
      for (const [key, data] of snapshots) {
        if (!data?.items) continue
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((row) =>
            row.occurrence_id === bill.occurrence_id
              ? { ...row, status, overdue: false, transaction_id: null }
              : row,
          ),
        })
      }
      return { snapshots }
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data)
      toast(error instanceof ApiRequestError ? error.detail : 'That did not save.')
    },
    onSuccess: (_bill, { bill, to }) => {
      toast(
        to === 'skip'
          ? `Skipped ${bill.name} due ${bill.due_date}.`
          : `${bill.name} is upcoming again.`,
        'success',
      )
    },
    onSettled: refresh,
  })

  return {
    markPaid: (bill: Bill) => navigate(markPaidPath(bill)),
    skip: (bill: Bill) => change.mutate({ bill, to: 'skip' }),
    reopen: (bill: Bill) => change.mutate({ bill, to: 'reopen' }),
    busy: change.isPending,
  }
}
