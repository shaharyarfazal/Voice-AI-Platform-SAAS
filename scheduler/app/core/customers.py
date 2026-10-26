from __future__ import annotations

import uuid
from typing import Any

import phonenumbers
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import ApiError
from ..models import Customer, CustomerAddress


def normalize_phone(raw: str, region: str = "US") -> str:
    """E.164, or ApiError if it isn't a plausible number."""
    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException as e:
        raise ApiError("invalid_phone", "That phone number doesn't look right. Ask the caller to repeat it.") from e
    if not phonenumbers.is_possible_number(parsed):
        raise ApiError("invalid_phone", "That phone number doesn't look right. Ask the caller to repeat it.")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


async def upsert_customer(
    session: AsyncSession, business_id: uuid.UUID, *, name: str, phone_e164: str, email: str | None
) -> Customer:
    """One customer per phone number per business; the latest name and email win."""
    stmt = (
        insert(Customer)
        .values(business_id=business_id, name=name.strip(), phone_e164=phone_e164, email=email)
        .on_conflict_do_update(
            index_elements=[Customer.business_id, Customer.phone_e164],
            set_={"name": name.strip(), "email": email if email else Customer.email},
        )
        .returning(Customer.id)
    )
    customer_id = (await session.execute(stmt)).scalar_one()
    customer = await session.get(Customer, customer_id, populate_existing=True)
    assert customer is not None
    return customer


async def find_or_add_address(
    session: AsyncSession, business_id: uuid.UUID, customer_id: uuid.UUID, address: dict[str, Any]
) -> CustomerAddress:
    line1 = (address.get("line1") or "").strip()
    postal = address.get("postal_code")
    existing = await session.scalar(
        select(CustomerAddress).where(
            CustomerAddress.customer_id == customer_id,
            CustomerAddress.line1.ilike(line1),
            (CustomerAddress.postal_code == postal) if postal else CustomerAddress.postal_code.is_(None),
        )
    )
    if existing:
        return existing
    row = CustomerAddress(
        business_id=business_id,
        customer_id=customer_id,
        line1=line1,
        line2=address.get("line2"),
        city=address.get("city"),
        region=address.get("region"),
        postal_code=postal,
        country=address.get("country"),
    )
    session.add(row)
    await session.flush()
    return row
