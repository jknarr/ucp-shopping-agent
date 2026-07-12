"""HTTP host for the standalone Google ADK shopping agent."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from importlib.resources import files
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field

from .agent import MERCHANT_STATE, UI_STATE, root_agent

load_dotenv()

APP_NAME = "ucp-shopping-agent"
session_service = InMemorySessionService()
runner = Runner(app_name=APP_NAME, agent=root_agent, session_service=session_service)
MAX_CAPACITY_ATTEMPTS = 3


def platform_payment_handlers() -> dict[str, Any]:
    configured_path = os.getenv("PAYMENT_HANDLERS_CONFIG")
    if configured_path:
        config_path = Path(configured_path)
        if not config_path.is_absolute():
            config_path = Path(__file__).resolve().parents[3] / config_path
        if not config_path.is_file():
            raise RuntimeError(
                f"PAYMENT_HANDLERS_CONFIG does not exist: {config_path}"
            )
        raw = config_path.read_text(encoding="utf-8")
    else:
        raw = (
            files("ucp_shopping_agent")
            .joinpath("payment-handlers.json")
            .read_text(encoding="utf-8")
        )
    module_url = os.getenv(
        "PAYMENT_HANDLER_MODULE_URL", "http://127.0.0.1:5175/src/browser.ts"
    )
    loaded = json.loads(raw.replace("${PAYMENT_HANDLER_MODULE_URL}", module_url))
    if not isinstance(loaded, dict):
        raise RuntimeError("Payment-handler configuration must be a JSON object")
    return loaded


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    text: str
    ui: dict[str, Any] | None = None


class PaymentCompletionRequest(BaseModel):
    handler: str = Field(min_length=1, max_length=255)
    checkout_id: str = Field(min_length=1, max_length=255)
    instrument: dict[str, Any]


async def ensure_session(session_id: str):
    session = await session_service.get_session(
        app_name=APP_NAME, user_id=session_id, session_id=session_id
    )
    if session is None:
        session = await session_service.create_session(
            app_name=APP_NAME,
            user_id=session_id,
            session_id=session_id,
            state={
                MERCHANT_STATE: os.getenv(
                    "MERCHANT_BASE_URL", "http://127.0.0.1:5173"
                ),
                UI_STATE: None,
            },
        )
    return session


app = FastAPI(title="UCP Shopping Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CHAT_ORIGIN", "http://127.0.0.1:5174")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "agent": root_agent.name}


async def merchant_profile() -> dict[str, Any]:
    merchant = os.getenv("MERCHANT_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{merchant}/.well-known/ucp")
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Merchant is unavailable at {merchant}. Start it or update MERCHANT_BASE_URL.",
        ) from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Merchant discovery failed")
    return response.json()


@app.get("/.well-known/ucp")
async def profile() -> dict[str, Any]:
    public_url = os.getenv("AGENT_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
    return {
        "ucp": {
            "version": "2026-04-08",
            "services": {
                "dev.ucp.shopping": [
                    {
                        "version": "2026-04-08",
                        "spec": "https://ucp.dev/2026-04-08/specification/overview",
                        "transport": "rest",
                        "endpoint": public_url,
                        "schema": "https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json",
                    }
                ]
            },
            "capabilities": {
                "dev.ucp.shopping.catalog.search": [{"version": "2026-04-08"}],
                "dev.ucp.shopping.catalog.lookup": [{"version": "2026-04-08"}],
                "dev.ucp.shopping.checkout": [{"version": "2026-04-08"}],
            },
            "payment_handlers": platform_payment_handlers(),
        },
        "agent": {"name": "UCP Conversational Shopper", "url": public_url},
    }


@app.get("/api/payment-handlers")
async def payment_handlers() -> dict[str, Any]:
    business_profile = await merchant_profile()
    business_handlers = business_profile.get("ucp", {}).get("payment_handlers", {})
    platform_handlers = (await profile()).get("ucp", {}).get("payment_handlers", {})
    negotiated: list[dict[str, Any]] = []
    for name in business_handlers.keys() & platform_handlers.keys():
        definitions = business_handlers.get(name) or []
        if not definitions:
            continue
        business_definition = definitions[0]
        platform_definition = (platform_handlers.get(name) or [{}])[0]
        if business_definition.get("version") != platform_definition.get("version"):
            continue
        config = {
            **(business_definition.get("config") or {}),
            "module_url": platform_definition.get("config", {}).get("module_url"),
            "handler_instance_id": business_definition.get("id"),
        }
        if not isinstance(config.get("module_url"), str):
            continue
        negotiated.append(
            {
                "name": name,
                "label": platform_definition.get("label", "Payment handler"),
                "config": config,
            }
        )
    return {"handlers": negotiated}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    if not os.getenv("GOOGLE_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_API_KEY is required to run the Google ADK conversation.",
        )
    await merchant_profile()
    session_id = request.session_id or str(uuid.uuid4())
    await ensure_session(session_id)
    message = types.Content(
        role="user", parts=[types.Part.from_text(text=request.message)]
    )
    text_parts: list[str] = []
    for attempt in range(1, MAX_CAPACITY_ATTEMPTS + 1):
        text_parts.clear()
        try:
            async for event in runner.run_async(
                user_id=session_id,
                session_id=session_id,
                new_message=message,
                state_delta={UI_STATE: None},
            ):
                if event.is_final_response() and event.content:
                    for part in event.content.parts or []:
                        if part.text:
                            text_parts.append(part.text)
            break
        except Exception as exc:
            message_text = str(exc)
            capacity_error = "503" in message_text and "UNAVAILABLE" in message_text
            if capacity_error and attempt < MAX_CAPACITY_ATTEMPTS:
                await asyncio.sleep(2 ** (attempt - 1))
                continue
            if capacity_error:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Gemini is temporarily at capacity after three attempts. "
                        "Retry shortly or verify ADK_MODEL=gemini-3.1-flash-lite in .env."
                    ),
                ) from exc
            raise HTTPException(status_code=502, detail=f"ADK run failed: {exc}") from exc

    session = await session_service.get_session(
        app_name=APP_NAME, user_id=session_id, session_id=session_id
    )
    ui = session.state.get(UI_STATE) if session else None
    return ChatResponse(
        session_id=session_id,
        text="\n".join(text_parts).strip() or "I completed that shopping step.",
        ui=ui if isinstance(ui, dict) else None,
    )


@app.post("/api/payment/complete")
async def complete_payment(request: PaymentCompletionRequest) -> dict[str, Any]:
    """Submit a negotiated handler instrument through standard UCP completion."""
    business_profile = await merchant_profile()
    supported = business_profile.get("ucp", {}).get("payment_handlers", {})
    if request.handler not in supported:
        raise HTTPException(status_code=400, detail="Merchant does not support that payment handler")
    merchant = os.getenv("MERCHANT_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        completed = await client.post(
            f"{merchant}/checkout-sessions/{request.checkout_id}/complete",
            json={"payment": {"instruments": [request.instrument]}},
        )
    if completed.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Merchant checkout completion returned {completed.status_code}: {completed.text[:400]}",
        )
    return completed.json()


def run() -> None:
    import uvicorn

    uvicorn.run(
        "ucp_shopping_agent.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir="service/src",
    )
