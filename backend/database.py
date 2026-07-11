import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# override=True so the project's local backend/.env (the correct Supabase
# pooler URL) always wins over any stale DATABASE_URL inherited from the
# parent process environment.
load_dotenv(Path(__file__).parent / ".env", override=True)

DATABASE_URL = os.environ["DATABASE_URL"]
ASYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://").replace(
    "postgresql://", "postgresql+asyncpg://"
)

engine = create_async_engine(
    ASYNC_DATABASE_URL,
    pool_size=10,
    max_overflow=5,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=False,
    echo=False,
    connect_args={
        "statement_cache_size": 0,   # required for Supabase transaction pooler
        "command_timeout": 30,
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
