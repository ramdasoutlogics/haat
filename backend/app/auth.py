"""Sign in with Google (OAuth 2.0 / OpenID Connect, authorization code flow with PKCE).

Flow: /api/auth/google/login sends the browser to Google; Google sends it back to
/api/auth/google/callback, which finds or creates the user and sets a session cookie.
Sessions live in Redis (key = hash of the cookie value), so signing out ends them at once.
"""
import base64
import hashlib
import secrets
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import asyncpg
import httpx
import orjson
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from .config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}

SESSION_COOKIE = "haat_session"
STATE_COOKIE = "haat_oauth"
STATE_TTL = 600  # seconds the browser has to finish signing in at Google

router = APIRouter(prefix="/api/auth")


def _secure() -> bool:
    return settings.public_url.startswith("https://")


def _key(token: str) -> str:
    # Only a hash of the cookie is stored, so a Redis dump can't be used to sign in.
    return "sess:" + hashlib.sha256(token.encode()).hexdigest()


def _safe_next(path: Optional[str]) -> str:
    """Only allow going back to a page on this site after signing in."""
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path


# ---------- Who is signed in ----------

async def session_user(request: Request) -> Optional[int]:
    """The signed-in user's id, or None. Looked up once per request."""
    if hasattr(request.state, "user_id"):
        return request.state.user_id
    uid = None
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        raw = await request.app.state.cache.r.get(_key(token))
        uid = int(raw) if raw else None
    request.state.user_id = uid
    return uid


async def current_user(uid: Optional[int] = Depends(session_user)) -> int:
    """For endpoints that need someone signed in."""
    if uid is None:
        raise HTTPException(401, "Please sign in to continue")
    return uid


# ---------- Google ----------

def _configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def _redirect_uri() -> str:
    return settings.public_url.rstrip("/") + "/api/auth/google/callback"


def _back(next_path: str, error: Optional[str] = None) -> RedirectResponse:
    url = next_path
    if error:
        url += ("&" if "?" in url else "?") + urlencode({"signin_error": error})
    return RedirectResponse(url, status_code=303)


@router.get("/google/login")
async def google_login(request: Request, next: str = "/"):
    next_path = _safe_next(next)
    if not _configured():
        return _back(next_path, "Google sign-in isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    await request.app.state.cache.r.set(
        f"oauth:{state}", orjson.dumps({"verifier": verifier, "next": next_path}), ex=STATE_TTL)
    url = GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    })
    resp = RedirectResponse(url, status_code=303)
    # Ties the callback to this browser, so nobody can sign you in to their account (login CSRF).
    resp.set_cookie(STATE_COOKIE, state, max_age=STATE_TTL, httponly=True, secure=_secure(), samesite="lax",
                    path="/api/auth/google")
    return resp


def _id_claims(id_token: str) -> dict:
    """Read the ID token. It came straight from Google's token endpoint over TLS in exchange
    for our client secret, so its signature doesn't need checking (OpenID Connect Core 3.1.3.7)."""
    try:
        payload = id_token.split(".")[1]
        claims = orjson.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise ValueError("bad id_token")
    if claims.get("iss") not in GOOGLE_ISSUERS or claims.get("aud") != settings.google_client_id:
        raise ValueError("id_token not for this app")
    if claims.get("exp", 0) < time.time():
        raise ValueError("id_token expired")
    return claims


def _display_name(claims: dict) -> tuple[str, str]:
    """Marketplace style: first name and last initial ("Ram D."), plus avatar initials."""
    given = (claims.get("given_name") or "").strip()
    family = (claims.get("family_name") or "").strip()
    if not given:
        parts = (claims.get("name") or claims.get("email", "").split("@")[0] or "Haat user").split()
        given, family = parts[0], (parts[-1] if len(parts) > 1 else "")
    name = f"{given} {family[0]}." if family else given
    initials = (given[0] + (family[0] if family else given[1:2])).upper()
    return name[:60], initials


async def _find_or_create_user(db: asyncpg.Pool, claims: dict) -> int:
    sub = claims["sub"]
    email = (claims.get("email") or "").lower() if claims.get("email_verified") else None
    picture = claims.get("picture")
    async with db.acquire() as conn, conn.transaction():
        uid = await conn.fetchval("SELECT id FROM users WHERE google_sub = $1", sub)
        if uid is None and email and email == settings.demo_user_email.strip().lower():
            # This Google account takes over the demo user, with its listings, chats and bids.
            uid = await conn.fetchval(
                "UPDATE users SET google_sub = $1 WHERE id = $2 AND google_sub IS NULL RETURNING id",
                sub, settings.demo_user_id)
        if uid is None and email:
            # Same verified email as an existing account: link it instead of making a second one.
            uid = await conn.fetchval(
                "UPDATE users SET google_sub = $1 WHERE email = $2 AND google_sub IS NULL RETURNING id", sub, email)
        if uid is None:
            name, initials = _display_name(claims)
            uid = await conn.fetchval(
                """INSERT INTO users (name, initials, city, member_since, google_sub, email, avatar_url)
                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id""",
                name, initials, "Bengaluru", datetime.now(timezone.utc).year, sub, email, picture)
        else:
            await conn.execute(
                """UPDATE users SET email = COALESCE($2, email), avatar_url = COALESCE($3, avatar_url),
                   last_login_at = now() WHERE id = $1""", uid, email, picture)
    return uid


@router.get("/google/callback")
async def google_callback(request: Request, state: str = "", code: str = "", error: str = ""):
    r = request.app.state.cache.r
    saved = await r.getdel(f"oauth:{state}") if state else None
    flow = orjson.loads(saved) if saved else None
    next_path = flow["next"] if flow else "/"
    if not flow or not secrets.compare_digest(request.cookies.get(STATE_COOKIE, ""), state):
        return _back(next_path, "Sign-in expired. Please try again.")
    if error or not code:
        return _back(next_path, None if error == "access_denied" else "Google sign-in didn't finish. Please try again.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": flow["verifier"],
            })
        res.raise_for_status()
        claims = _id_claims(res.json()["id_token"])
    except (httpx.HTTPError, KeyError, ValueError):
        return _back(next_path, "Couldn't sign in with Google. Please try again.")

    uid = await _find_or_create_user(request.app.state.pool, claims)
    token = secrets.token_urlsafe(32)
    max_age = settings.session_days * 86400
    await r.set(_key(token), uid, ex=max_age)
    resp = _back(next_path)
    resp.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=_secure(), samesite="lax", path="/")
    resp.delete_cookie(STATE_COOKIE, path="/api/auth/google")
    return resp


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await request.app.state.cache.r.delete(_key(token))
    resp = Response(orjson.dumps({"ok": True}), media_type="application/json")
    resp.delete_cookie(SESSION_COOKIE, path="/", secure=_secure(), httponly=True, samesite="lax")
    return resp


@router.get("/session")
async def session(request: Request, uid: Optional[int] = Depends(session_user)):
    """Who is signed in (null when nobody). Cheap: one Redis read and one indexed row."""
    user = None
    if uid is not None:
        row = await request.app.state.pool.fetchrow(
            "SELECT id, name, initials, avatar_url FROM users WHERE id = $1", uid)
        user = dict(row) if row else None
    return Response(orjson.dumps({"user": user, "google": _configured()}), media_type="application/json")
