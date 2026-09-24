"""Version 1 of the JSON API.

Everything here requires a session and the X-PB-Request header on mutations, except
the health check and the auth routes, which are mounted before that dependency.
"""

from fastapi import APIRouter, Depends

from app.api.v1 import (
    accounts,
    auth,
    budget,
    categories,
    health,
    imports,
    notifications,
    pay_schedule,
    payees,
    reconcile,
    settings,
    subscriptions,
    transactions,
    users,
)
from app.auth import authenticated

api_router = APIRouter(prefix="/api/v1")

# Public: no session required.
api_router.include_router(health.router)
api_router.include_router(auth.router)

# Everything else.
protected = APIRouter(dependencies=[Depends(authenticated)])
protected.include_router(users.router)
protected.include_router(settings.router)
protected.include_router(pay_schedule.router)
protected.include_router(accounts.router)
protected.include_router(categories.router)
protected.include_router(payees.router)
protected.include_router(transactions.router)
protected.include_router(reconcile.router)
protected.include_router(budget.router)
protected.include_router(subscriptions.router)
protected.include_router(notifications.router)
protected.include_router(imports.router)
api_router.include_router(protected)

__all__ = ["api_router"]
