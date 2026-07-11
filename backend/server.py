from fastapi import FastAPI, APIRouter, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone, timedelta

from database import get_db, engine, Base
from models import WaitlistEntry

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env", override=True)

BETA_ACCESS_CAP = 100  # Only the first 100 hitting 3+ referrals get beta access
REFERRALS_REQUIRED_FOR_BETA = 3

app = FastAPI()
api_router = APIRouter(prefix="/api")


@app.on_event("startup")
async def _ensure_schema():
    """Create the waitlist table in Supabase on boot if it doesn't exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------- Schemas ----------
class WaitlistCreate(BaseModel):
    email: EmailStr
    source: Optional[str] = "landing_hero"
    ref: Optional[str] = None  # referral_code of the referrer


class WaitlistResponse(BaseModel):
    id: str
    email: EmailStr
    base_position: int          # raw position by created_at
    position: int               # displayed position after referral bumps
    referral_code: str
    referral_count: int
    referrals_to_beta: int      # remaining referrals needed for beta
    beta_access: bool
    beta_slots_left: int        # remaining beta slots globally
    created_at: datetime
    already_joined: bool = False


class WaitlistStats(BaseModel):
    total: int
    displayed_count: int
    beta_claimed: int
    beta_slots_left: int


class LeaderboardEntry(BaseModel):
    rank: int
    handle: str            # privacy-masked (e.g. "al•••@g•••.com")
    referrals: int
    beta_access: bool


class LeaderboardResponse(BaseModel):
    window: str            # "7d" or "all"
    updated_at: datetime
    entries: List[LeaderboardEntry]


class WaitlistItem(BaseModel):
    id: str
    email: EmailStr
    source: Optional[str] = None
    referral_code: str
    referred_by_code: Optional[str] = None
    referral_count: int
    beta_access: bool
    position: int
    created_at: datetime


# ---------- Helpers ----------
async def _compute_position(db: AsyncSession, entry: WaitlistEntry) -> tuple[int, int]:
    """Returns (base_position, displayed_position). displayed = base - referral_count, min 1."""
    res = await db.execute(
        select(func.count(WaitlistEntry.id)).where(WaitlistEntry.created_at <= entry.created_at)
    )
    base = res.scalar_one() or 1
    displayed = max(1, base - entry.referral_count)
    return base, displayed


async def _beta_slots_left(db: AsyncSession) -> int:
    res = await db.execute(select(func.count(WaitlistEntry.id)).where(WaitlistEntry.beta_access.is_(True)))
    claimed = res.scalar_one() or 0
    return max(0, BETA_ACCESS_CAP - claimed)


async def _maybe_grant_beta(db: AsyncSession, entry: WaitlistEntry) -> None:
    """If entry has >= 3 referrals and beta slots remain, grant beta_access."""
    if entry.beta_access:
        return
    if entry.referral_count < REFERRALS_REQUIRED_FOR_BETA:
        return
    slots = await _beta_slots_left(db)
    if slots > 0:
        entry.beta_access = True
        await db.commit()
        await db.refresh(entry)


def _mask_email(email: str) -> str:
    """Privacy-mask an email: keep first 2 chars of local + first letter of domain + tld."""
    try:
        local, domain = email.split("@", 1)
    except ValueError:
        return "•••"
    lo = local[:2] if len(local) >= 2 else local
    # split domain into name + tld
    if "." in domain:
        dname, _, dtld = domain.partition(".")
    else:
        dname, dtld = domain, ""
    dn = dname[:1] if dname else ""
    tld = f".{dtld.split('.')[-1]}" if dtld else ""
    return f"{lo}•••@{dn}•••{tld}"


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"service": "Phasor API", "status": "online", "storage": "supabase"}


@api_router.post("/waitlist", response_model=WaitlistResponse)
async def join_waitlist(payload: WaitlistCreate, db: AsyncSession = Depends(get_db)):
    email_norm = payload.email.lower().strip()
    ref_code = (payload.ref or "").strip().upper() or None

    # Existing user path (repeat submit) — returns current position with referral bumps applied
    result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.email == email_norm))
    existing = result.scalar_one_or_none()
    if existing:
        base, displayed = await _compute_position(db, existing)
        slots = await _beta_slots_left(db)
        return WaitlistResponse(
            id=existing.id,
            email=existing.email,
            base_position=base,
            position=displayed,
            referral_code=existing.referral_code,
            referral_count=existing.referral_count,
            referrals_to_beta=max(0, REFERRALS_REQUIRED_FOR_BETA - existing.referral_count),
            beta_access=existing.beta_access,
            beta_slots_left=slots,
            created_at=existing.created_at,
            already_joined=True,
        )

    # Validate referrer if provided
    referrer: Optional[WaitlistEntry] = None
    if ref_code:
        r_res = await db.execute(select(WaitlistEntry).where(WaitlistEntry.referral_code == ref_code))
        referrer = r_res.scalar_one_or_none()

    entry = WaitlistEntry(
        email=email_norm,
        source=payload.source or "landing_hero",
        referred_by_code=referrer.referral_code if referrer else None,
    )
    db.add(entry)
    try:
        await db.commit()
        await db.refresh(entry)
    except IntegrityError:
        await db.rollback()
        result = await db.execute(select(WaitlistEntry).where(WaitlistEntry.email == email_norm))
        entry = result.scalar_one()

    # Award referrer +1 referral atomically (skips 1 spot)
    if referrer and referrer.id != entry.id:
        from sqlalchemy import update
        upd = (
            update(WaitlistEntry)
            .where(WaitlistEntry.id == referrer.id)
            .values(referral_count=WaitlistEntry.referral_count + 1)
            .returning(WaitlistEntry.referral_count, WaitlistEntry.beta_access)
        )
        rres = await db.execute(upd)
        row = rres.first()
        await db.commit()
        if row is not None:
            new_count, already_beta = row.referral_count, row.beta_access
            if not already_beta and new_count >= REFERRALS_REQUIRED_FOR_BETA:
                # Atomic conditional grant: only if under cap
                grant = (
                    update(WaitlistEntry)
                    .where(WaitlistEntry.id == referrer.id, WaitlistEntry.beta_access.is_(False))
                    .values(beta_access=True)
                )
                slots = await _beta_slots_left(db)
                if slots > 0:
                    await db.execute(grant)
                    await db.commit()

    base, displayed = await _compute_position(db, entry)
    slots = await _beta_slots_left(db)
    return WaitlistResponse(
        id=entry.id,
        email=entry.email,
        base_position=base,
        position=displayed,
        referral_code=entry.referral_code,
        referral_count=entry.referral_count,
        referrals_to_beta=max(0, REFERRALS_REQUIRED_FOR_BETA - entry.referral_count),
        beta_access=entry.beta_access,
        beta_slots_left=slots,
        created_at=entry.created_at,
        already_joined=False,
    )


@api_router.get("/waitlist/stats", response_model=WaitlistStats)
async def waitlist_stats(db: AsyncSession = Depends(get_db)):
    total_res = await db.execute(select(func.count(WaitlistEntry.id)))
    total = total_res.scalar_one() or 0
    beta_res = await db.execute(select(func.count(WaitlistEntry.id)).where(WaitlistEntry.beta_access.is_(True)))
    beta_claimed = beta_res.scalar_one() or 0
    baseline = 3127
    return WaitlistStats(
        total=total,
        displayed_count=baseline + total,
        beta_claimed=beta_claimed,
        beta_slots_left=max(0, BETA_ACCESS_CAP - beta_claimed),
    )


@api_router.get("/waitlist/lookup", response_model=WaitlistResponse)
async def lookup(code: str, db: AsyncSession = Depends(get_db)):
    """Look up a user's position by their referral_code (used for share-link tracking)."""
    code_norm = code.strip().upper()
    res = await db.execute(select(WaitlistEntry).where(WaitlistEntry.referral_code == code_norm))
    entry = res.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Referral code not found")
    base, displayed = await _compute_position(db, entry)
    slots = await _beta_slots_left(db)
    return WaitlistResponse(
        id=entry.id,
        email=entry.email,
        base_position=base,
        position=displayed,
        referral_code=entry.referral_code,
        referral_count=entry.referral_count,
        referrals_to_beta=max(0, REFERRALS_REQUIRED_FOR_BETA - entry.referral_count),
        beta_access=entry.beta_access,
        beta_slots_left=slots,
        created_at=entry.created_at,
        already_joined=True,
    )


