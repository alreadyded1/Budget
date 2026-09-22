import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-sky-600 hover:underline">
        Back to the dashboard
      </Link>
    </section>
  )
}
