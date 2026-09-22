import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { logout } from '../../api/auth'
import { queryKeys } from '../../api/keys'
import { useToast } from '../../components/toastContext'
import { useSession } from './useSession'

export function UserMenu() {
  const { data: user } = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.session, null)
      queryClient.clear()
      navigate('/login', { replace: true })
    },
    onError: () => toast('Could not sign out. Try again.'),
  })

  if (!user) return null

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-sm text-slate-600 dark:text-slate-300" title={user.username}>
        {user.display_name}
      </span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        Sign out
      </button>
    </div>
  )
}
