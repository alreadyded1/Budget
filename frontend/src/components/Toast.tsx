import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ToastContext } from './toastContext'
import type { ToastAction, ToastOptions, ToastTone } from './toastContext'

type Toast = { id: number; message: string; tone: ToastTone; action?: ToastAction }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'error', options: ToastOptions = {}) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, message, tone, action: options.action }])
      window.setTimeout(() => dismiss(id), options.durationMs ?? 5000)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              'pointer-events-auto rounded border px-3 py-2 text-sm shadow-lg',
              toast.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="shrink-0 rounded px-2 py-0.5 font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  onClick={() => {
                    toast.action?.onClick()
                    dismiss(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
