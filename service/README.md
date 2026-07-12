# UCP shopping agent service

Google ADK service whose tools call a remote UCP merchant over REST. Run from
the repository root with `./scripts/dev.sh`, or directly with:

```bash
uv run --project service uvicorn ucp_shopping_agent.main:app \
  --app-dir service/src --reload --port 8000
```
