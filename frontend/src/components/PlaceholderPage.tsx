type Props = {
  title: string
  phase: string
}

/** Every route exists from Phase 0 so navigation and deep links can be verified early. */
export function PlaceholderPage({ title, phase }: Props) {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Arrives in {phase}.</p>
    </section>
  )
}
