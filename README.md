# UCP Shopping Agent

A standalone, merchant-agnostic conversational shopping client built with
Google Agent Development Kit (ADK). It discovers a remote UCP merchant, uses
deterministic catalog and checkout tools, and hosts independently deployed
browser payment handlers outside model context.

## Architecture and boundaries

- The model receives product, checkout, and masked display information only.
- The Python tools expose generic UCP shopping operations.
- The React client owns a structural browser-plugin interface; that interface is
  not presented as part of the UCP standard.
- Supported handlers are configuration in
  `service/src/ucp_shopping_agent/payment-handlers.json`, not provider logic in
  Python.
- The platform loads only its configured handler `module_url`; it does not
  execute a merchant-supplied module URL.
- Payment credentials never enter the model transcript.
- After explicit buyer confirmation, deterministic client code submits the
  handler-created instrument to the merchant's standard UCP checkout-complete
  operation.

The demo configuration declares the experimental Paze handler, but this
repository contains no Paze SDK calls, action codes, credential parsing,
cryptography, or instrument construction.

## Requirements

- Python 3.11–3.13
- [uv](https://docs.astral.sh/uv/)
- Node.js 20 or newer
- A Google API key
- Reachable merchant and payment-handler deployments

## Local development

```bash
cp .env.example .env
uv sync --project service
npm install --prefix web
./scripts/demo.sh
```

When this repository is checked out in the demo workspace beside
`demo-merchant`, `paze-ucp-payment-handler`, and the workspace launcher,
`demo.sh` starts the full demo. In a standalone checkout it falls back to
starting this repository's two independently deployable processes:

- ADK service: `http://127.0.0.1:8000`
- Conversational client: `http://127.0.0.1:5174`

For the standalone fallback, the merchant and handler module must already be
running at the URLs configured in `.env`.

## Configuration

Important settings:

- `GOOGLE_API_KEY`
- `ADK_MODEL` (defaults to `gemini-3.1-flash-lite`)
- `MERCHANT_BASE_URL`
- `PAYMENT_HANDLER_MODULE_URL`
- `PAYMENT_HANDLERS_CONFIG` (optional override; the packaged default is used
  when omitted)
- `AGENT_PUBLIC_URL`
- `CHAT_ORIGIN`

## Validation

With the merchant running:

```bash
uv run --project service python scripts/smoke_tools.py
```

## Google Cloud Run deployment

The production-shaped demo deploys the React client and Python ADK service as
one `gemini-agent` Cloud Run service. The multi-stage `Dockerfile` builds the
web client and packages it with FastAPI; the service scales to zero when idle.

Prerequisites:

- Google Cloud CLI authenticated to `gen-lang-client-0893499492`
- Cloud Run, Cloud Build, Artifact Registry, and Vertex AI APIs enabled
- the Cloud Run service account granted the Vertex AI User role

Deploy with:

```bash
./scripts/deploy-cloud-run.sh
```

The script configures the deployed merchant and Paze handler URLs, exposes the
service publicly, limits the demo to one instance so in-memory conversations
do not split across instances, uses Vertex AI application-default credentials,
and updates the agent profile with its final Cloud Run URL. Cold starts and
session loss after scale-to-zero are expected for this demo.

The smoke test covers discovery, filtered catalog search, multi-item checkout,
handler action selection, checkout cancellation, and creation of a fresh
checkout after a closed one. It does not invoke Gemini or a payment SDK.

Validate the browser client independently with:

```bash
npm --prefix web run validate
uv run --project service python -m compileall -q service/src
uv run --project service ruff check service/src scripts
```
