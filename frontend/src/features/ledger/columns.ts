/** One grid for the header, the entry row, and every ledger row, so columns line up. */

export function gridTemplate(showAccount: boolean): string {
  const columns = [
    '7.5rem', // date
    'minmax(9rem, 1.4fr)', // payee
    'minmax(9rem, 1.3fr)', // category
    'minmax(6rem, 1fr)', // memo
    '6.5rem', // outflow
    '6.5rem', // inflow
    '2.5rem', // cleared
    '7.5rem', // balance
  ]
  return (showAccount ? ['8rem', ...columns] : columns).join(' ')
}

export const INPUT_CLASS =
  'h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-sm outline-none ' +
  'focus:border-sky-500 focus:ring-1 focus:ring-sky-500 aria-[invalid=true]:border-rose-500 ' +
  'dark:border-slate-700 dark:bg-slate-950'
