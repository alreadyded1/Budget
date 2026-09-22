import { createContext, useContext } from 'react'

export type ToastTone = 'error' | 'success'
export type ShowToast = (message: string, tone?: ToastTone) => void

export const ToastContext = createContext<ShowToast | null>(null)

export function useToast(): ShowToast {
  const context = useContext(ToastContext)
  if (context === null) {
    throw new Error('useToast must be used inside a ToastProvider')
  }
  return context
}
