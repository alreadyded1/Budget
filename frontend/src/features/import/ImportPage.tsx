import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiRequestError } from '../../api/client'
import {
  createProfile,
  discardImport,
  fetchImport,
  fetchImports,
  fetchProfiles,
  isOfx,
  stageImport,
  undoImport,
  commitImport,
  updateProfile,
} from '../../api/imports'
import type { ImportBatch, ImportProfile, ProfileFields } from '../../api/imports'
import { queryKeys } from '../../api/keys'
import { useToast } from '../../components/toastContext'
import { useReferenceData } from '../ledger/useLedgerData'
import { guessProfile } from './csvGuess'
import { MappingStep } from './MappingStep'
import { readStatement } from './readFile'
import type { LoadedFile } from './readFile'
import { ReviewStep } from './ReviewStep'

const FIELD =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-950'
const PRIMARY =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900'

/** Everything an import or an undo can change. */
const AFFECTED = [
  queryKeys.transactions,
  queryKeys.balances,
  queryKeys.budgets,
  queryKeys.dashboard,
  queryKeys.bills,
  queryKeys.subscriptions,
  queryKeys.payees,
  queryKeys.imports,
]

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) return error.detail
  if (error instanceof Error) return error.message
  return 'That did not work.'
}

function profileFields(profile: ImportProfile): ProfileFields {
  return {
    delimiter: profile.delimiter,
    has_header: profile.has_header,
    skip_rows: profile.skip_rows,
    date_column: profile.date_column,
    date_format: profile.date_format,
    amount_mode: profile.amount_mode,
    amount_column: profile.amount_column,
    debit_column: profile.debit_column,
    credit_column: profile.credit_column,
    invert_sign: profile.invert_sign,
    description_column: profile.description_column,
    memo_column: profile.memo_column,
  }
}

type Step =
  | { kind: 'choose' }
  | { kind: 'map'; profile: ImportProfile | null }
  | { kind: 'review'; batchId: number }

