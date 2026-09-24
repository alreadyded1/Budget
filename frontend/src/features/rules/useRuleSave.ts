import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiRequestError } from '../../api/client'
import { queryKeys } from '../../api/keys'
import { createPayee } from '../../api/payees'
import { createRule, updateRule } from '../../api/rules'
import type { Rule } from '../../api/rules'
import { useToast } from '../../components/toastContext'
import type { RuleDraft } from './RuleForm'

/** Save a rule from the form, creating a newly typed payee first. */
export function useRuleSave(onSaved: (rule: Rule) => void) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async ({ id, draft }: { id: number | null; draft: RuleDraft }) => {
      let rule = draft.rule
      if (draft.newPayeeName) {
        const payee = await createPayee({ name: draft.newPayeeName })
        void queryClient.invalidateQueries({ queryKey: queryKeys.payees })
        rule = { ...rule, set_payee_id: payee.id }
      }
      return id === null ? createRule(rule) : updateRule(id, rule)
    },
    onSuccess: (rule) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rules })
      onSaved(rule)
    },
    onError: (error) =>
      toast(error instanceof ApiRequestError ? error.detail : 'The rule was not saved.'),
  })
}
