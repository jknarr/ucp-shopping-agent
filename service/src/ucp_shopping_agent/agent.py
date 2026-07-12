"""Google ADK agent and deterministic UCP REST tools."""

from __future__ import annotations

import os
from typing import Any

import httpx
from google.adk.agents import Agent
from google.adk.tools.tool_context import ToolContext

UCP_VERSION = "2026-04-08"
CHECKOUT_STATE = "checkout_id"
MERCHANT_STATE = "merchant_base_url"
UI_STATE = "ui_payload"


def _merchant_url(tool_context: ToolContext) -> str:
    return str(
        tool_context.state.get(MERCHANT_STATE)
        or os.getenv("MERCHANT_BASE_URL", "http://127.0.0.1:5173")
    ).rstrip("/")


def _headers() -> dict[str, str]:
    public_url = os.getenv("AGENT_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "UCP-Agent": f'profile="{public_url}/.well-known/ucp"',
    }


async def _request(
    tool_context: ToolContext,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(
            method,
            f"{_merchant_url(tool_context)}{path}",
            headers=_headers(),
            json=body,
        )
    if response.status_code >= 400:
        raise ValueError(f"Merchant returned {response.status_code}: {response.text[:400]}")
    return response.json()


def _checkout_id(tool_context: ToolContext) -> str:
    checkout_id = tool_context.state.get(CHECKOUT_STATE)
    if not checkout_id:
        raise ValueError("No checkout exists yet. Add a product first.")
    return str(checkout_id)


async def discover_merchant(tool_context: ToolContext) -> dict[str, Any]:
    """Discover the configured merchant's UCP services and payment handlers."""
    profile = await _request(tool_context, "GET", "/.well-known/ucp")
    tool_context.state[UI_STATE] = {"kind": "merchant", "profile": profile}
    return {
        "status": "success",
        "business": profile.get("business"),
        "capabilities": list(profile.get("ucp", {}).get("capabilities", {}).keys()),
        "payment_handlers": list(
            profile.get("ucp", {}).get("payment_handlers", {}).keys()
        ),
    }


async def search_catalog(
    tool_context: ToolContext,
    query: str = "",
    min_price_usd: float | None = None,
    max_price_usd: float | None = None,
) -> dict[str, Any]:
    """Search the merchant catalog with deterministic optional USD price bounds.

    Args:
        query: Product keywords. Use an empty string when the buyer only gives a price.
        min_price_usd: Inclusive minimum price in US dollars, when requested.
        max_price_usd: Inclusive maximum price in US dollars, when requested.
    """
    filters: dict[str, Any] = {}
    if min_price_usd is not None or max_price_usd is not None:
        filters["price"] = {
            **(
                {"min": round(min_price_usd * 100)}
                if min_price_usd is not None
                else {}
            ),
            **(
                {"max": round(max_price_usd * 100)}
                if max_price_usd is not None
                else {}
            ),
        }
    result = await _request(
        tool_context,
        "POST",
        "/catalog/search",
        {
            "query": query,
            "context": {"currency": "USD"},
            **({"filters": filters} if filters else {}),
            "pagination": {"limit": 8},
        },
    )
    products = result.get("products", [])
    tool_context.state[UI_STATE] = {"kind": "products", "products": products}
    return {"status": "success", "products": products}


async def create_checkout(
    tool_context: ToolContext,
    product_id: str,
    quantity: int = 1,
) -> dict[str, Any]:
    """Create a server-priced UCP checkout for an exact product ID."""
    body: dict[str, Any] = {
        "line_items": [{"item": {"id": product_id}, "quantity": quantity}]
    }
    checkout = await _request(tool_context, "POST", "/checkout-sessions", body)
    tool_context.state[CHECKOUT_STATE] = checkout["id"]
    tool_context.state[UI_STATE] = {"kind": "checkout", "checkout": checkout}
    return {"status": "success", "checkout": checkout}


async def replace_checkout(
    tool_context: ToolContext,
    product_id: str,
    quantity: int,
) -> dict[str, Any]:
    """Replace the current checkout contents with a product and quantity."""
    checkout_id = tool_context.state.get(CHECKOUT_STATE)
    if not checkout_id:
        return await create_checkout(tool_context, product_id, quantity)
    current = await _request(
        tool_context, "GET", f"/checkout-sessions/{checkout_id}"
    )
    if current.get("status") in {"completed", "canceled"}:
        return await create_checkout(tool_context, product_id, quantity)
    body: dict[str, Any] = {
        "line_items": [{"item": {"id": product_id}, "quantity": quantity}]
    }
    checkout = await _request(
        tool_context, "PUT", f"/checkout-sessions/{checkout_id}", body
    )
    tool_context.state[UI_STATE] = {"kind": "checkout", "checkout": checkout}
    return {"status": "success", "checkout": checkout}


async def add_to_checkout(
    tool_context: ToolContext,
    product_id: str,
    quantity: int = 1,
) -> dict[str, Any]:
    """Add a product to the current checkout while preserving existing items."""
    checkout_id = tool_context.state.get(CHECKOUT_STATE)
    if not checkout_id:
        return await create_checkout(tool_context, product_id, quantity)
    current = await _request(
        tool_context, "GET", f"/checkout-sessions/{checkout_id}"
    )
    if current.get("status") in {"completed", "canceled"}:
        return await create_checkout(tool_context, product_id, quantity)
    lines: list[dict[str, Any]] = []
    matched = False
    for line in current.get("line_items", []):
        item_id = str(line.get("item", {}).get("id", ""))
        line_quantity = int(line.get("quantity", 1))
        if item_id == product_id:
            line_quantity += max(1, quantity)
            matched = True
        lines.append(
            {
                "id": line.get("id"),
                "item": {"id": item_id},
                "quantity": line_quantity,
            }
        )
    if not matched:
        lines.append(
            {"item": {"id": product_id}, "quantity": max(1, quantity)}
        )
    checkout = await _request(
        tool_context,
        "PUT",
        f"/checkout-sessions/{checkout_id}",
        {"line_items": lines},
    )
    tool_context.state[UI_STATE] = {"kind": "checkout", "checkout": checkout}
    return {"status": "success", "checkout": checkout}


async def get_checkout(tool_context: ToolContext) -> dict[str, Any]:
    """Get the current authoritative UCP checkout and payment readiness."""
    checkout_id = _checkout_id(tool_context)
    checkout = await _request(tool_context, "GET", f"/checkout-sessions/{checkout_id}")
    tool_context.state[UI_STATE] = {"kind": "checkout", "checkout": checkout}
    return {"status": "success", "checkout": checkout}


def _negotiated_handler(checkout: dict[str, Any]) -> str:
    handlers = checkout.get("ucp", {}).get("payment_handlers", {})
    if not handlers:
        raise ValueError("No payment handler was negotiated with the merchant.")
    return str(next(iter(handlers)))


async def start_payment(tool_context: ToolContext) -> dict[str, Any]:
    """Return an action for the negotiated payment handler."""
    checkout_id = _checkout_id(tool_context)
    checkout = await _request(tool_context, "GET", f"/checkout-sessions/{checkout_id}")
    if checkout.get("status") == "ready_for_complete":
        payload = {"kind": "checkout", "checkout": checkout}
    else:
        payload = {
            "kind": "payment_action",
            "checkout": checkout,
            "action": {
                "handler": _negotiated_handler(checkout),
                "label": "Continue to payment",
                "action_code": "START_FLOW",
            },
        }
    tool_context.state[UI_STATE] = payload
    return {"status": "success", **payload}


async def change_payment_method(tool_context: ToolContext) -> dict[str, Any]:
    """Return a change-method action for the negotiated payment handler."""
    checkout_id = _checkout_id(tool_context)
    checkout = await _request(tool_context, "GET", f"/checkout-sessions/{checkout_id}")
    payload = {
        "kind": "payment_action",
        "checkout": checkout,
        "action": {
            "handler": _negotiated_handler(checkout),
            "label": "Change payment method",
            "action_code": "CHANGE_PAYMENT_METHOD",
        },
    }
    tool_context.state[UI_STATE] = payload
    return {"status": "success", **payload}


root_agent = Agent(
    name="ucp_shopping_agent",
    model=os.getenv("ADK_MODEL", "gemini-3.1-flash-lite"),
    description="Buyer-side conversational shopping agent using UCP REST merchants.",
    instruction=(
        "You are a concise buyer-side shopping assistant for a discovered UCP merchant. "
        "Use the UCP tools for every product, price, checkout, payment, and order fact; "
        "never invent products or totals. Search before creating a checkout when the "
        "product ID is unknown. Always pass requested minimum or maximum prices into "
        "search_catalog; do not filter a broader tool result only in prose. When the "
        "buyer says add, also, another, or otherwise wants an additional product, use "
        "add_to_checkout so existing line items are preserved. Use replace_checkout only "
        "when the buyer explicitly wants to replace the checkout contents. When the "
        "previous checkout is completed or canceled, create a fresh checkout for any new "
        "shopping request; never try to mutate or reuse a closed checkout. When the "
        "checkout is created or updated, summarize it and, if asking a follow-up, ask "
        "only whether the buyer wants to add any other items. Do not ask for an email "
        "address, phone number, shipping information, contact details, or whether they "
        "are ready to pay. Wait for the buyer to request payment. When the "
        "buyer asks to pay, call start_payment and explain that the negotiated payment "
        "handler opens directly in the conversation. When the buyer asks to change, "
        "switch, or choose another card, call change_payment_method. Never direct "
        "the buyer to the merchant site for payment; merchant navigation is only for "
        "viewing a completed order. The client observes the handler and renders its "
        "review automatically, so never ask the buyer to tell you when "
        "they are finished and never ask them to check payment status manually. "
        "Never claim that you opened a popup yourself. "
        "After the payment action, call get_checkout when asked to check status. "
        "The deterministic client, not the model, completes an order after explicit "
        "buyer confirmation. Never ask for, repeat, or expose payment credentials or "
        "handler payloads."
    ),
    tools=[
        discover_merchant,
        search_catalog,
        create_checkout,
        add_to_checkout,
        replace_checkout,
        get_checkout,
        start_payment,
        change_payment_method,
    ],
)
