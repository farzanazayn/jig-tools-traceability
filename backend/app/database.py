import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.schema import MetaData

# Loads DATABASE_URL / DB_SCHEMA from a local .env file (gitignored — never
# committed). See .env.example for the format. Same Postgres server/credentials
# as the Dummy Unit Traceability System, but a dedicated schema so tables never
# collide with that app's tables.
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Copy .env.example to .env and fill in the "
        "real connection string (do not commit .env)."
    )

DB_SCHEMA = os.getenv("DB_SCHEMA", "jigtools")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# All models below live under this schema (e.g. jigtools.jig_tools),
# fully separate from the dummy-unit app's tables in "public".
metadata = MetaData(schema=DB_SCHEMA)
Base = declarative_base(metadata=metadata)


def init_schema():
    with engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))
        conn.execute(text(f'CREATE SEQUENCE IF NOT EXISTS "{DB_SCHEMA}".jig_request_number_seq'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
