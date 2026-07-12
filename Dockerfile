FROM node:24-bookworm-slim AS web-build

WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
COPY service /app
RUN uv sync --frozen --no-dev
COPY --from=web-build /web/dist /app/web

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV WEB_DIST_DIR="/app/web"
EXPOSE 8080

CMD ["sh", "-c", "uvicorn ucp_shopping_agent.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
