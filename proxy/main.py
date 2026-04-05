import hashlib
import os
from contextlib import asynccontextmanager

import litellm
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from redis.exceptions import RedisError, ResponseError

# Let LiteLLM silently drop provider-unsupported params so cross-provider
# routing works without manual payload scrubbing.
litellm.drop_params = True

# ── Constants ─────────────────────────────────────────────────────────────────

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
WINSTON_MASTER_KEY = os.environ.get("WINSTON_MASTER_KEY", "")
LOOP_TRIP_THRESHOLD = 3
LOOP_TTL = 3600  # seconds — loop counters expire after 1 hour of inactivity

# ── Atomic check-and-deduct Lua script ────────────────────────────────────────
# Runs entirely inside Redis, so concurrent requests can't race each other.
# Returns the new balance on success.
# Raises a Redis error reply on NOT_FOUND or INSUFFICIENT funds.
_DEDUCT_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]))
if not current then
    return redis.error_reply('NOT_FOUND')
end
if current - tonumber(ARGV[1]) < 0 then
    return redis.error_reply('INSUFFICIENT')
end
return redis.call('INCRBYFLOAT', KEYS[1], -tonumber(ARGV[1]))
"""

# ── Atomic init-if-new-then-deduct Lua script ─────────────────────────────────
# Used for session ledgers: if the key doesn't exist yet, seed it with the
# provided limit before attempting the deduction.
_SESSION_DEDUCT_SCRIPT = """
local limit = ARGV[2]
if limit and limit ~= '' then
    redis.call('SETNX', KEYS[1], limit)
end
local current = tonumber(redis.call('GET', KEYS[1]))
if not current then
    return redis.error_reply('NOT_FOUND')
end
if current - tonumber(ARGV[1]) < 0 then
    return redis.error_reply('INSUFFICIENT')
