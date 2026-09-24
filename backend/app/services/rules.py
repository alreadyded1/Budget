"""Import rules: CRUD, ordering, and testing a rule against past imports (SPEC §11)."""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.domain import ordering
from app.domain.imports import rules as rule_math
from app.errors import AppError
from app.models import ImportBatch, ImportStagedRow, Rule
from app.services import accounts as accounts_service
from app.services import categories as categories_service
from app.services import payees as payees_service

EDITABLE = {
    "name",
    "is_active",
    "match_field",
    "match_type",
    "match_value",
    "amount_min_cents",
    "amount_max_cents",
    "account_id",
    "set_payee_id",
    "set_category_id",
    "set_memo",
}


def spec_of(rule: Rule) -> rule_math.RuleSpec:
    return rule_math.RuleSpec(
        id=rule.id or 0,
        match_field=rule.match_field,
        match_type=rule.match_type,
        match_value=rule.match_value or "",
        amount_min_cents=rule.amount_min_cents,
        amount_max_cents=rule.amount_max_cents,
        account_id=rule.account_id,
        is_active=rule.is_active if rule.is_active is not None else True,
    )


def list_rules(db: DbSession) -> list[Rule]:
    return list(db.scalars(select(Rule).order_by(Rule.priority, Rule.id)))


def active_specs(db: DbSession) -> tuple[list[rule_math.RuleSpec], dict[int, Rule]]:
    rows = [rule for rule in list_rules(db) if rule.is_active]
    return [spec_of(rule) for rule in rows], {rule.id: rule for rule in rows}


def get_rule(db: DbSession, rule_id: int) -> Rule:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise AppError(404, "Rule not found", "rule_not_found")
    return rule


def _validate(db: DbSession, rule: Rule) -> None:
    if not (rule.name or "").strip():
        rule.name = (rule.match_value or "").strip()[:120] or "Rule"
    problem = rule_math.rule_problem(spec_of(rule))
    if problem:
        raise AppError(422, problem, "invalid_rule")
    if (
        rule.set_payee_id is None
        and rule.set_category_id is None
        and not (rule.set_memo or "").strip()
    ):
        raise AppError(
            422, "A rule needs something to do: a payee, a category or a memo.", "rule_no_action"
        )
    if rule.set_payee_id is not None:
        payees_service.get_payee(db, rule.set_payee_id)
    if rule.set_category_id is not None:
        categories_service.get_category(db, rule.set_category_id)
    if rule.account_id is not None:
        accounts_service.get_account(db, rule.account_id)


def create_rule(db: DbSession, fields: dict) -> Rule:
    rule = Rule(**{key: value for key, value in fields.items() if key in EDITABLE})
    rule.is_active = True if rule.is_active is None else rule.is_active
    rule.match_field = rule.match_field or "description"
    rule.match_type = rule.match_type or "contains"
    _validate(db, rule)
    # New rules go to the end: an existing rule keeps winning until you move this one up.
    rule.priority = int(db.scalar(select(func.coalesce(func.max(Rule.priority), -1))) or 0) + 1
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def update_rule(db: DbSession, rule_id: int, changes: dict) -> Rule:
    rule = get_rule(db, rule_id)
    for key, value in changes.items():
        if key in EDITABLE:
            setattr(rule, key, value)
    _validate(db, rule)
    db.commit()
    db.refresh(rule)
    return rule


def delete_rule(db: DbSession, rule_id: int) -> None:
    db.delete(get_rule(db, rule_id))
    db.commit()


def move_rule(db: DbSession, rule_id: int, offset: int) -> list[Rule]:
    rules = list_rules(db)
    ids = [rule.id for rule in rules]
    if rule_id not in ids:
        raise AppError(404, "Rule not found", "rule_not_found")
    new_order = ordering.moved(ids, rule_id, offset)
    by_id = {rule.id: rule for rule in rules}
    for position, identifier in enumerate(new_order):
        by_id[identifier].priority = position
    db.commit()
    return list_rules(db)


def test_rule(
    db: DbSession, fields: dict, *, limit: int = 500
) -> tuple[int, list[ImportStagedRow]]:
    """Which past imported rows a rule (saved or not) would match, newest first."""
    rule = Rule(**{key: value for key, value in fields.items() if key in EDITABLE})
    rule.is_active = True
    rule.match_field = rule.match_field or "description"
    rule.match_type = rule.match_type or "contains"
    problem = rule_math.rule_problem(spec_of(rule))
    if problem:
        raise AppError(422, problem, "invalid_rule")
    spec = spec_of(rule)
    rows = db.scalars(
        select(ImportStagedRow)
        .join(ImportBatch, ImportBatch.id == ImportStagedRow.batch_id)
        .where(ImportBatch.status != "undone")
        .order_by(ImportStagedRow.date.desc(), ImportStagedRow.id.desc())
        .limit(limit)
    ).all()
    hits = [
        row
        for row in rows
        if rule_math.matches(
            spec,
            description=row.raw_description,
            memo=row.raw_memo,
            amount_cents=row.amount_cents,
            account_id=row.batch.account_id,
        )
    ]
    return len(rows), hits


# ---------------------------------------------------------------------- reference moves


def move_payee(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Rule)
        .where(Rule.set_payee_id == source_id)
        .values(set_payee_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def move_category(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Rule)
        .where(Rule.set_category_id == source_id)
        .values(set_category_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def register() -> None:
    from app.services import references

    references.register_payee_reassigner("rules", move_payee)
    references.register_category_reassigner("rules", move_category)
