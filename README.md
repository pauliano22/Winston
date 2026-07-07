# Winston

Winston is a B2B AI infrastructure product that acts as a **Circuit Breaker** for autonomous AI agents. It prevents runaway API costs caused by infinite loops, hallucinations, or misbehaving agents by sitting between the agent and its upstream LLM provider.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent (e.g. Claude Code)                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ LLM API calls
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Winston Proxy  (proxy/)                      │
│                                                                   │
│  • Built with FastAPI + LiteLLM                                  │
│  • Intercepts every LLM request                                  │
│  • Tracks token / dollar spend per agent / org                   │
│  • Enforces budget limits — rejects requests that exceed them    │
│  • Routes approved requests to the real upstream provider        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ approved requests only
                            ▼
              ┌─────────────────────────────┐
              │  Upstream LLM Provider       │
              │  (OpenAI, Anthropic, etc.)   │
              └─────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Winston MCP Server  (mcp-server/)              │
│                                                                   │
│  • Implements the Model Context Protocol (MCP)                   │
│  • Exposes tools that agents can call directly                   │
│  • check_budget — lets an agent query its remaining budget       │
│    before issuing expensive operations                           │
│  • Future tools: pause_agent, report_loop, adjust_limit, …      │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Stack | Purpose |
|-----------|-------|---------|
| `proxy/` | Python · FastAPI · LiteLLM | High-concurrency reverse proxy with budget enforcement |
| `mcp-server/` | TypeScript · @modelcontextprotocol/sdk | MCP server exposing budget/control tools to agents |
| `dashboard/` | TypeScript · Next.js · Clerk | Admin UI for viewing and managing project budgets |

The proxy also depends on Redis for budget/loop-detection state (see `docker-compose.yml`).

## Quick Start

### Proxy

Requires a running Redis instance and a `WINSTON_MASTER_KEY` for authenticated endpoints:

```bash
cd proxy
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker run -d -p 6379:6379 redis:alpine
export WINSTON_MASTER_KEY=change-me
uvicorn main:app --reload --port 8000
```

### MCP Server

Requires the proxy above to be running, and a matching API key so the
`check_budget` tool can authenticate:

```bash
cd mcp-server
npm install
npm run build
export WINSTON_API_KEY=change-me      # must match the proxy's WINSTON_MASTER_KEY
export WINSTON_PROXY_URL=http://127.0.0.1:8000   # optional, this is the default
npm start
```

### Docker Compose (all services)

```bash
export WINSTON_MASTER_KEY=change-me
export ANTHROPIC_API_KEY=...
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
export CLERK_SECRET_KEY=...
docker compose up --build
```

Note that `NEXT_PUBLIC_*` values are baked into the dashboard's client
bundle at *build* time, so changing them requires `--build` again, not
just a restart.

## How It Works

1. An agent is configured to route all LLM calls through the Winston Proxy instead of calling the provider directly.
2. The proxy checks the agent's remaining budget on every request. If the budget is exhausted, the request is rejected with a structured error.
3. Optionally, the agent can call the `check_budget` MCP tool before starting an expensive task to get a real-time budget snapshot.
4. Operators manage budgets, view spend analytics, and configure circuit-breaker thresholds through the Winston API.