end
return redis.call('INCRBYFLOAT', KEYS[1], -tonumber(ARGV[1]))
"""


# ── App lifespan — connect / seed / disconnect Redis ─────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        await app.state.redis.ping()
    except RedisError as exc:
        raise RuntimeError(f"Cannot connect to Redis at {REDIS_URL}: {exc}") from exc

    # Seed default project budget only if the key doesn't already exist.
    await app.state.redis.setnx("budget:project_alpha", "50.00")

    yield

    await app.state.redis.aclose()


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="Winston Proxy", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://3.144.134.48:3000", "http://3.144.134.48"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth dependency ───────────────────────────────────────────────────────────

_api_key_header = APIKeyHeader(name="X-Winston-API-Key", auto_error=False)


async def require_api_key(key: str = Depends(_api_key_header)):
    if not WINSTON_MASTER_KEY:
        raise HTTPException(status_code=500, detail="Server misconfiguration: WINSTON_MASTER_KEY not set.")
    if key != WINSTON_MASTER_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Winston-API-Key.")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _redis(request: Request) -> aioredis.Redis:
    return request.app.state.redis


def _hash_message(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


async def _get_budget(r: aioredis.Redis, project_id: str) -> float:
    """Return current budget for project_id, or raise 404 if unknown."""
    value = await r.get(f"budget:{project_id}")
    if value is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    return float(value)


async def _atomic_deduct(r: aioredis.Redis, project_id: str, amount: float) -> float:
    """
    Atomically check-and-deduct `amount` from the project budget via Lua.
    Raises 402 if balance would go negative, 404 if project doesn't exist.
    Returns the new balance.
    """
    try:
        new_balance = await r.eval(
            _DEDUCT_SCRIPT, 1, f"budget:{project_id}", str(amount)
        )
        return float(new_balance)
    except ResponseError as exc:
        msg = str(exc)
        if "NOT_FOUND" in msg:
            raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
        if "INSUFFICIENT" in msg:
            raise HTTPException(
                status_code=402,
                detail={"status": "denied", "reason": "Budget Exceeded"},
            )
        raise HTTPException(status_code=500, detail=f"Redis script error: {exc}") from exc


async def _atomic_deduct_session(
    r: aioredis.Redis, session_id: str, amount: float, limit: str
) -> float:
    """
    Atomically seed (if new) and deduct `amount` from a session ledger.
    `limit` is the raw header string — passed to Lua to seed SETNX.
    Raises 402 if session balance would go negative.
    Returns the new session balance.
    """
    try:
        new_balance = await r.eval(
            _SESSION_DEDUCT_SCRIPT, 1, f"session:{session_id}", str(amount), limit
        )
        return float(new_balance)
    except ResponseError as exc:
        msg = str(exc)
        if "INSUFFICIENT" in msg:
            raise HTTPException(
                status_code=402,
                detail={"status": "denied", "reason": "Session Limit Exceeded"},
            )
        raise HTTPException(status_code=500, detail=f"Redis script error: {exc}") from exc


async def _check_loop(r: aioredis.Redis, project_id: str, messages: list[dict]) -> bool:
    """
    Increment the per-(project, hash) counter in Redis with a 1-hour TTL.
    Returns True if the circuit breaker threshold has been reached.
    """
    last_user_content = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        None,
    )
    if not last_user_content:
        return False

    key = f"loop:{project_id}:{_hash_message(last_user_content)}"
    count = await r.incr(key)
    if count == 1:
        # Set TTL only on first creation to avoid resetting it on every call.
        await r.expire(key, LOOP_TTL)
    return count >= LOOP_TRIP_THRESHOLD


# ── Request models ────────────────────────────────────────────────────────────

class BudgetCheckRequest(BaseModel):
    project_id: str
    cost_estimate: float


class AdminBudgetSetRequest(BaseModel):
    project_id: str
    amount: float


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "Winston Proxy Active"}


@app.get("/health")
async def health(request: Request):
    try:
        await _redis(request).ping()
        redis_status = "ok"
    except RedisError:
        redis_status = "unavailable"
    return {"status": "ok", "redis": redis_status}


@app.get("/v1/admin/budgets", dependencies=[Depends(require_api_key)])
async def admin_list_budgets(request: Request):
    r = _redis(request)
    try:
        keys = await r.keys("budget:*")
        if not keys:
            return []
        values = await r.mget(*keys)
    except RedisError as exc:
        raise HTTPException(status_code=500, detail=f"State store unavailable: {exc}") from exc

    return [
        {"project_id": key.removeprefix("budget:"), "balance": float(val or 0)}
        for key, val in zip(keys, values)
    ]


@app.post("/v1/admin/budgets", dependencies=[Depends(require_api_key)])
async def admin_set_budget(req: AdminBudgetSetRequest, request: Request):
    r = _redis(request)
    try:
        await r.set(f"budget:{req.project_id}", str(req.amount))
    except RedisError as exc:
        raise HTTPException(status_code=500, detail=f"State store unavailable: {exc}") from exc
    return {"project_id": req.project_id, "balance": req.amount}


@app.post("/v1/budget/check", dependencies=[Depends(require_api_key)])
async def budget_check(req: BudgetCheckRequest, request: Request):
    r = _redis(request)
    try:
        new_balance = await _atomic_deduct(r, req.project_id, req.cost_estimate)
    except HTTPException:
        raise
    except RedisError as exc:
        raise HTTPException(status_code=500, detail=f"State store unavailable: {exc}") from exc
    return {"status": "allowed", "remaining": new_balance}


@app.post("/v1/chat/completions", dependencies=[Depends(require_api_key)])
async def chat_completions(request: Request):
    r = _redis(request)
    project_id = request.headers.get("X-Project-Id", "project_alpha")
    session_id = request.headers.get("X-Winston-Session-ID")
    session_limit = request.headers.get("X-Winston-Session-Limit", "")

    try:
        # ── 1. Pre-flight project budget check ────────────────────────────────
        balance = await _get_budget(r, project_id)
        if balance <= 0:
            raise HTTPException(
                status_code=402,
                detail={"status": "denied", "reason": "Budget Exceeded"},
            )

        # ── 2. Pre-flight session budget check (if session provided) ──────────
        if session_id:
            session_key = f"session:{session_id}"
            # If a limit header was supplied and the key is new, seed it.
            if session_limit:
                await r.setnx(session_key, session_limit)
            session_balance = await r.get(session_key)
            if session_balance is not None and float(session_balance) <= 0:
                raise HTTPException(
                    status_code=402,
                    detail={"status": "denied", "reason": "Session Limit Exceeded"},
                )

        body: dict = await request.json()
        messages: list[dict] = body.get("messages", [])

        # ── 3. Semantic loop detection ─────────────────────────────────────────
        if await _check_loop(r, project_id, messages):
            raise HTTPException(
                status_code=429,
                detail={"error": "Semantic Loop Detected. Circuit Breaker Tripped to save budget."},
            )

    except HTTPException:
        raise
    except RedisError as exc:
        raise HTTPException(status_code=500, detail=f"State store unavailable: {exc}") from exc

    # ── 4. Dynamic model routing ───────────────────────────────────────────────
    _COMPLEX_TRIGGERS = {"code", "script", "function", "system"}

    last_user_text = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    word_count = len(last_user_text.split())
    is_simple = (
        word_count < 40
        and not any(trigger in last_user_text.lower() for trigger in _COMPLEX_TRIGGERS)
    )

    if is_simple:
        original_model = body.get("model", "unknown")
        body["model"] = "claude-3-haiku-20240307"
        print(
            f"🚦 DYNAMIC ROUTING: Diverting simple request from "
            f"{original_model} to claude-3-haiku-20240307 to save budget.",
            flush=True,
        )

    # ── 5. Route via LiteLLM ───────────────────────────────────────────────────
    try:
        response = litellm.completion(**body)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Upstream LLM error: {exc}") from exc

    # ── 6. Deduct actual cost from project AND session ledgers ─────────────────
    # Best-effort: won't block the response on Redis failure.
    try:
        cost = litellm.completion_cost(completion_response=response)

        # Deduct from project — floor at 0 to prevent negative balances.
        new_project_balance = float(await r.incrbyfloat(f"budget:{project_id}", -cost))
        if new_project_balance < 0:
            await r.set(f"budget:{project_id}", "0.00")

        # Deduct from session ledger if one was provided.
        if session_id:
            new_session_balance = float(await r.incrbyfloat(f"session:{session_id}", -cost))
            if new_session_balance < 0:
                await r.set(f"session:{session_id}", "0.00")

    except (RedisError, Exception):
        pass  # Log and alert here in production; don't block the response.

    return JSONResponse(content=response.model_dump())
