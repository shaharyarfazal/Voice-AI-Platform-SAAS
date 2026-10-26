from fastapi import APIRouter

from . import bookings, catalog, settings, staff

router = APIRouter(prefix="/v1", tags=["dashboard"])
for module in (settings, staff, catalog, bookings):
    router.include_router(module.router)