@api_router.get("/waitlist/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(window: str = "7d", limit: int = 10, db: AsyncSession = Depends(get_db)):
    """Top referrers. window=7d counts only referred users created within last 7 days; window=all is all-time."""
    referrer = WaitlistEntry.__table__.alias("referrer")
    referred = WaitlistEntry.__table__.alias("referred")

    join_cond = referred.c.referred_by_code == referrer.c.referral_code
    if window == "7d":
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        join_cond = and_(join_cond, referred.c.created_at >= cutoff)

    stmt = (
        select(
            referrer.c.email,
            referrer.c.beta_access,
            func.count(referred.c.id).label("cnt"),
        )
        .select_from(referrer.outerjoin(referred, join_cond))
        .group_by(referrer.c.id, referrer.c.email, referrer.c.beta_access)
        .having(func.count(referred.c.id) > 0)
        .order_by(func.count(referred.c.id).desc(), referrer.c.email.asc())
        .limit(max(1, min(50, limit)))
    )
    result = await db.execute(stmt)
    rows = result.all()
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            handle=_mask_email(r.email),
            referrals=int(r.cnt),
            beta_access=bool(r.beta_access),
        )
        for i, r in enumerate(rows)
    ]
    return LeaderboardResponse(
        window=window if window in ("7d", "all") else "7d",
        updated_at=datetime.now(timezone.utc),
        entries=entries,
    )


@api_router.get("/waitlist/admin", response_model=List[WaitlistItem])
async def list_waitlist(token: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    admin_token = os.environ.get("ADMIN_TOKEN", "phasor-admin-dev")
    if token != admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    result = await db.execute(select(WaitlistEntry).order_by(WaitlistEntry.created_at.desc()).limit(1000))
    rows = result.scalars().all()
    out: List[WaitlistItem] = []
    for r in rows:
        base, displayed = await _compute_position(db, r)
        out.append(
            WaitlistItem(
                id=r.id,
                email=r.email,
                source=r.source,
                referral_code=r.referral_code,
                referred_by_code=r.referred_by_code,
                referral_count=r.referral_count,
                beta_access=r.beta_access,
                position=displayed,
                created_at=r.created_at,
            )
        )
    return out


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