/** Import a bank statement: choose, map (CSV only), review, commit (SPEC §11). */
export function ImportPage() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const reference = useReferenceData()
  const openAccounts = reference.accounts.filter((account) => !account.is_closed)

  const [chosenAccount, setChosenAccount] = useState<number | null>(
    params.accountId ? Number(params.accountId) : null,
  )
  const accountId = chosenAccount ?? openAccounts[0]?.id ?? null
  const account = reference.accounts.find((item) => item.id === accountId)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<number | 'new' | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'choose' })

  const profiles = useQuery({
    queryKey: queryKeys.importProfiles,
    queryFn: ({ signal }) => fetchProfiles(signal),
  })
  const history = useQuery({
    queryKey: queryKeys.importHistory(accountId ?? 0),
    queryFn: ({ signal }) => fetchImports(accountId ?? 0, signal),
    enabled: accountId !== null,
  })
  const batch = useQuery({
    queryKey: queryKeys.importBatch(step.kind === 'review' ? step.batchId : 0),
    queryFn: ({ signal }) => fetchImport(step.kind === 'review' ? step.batchId : 0, signal),
    enabled: step.kind === 'review',
  })

  const csv = file !== null && !isOfx(file.name, file.text)
  const profileList = profiles.data?.items ?? []
  // A profile saved for this account first, then the only one there is.
  const suggested =
    profileList.find((profile) => profile.account_id === accountId) ??
    (profileList.length === 1 ? profileList[0] : undefined)
  const selectedProfile =
    profileId === 'new'
      ? null
      : (profileList.find((profile) => profile.id === profileId) ?? suggested ?? null)

  const stage = useMutation({
    mutationFn: (usingProfile: number | null) => {
      if (!file || accountId === null) throw new Error('Choose an account and a file.')
      return stageImport({
        account_id: accountId,
        filename: file.name,
        content: file.text,
        profile_id: usingProfile,
      })
    },
    onSuccess: (staged) => {
      queryClient.setQueryData(queryKeys.importBatch(staged.id), staged)
      void queryClient.invalidateQueries({ queryKey: queryKeys.importHistory(staged.account_id) })
      setStep({ kind: 'review', batchId: staged.id })
    },
    onError: (error) => toast(errorText(error)),
  })

  const saveProfile = useMutation({
    mutationFn: ({ name, fields }: { name: string; fields: ProfileFields }) => {
      const body = { ...fields, name, account_id: accountId }
      return step.kind === 'map' && step.profile
        ? updateProfile(step.profile.id, body)
        : createProfile(body)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.importProfiles })
      setProfileId(saved.id)
      stage.mutate(saved.id)
    },
    onError: (error) => toast(errorText(error)),
  })

  const refresh = () => {
    for (const key of AFFECTED) void queryClient.invalidateQueries({ queryKey: key })
  }

  const commit = useMutation({
    mutationFn: commitImport,
    onSuccess: ({ batch: done }) => {
      refresh()
      toast(
        `Imported ${done.imported_count} and matched ${done.matched_count}. Undo it from Import history.`,
        'success',
      )
      navigate(`/transactions/${done.account_id}`)
    },
    onError: (error) => toast(errorText(error)),
  })

  const discard = useMutation({
    mutationFn: discardImport,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports })
      setStep({ kind: 'choose' })
    },
    onError: (error) => toast(errorText(error)),
  })

  const undo = useMutation({
    mutationFn: (item: ImportBatch) => undoImport(item.id),
    onMutate: async (item) => {
      const key = queryKeys.importHistory(item.account_id)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<{ items: ImportBatch[] }>(key)
      if (previous) {
        queryClient.setQueryData(key, {
          items: previous.items.map((row) =>
            row.id === item.id ? { ...row, status: 'undone' as const } : row,
          ),
        })
      }
      return { previous, key }
    },
    onError: (error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast(errorText(error))
    },
    onSuccess: ({ batch: done }) => {
      refresh()
      toast(`Undid the import of ${done.filename}.`, 'success')
    },
  })

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    setFileError(null)
    setFile(null)
    if (!chosen) return
    try {
      setFile(await readStatement(chosen))
    } catch (error) {
      setFileError(errorText(error))
    }
  }

  function start() {
    if (!file || accountId === null) return
    if (!csv) stage.mutate(null)
    else if (selectedProfile) stage.mutate(selectedProfile.id)
    else setStep({ kind: 'map', profile: null })
  }

  if (reference.loading) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <section className="max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Import a statement</h1>
        {accountId !== null && (
          <Link
            to={`/transactions/${accountId}`}
            className="text-sm text-sky-700 underline dark:text-sky-300"
          >
            Back to the ledger
          </Link>
        )}
      </div>

      {step.kind === 'choose' && (
        <div className="mt-4 grid max-w-2xl gap-4" data-testid="choose-step">
          <label>
            <span className="block text-sm font-medium">Account</span>
            <select
              aria-label="Account"
              value={accountId ?? ''}
              onChange={(event) => {
                setChosenAccount(Number(event.target.value))
                setProfileId(null)
              }}
              className={FIELD}
            >
              {openAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-sm font-medium">Statement file</span>
            <input
              aria-label="Statement file"
              type="file"
              accept=".csv,.txt,.ofx,.qfx,text/csv"
              onChange={(event) => void handleFile(event)}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm dark:file:bg-slate-800"
            />
            <span className="mt-1 block text-xs text-slate-500">
              OFX, QFX or CSV from your bank's website, up to 5 MB. Nothing is saved until you
              review and commit.
            </span>
          </label>
          {fileError && (
            <p role="alert" className="text-sm text-rose-600">
              {fileError}
            </p>
          )}
          {file && csv && (
            <label>
              <span className="block text-sm font-medium">Bank format</span>
              <select
                aria-label="Bank format"
                value={profileId === 'new' ? 'new' : (selectedProfile?.id ?? 'new')}
                onChange={(event) =>
                  setProfileId(event.target.value === 'new' ? 'new' : Number(event.target.value))
                }
                className={FIELD}
              >
                {profileList.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
                <option value="new">New format…</option>
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={PRIMARY}
              disabled={!file || accountId === null || stage.isPending}
              onClick={start}
            >
              {stage.isPending ? 'Reading…' : 'Continue'}
            </button>
            {file && csv && selectedProfile && (
              <button
                type="button"
                onClick={() => setStep({ kind: 'map', profile: selectedProfile })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Edit columns
              </button>
            )}
          </div>
        </div>
      )}

      {step.kind === 'map' && file && (
        <div className="mt-4">
          <MappingStep
            file={file}
            initialName={step.profile?.name ?? ''}
            initial={step.profile ? profileFields(step.profile) : guessProfile(file.text)}
            editing={step.profile !== null}
            busy={saveProfile.isPending || stage.isPending}
            onSave={(name, fields) => saveProfile.mutate({ name, fields })}
            onBack={() => setStep({ kind: 'choose' })}
          />
        </div>
      )}

      {step.kind === 'review' && (
        <div className="mt-4">
          {batch.data ? (
            <ReviewStep
              batch={batch.data}
              account={reference.accounts.find((item) => item.id === batch.data.account_id)}
              accounts={reference.accounts}
              payees={reference.payees}
              categories={reference.categories}
              categoryNames={reference.categoryNames}
              busy={commit.isPending || discard.isPending}
              onCommit={() => commit.mutate(batch.data.id)}
              onDiscard={() => discard.mutate(batch.data.id)}
            />
          ) : (
            <p className="text-sm text-slate-500">Loading…</p>
          )}
        </div>
      )}

      {step.kind === 'choose' && account && (
        <div className="mt-10 max-w-3xl">
          <h2 className="text-sm font-semibold">Import history for {account.name}</h2>
          {history.data && history.data.items.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">No imports yet.</p>
          )}
          {history.data && history.data.items.length > 0 && (
            <table className="mt-2 w-full text-sm" data-testid="import-history">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="py-1 pr-2 font-medium">When</th>
                  <th className="py-1 pr-2 font-medium">File</th>
                  <th className="py-1 pr-2 font-medium">Result</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800/70">
                    <td className="py-1 pr-2 whitespace-nowrap text-slate-500">
                      {new Date(item.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1 pr-2">{item.filename}</td>
                    <td className="py-1 pr-2">
                      {item.status === 'staged' && (
                        <span className="text-amber-600">not committed</span>
                      )}
                      {item.status === 'committed' && (
                        <>
                          {item.imported_count} imported, {item.matched_count} matched
                        </>
                      )}
                      {item.status === 'undone' && <span className="text-slate-400">undone</span>}
                    </td>
                    <td className="py-1 text-right">
                      {item.status === 'staged' && (
                        <button
                          type="button"
                          onClick={() => setStep({ kind: 'review', batchId: item.id })}
                          className="rounded px-2 text-xs text-sky-700 underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300"
                        >
                          Review
                        </button>
                      )}
                      {item.status === 'committed' && (
                        <button
                          type="button"
                          disabled={undo.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Undo ${item.filename}? Its ${item.imported_count} new transactions are deleted and matched entries go back to how they were.`,
                              )
                            )
                              undo.mutate(item)
                          }}
                          className="rounded px-2 text-xs text-rose-600 underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
