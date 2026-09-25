import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { seedStarterCategories } from '../../api/categories'
import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { useToast } from '../../components/toastContext'
import { AccountsPage } from '../accounts/AccountsPage'
import { PayScheduleSettingsPage } from '../settings/PayScheduleSettingsPage'
import { skipSetup, useSetupStatus } from './useSetup'

const STEPS = ['Pay schedule', 'Accounts', 'Categories'] as const

const PRIMARY =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900'
const SECONDARY =
  'rounded px-3 py-1.5 text-sm text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800'

/** First-run setup (SPEC §17, D-106): pay schedule → accounts → categories. */
export function SetupPage() {
  const status = useSetupStatus()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(() => (status.hasSchedule ? (status.hasAccounts ? 2 : 1) : 0))

  const seed = useMutation({
    mutationFn: seedStarterCategories,
    onSuccess: (groups) => {
      queryClient.setQueryData(queryKeys.categoryGroups, groups)
      toast('Starter categories added.', 'success')
    },
    onError: (error) =>
      toast(error instanceof ApiRequestError ? error.detail : 'Could not add the categories.'),
  })

  function finish() {
    skipSetup(false)
    navigate('/', { replace: true })
  }

  function later() {
    skipSetup(true)
    navigate('/', { replace: true })
  }

  const canNext = step === 0 ? status.hasSchedule : step === 1 ? status.hasAccounts : true

  return (
    <section className="max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Set up Payday Budget</h1>
        <button type="button" onClick={later} className={SECONDARY}>
          Skip for now
        </button>
      </div>
      <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Setup steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              className={`rounded-full px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                index === step
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {index + 1}. {label}
              {(index === 0 && status.hasSchedule) || (index === 1 && status.hasAccounts)
                ? ' ✓'
                : ''}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6" data-testid={`setup-step-${step}`}>
        {step === 0 && (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              When do you get paid? Every budget in this app runs from one payday to the next.
            </p>
            <PayScheduleSettingsPage />
          </>
        )}
        {step === 1 && (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              Add the accounts you use day to day: checking, savings, credit cards. Loans and
              investments can come later.
            </p>
            <AccountsPage />
          </>
        )}
        {step === 2 && (
          <div className="max-w-xl">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {status.categoryCount > 0
                ? `You have ${status.categoryCount} categories. You can rename, add or hide them any time.`
                : 'Categories are what you budget for: groceries, rent, fuel. Start with a common set and adjust it, or make your own.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {status.categoryCount === 0 && (
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={seed.isPending}
                  onClick={() => seed.mutate()}
                >
                  Use the starter categories
                </button>
              )}
              <Link to="/settings/categories" className={SECONDARY}>
                Edit categories
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        {step > 0 && (
          <button type="button" className={SECONDARY} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className={PRIMARY}
            disabled={!canNext}
            title={canNext ? undefined : 'Save this step first'}
            onClick={() => setStep(step + 1)}
          >
            Next
          </button>
        ) : (
          <button type="button" className={PRIMARY} onClick={finish}>
            Finish
          </button>
        )}
      </div>
    </section>
  )
}
