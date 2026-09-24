import type { MatchType } from '../../api/rules'

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  contains: 'contains',
  starts_with: 'starts with',
  equals: 'is exactly',
  regex: 'matches regex',
}
