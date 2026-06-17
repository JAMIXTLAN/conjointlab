"""Conexión a la base de datos.

Usa DATABASE_URL si está definida (ej. PostgreSQL en producción).
Si no, cae a un archivo SQLite local para poder correr al instante.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./conjoint.db",  # fallback para desarrollo local
)

# Render (y otros) entregan la URL como "postgres://..." o "postgresql://...".
# SQLAlchemy 2.0 + psycopg2 requiere el prefijo "postgresql+psycopg2://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+psycopg2" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# SQLite necesita este flag con FastAPI (varios hilos).
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_columns():
    """Agrega columnas nuevas a tablas existentes sin perder datos.

    create_all() no altera tablas ya creadas; esto cubre ese hueco en bases
    que ya estaban desplegadas. Es idempotente y tolera errores por columna.
    """
    from sqlalchemy import inspect, text
    wanted = {
        "studies": {"profile_config": "TEXT", "has_conjoint": "BOOLEAN DEFAULT TRUE"},
        "respondents": {
            "operator": "VARCHAR", "sex": "VARCHAR", "age_group": "VARCHAR",
            "occupation": "VARCHAR", "education": "VARCHAR", "municipality": "VARCHAR",
            "district": "VARCHAR", "electoral_section": "VARCHAR",
            "locality_zone": "VARCHAR", "age": "VARCHAR",
        },
    }
    insp = inspect(engine)
    tables = insp.get_table_names()
    for table, cols in wanted.items():
        if table not in tables:
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for col, typ in cols.items():
            if col in have:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
            except Exception:
                pass  # best-effort: si falla una, seguimos con las demás
