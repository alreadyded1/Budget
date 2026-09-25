import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        That address is not part of Payday Budget. It may be an old bookmark.
      </p>
      <Link to="/" className="mt-3 inline-block text-sm text-sky-700 underline dark:text-sky-300">
        Back to the dashboard
      </Link>
    </section>
  )
}
