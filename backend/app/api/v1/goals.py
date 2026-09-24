"""Savings goals and sinking funds (SPEC §13)."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.goals import GoalIn, GoalListOut, GoalOut, GoalPatch
from app.services import goals as service

router = APIRouter(tags=["goals"])


def goal_out(result: service.Progress) -> GoalOut:
    goal = result.goal
    return GoalOut(
        id=goal.id,
        name=goal.name,
        type=goal.type,
        target_cents=goal.target_cents,
        target_date=goal.target_date,
        account_id=goal.account_id,
        category_id=goal.category_id,
        starting_balance_cents=goal.starting_balance_cents,
        start_date=goal.start_date,
        is_archived=goal.is_archived,
        notes=goal.notes,
        progress_cents=result.progress_cents,
        remaining_cents=result.remaining_cents,
        needed_cents=result.needed_cents,
        periods_left=result.periods_left,
        current_planned_cents=result.current_planned_cents,
        rate_cents=result.rate_cents,
        projected_date=result.projected_date,
        status=result.status,
        current_period_id=result.current_period_id,
    )


def _out(db: DbSession, goal_id: int) -> GoalOut:
    return goal_out(service.progress(db, service.get_goal(db, goal_id), date.today()))


@router.get("/goals", response_model=GoalListOut)
def list_goals(
    archived: bool = Query(default=False), db: DbSession = Depends(get_db)
) -> GoalListOut:
    today = date.today()
    return GoalListOut(
        items=[
            goal_out(service.progress(db, goal, today))
            for goal in service.list_goals(db, include_archived=archived)
        ]
    )


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(payload: GoalIn, db: DbSession = Depends(get_db)) -> GoalOut:
    goal = service.create_goal(db, payload.model_dump(), today=date.today())
    return _out(db, goal.id)


@router.get("/goals/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: int, db: DbSession = Depends(get_db)) -> GoalOut:
    return _out(db, goal_id)


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, payload: GoalPatch, db: DbSession = Depends(get_db)) -> GoalOut:
    service.update_goal(db, goal_id, payload.model_dump(exclude_unset=True))
    return _out(db, goal_id)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.delete_goal(db, goal_id)
    return Response(status_code=204)


@router.post("/goals/{goal_id}/use-suggested", response_model=GoalOut)
def use_suggested(goal_id: int, db: DbSession = Depends(get_db)) -> GoalOut:
    return goal_out(service.use_suggested(db, goal_id, date.today()))
