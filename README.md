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

## Quick Start

### Proxy

```bash
cd proxy
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### MCP Server

```bash
cd mcp-server
npm install
npm run build
npm start
```

## How It Works

1. An agent is configured to route all LLM calls through the Winston Proxy instead of calling the provider directly.
2. The proxy checks the agent's remaining budget on every request. If the budget is exhausted, the request is rejected with a structured error.
3. Optionally, the agent can call the `check_budget` MCP tool before starting an expensive task to get a real-time budget snapshot.
4. Operators manage budgets, view spend analytics, and configure circuit-breaker thresholds through the Winston API.
