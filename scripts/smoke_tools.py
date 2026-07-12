"""Exercise the deterministic, handler-agnostic UCP tool layer without Gemini."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import httpx

from ucp_shopping_agent.agent import (
    CHECKOUT_STATE,
    MERCHANT_STATE,
    UI_STATE,
    add_to_checkout,
    create_checkout,
    discover_merchant,
    get_checkout,
    search_catalog,
    start_payment,
)


async def main() -> None:
    base_url = os.getenv("MERCHANT_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    context = SimpleNamespace(state={MERCHANT_STATE: base_url, UI_STATE: None})

    discovery = await discover_merchant(context)
    assert discovery["payment_handlers"], "no payment handler was negotiated"
    search = await search_catalog(context, "", max_price_usd=60)
    assert search["products"], "catalog search returned no products"
    assert all(
        product["price_range"]["min"]["amount"] <= 6000
        for product in search["products"]
    )
    created = await create_checkout(context, search["products"][0]["id"], 1)
    checkout_id = created["checkout"]["id"]
    assert context.state[CHECKOUT_STATE] == checkout_id
    if len(search["products"]) > 1:
        added = await add_to_checkout(context, search["products"][1]["id"])
        assert len(added["checkout"]["line_items"]) == 2
    action = await start_payment(context)
    assert action["action"]["handler"] in discovery["payment_handlers"]
    current = await get_checkout(context)
    assert current["checkout"]["id"] == checkout_id
    async with httpx.AsyncClient(timeout=10) as client:
        canceled = await client.post(
            f"{base_url}/checkout-sessions/{checkout_id}/cancel"
        )
        canceled.raise_for_status()
    restarted = await add_to_checkout(context, search["products"][0]["id"])
    assert restarted["checkout"]["id"] != checkout_id
    assert len(restarted["checkout"]["line_items"]) == 1
    print("Handler-agnostic UCP tool smoke test passed:", checkout_id)


if __name__ == "__main__":
    asyncio.run(main())
