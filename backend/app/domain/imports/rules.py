"""Import rules (SPEC §11): an ordered list, and the first matching rule wins (D-074)."""

import re
from dataclasses import dataclass

MATCH_FIELDS = ("description", "memo")
MATCH_TYPES = ("contains", "starts_with", "equals", "regex")


@dataclass(frozen=True, slots=True)
class RuleSpec:
    id: int
    match_field: str
    match_type: str
    match_value: str
    amount_min_cents: int | None = None
    amount_max_cents: int | None = None
    account_id: int | None = None
    is_active: bool = True


def rule_problem(rule: RuleSpec) -> str | None:
    if rule.match_field not in MATCH_FIELDS:
        return "Match on the description or the memo."
    if rule.match_type not in MATCH_TYPES:
        return "Match with contains, starts with, equals or a regex."
    if not rule.match_value.strip():
        return "Give the text to match."
    if rule.match_type == "regex":
        try:
            re.compile(rule.match_value)
        except re.error as exc:
            return f"That regex does not compile: {exc}."
    if (
        rule.amount_min_cents is not None
        and rule.amount_max_cents is not None
        and rule.amount_min_cents > rule.amount_max_cents
    ):
        return "The minimum amount is above the maximum."
    return None


def matches(
    rule: RuleSpec, *, description: str, memo: str, amount_cents: int, account_id: int
) -> bool:
    """Text matching ignores case and surrounding spaces; regexes are searched, case-insensitive."""
    if not rule.is_active:
        return False
    if rule.account_id is not None and rule.account_id != account_id:
        return False
    if rule.amount_min_cents is not None and amount_cents < rule.amount_min_cents:
        return False
    if rule.amount_max_cents is not None and amount_cents > rule.amount_max_cents:
        return False
    text = (description if rule.match_field == "description" else memo).strip()
    value = rule.match_value.strip()
    if rule.match_type == "regex":
        try:
            return re.search(value, text, re.I) is not None
        except re.error:
            return False
    text, value = text.lower(), value.lower()
    if rule.match_type == "contains":
        return value in text
    if rule.match_type == "starts_with":
        return text.startswith(value)
    return text == value


def first_match(
    rules: list[RuleSpec], *, description: str, memo: str, amount_cents: int, account_id: int
) -> RuleSpec | None:
    """`rules` must already be in priority order."""
    for rule in rules:
        if matches(
            rule,
            description=description,
            memo=memo,
            amount_cents=amount_cents,
            account_id=account_id,
        ):
            return rule
    return None
