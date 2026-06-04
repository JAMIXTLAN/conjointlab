"""Punto de entrada de la aplicación ConjointLab."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import Base, engine
from . import models  # noqa: F401  (registra los modelos)
from .routers import auth as auth_router, studies, survey, results

# Crea las tablas si no existen (para Postgres en producción usa Alembic).
Base.metadata.create_all(bind=engine)

app = FastAPI(title="ConjointLab API", version="1.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(studies.router)
app.include_router(survey.router)
app.include_router(results.router)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/survey")
def survey_page():
    return FileResponse(os.path.join(STATIC_DIR, "survey.html"))


@app.get("/health")
def health():
    return {"status": "ok"}


# sirve css/js
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
