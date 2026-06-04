# ConjointLab — Backend FastAPI + PostgreSQL + interfaz web

Herramienta para **diseñar, aplicar y analizar estudios de análisis conjoint**.
Incluye API REST + una interfaz web funcional con dashboards, editor de estudios,
generador de escenarios, encuesta con link compartible y panel de resultados con
exportación a CSV/Excel.

## Qué incluye

- **Login básico** (registro/inicio de sesión con token firmado).
- **Estudios**: crear/editar/eliminar, con atributos y categorías.
- **Generador de escenarios**: combinaciones aleatorias, una categoría por atributo,
  sin duplicados dentro de una pantalla y evitando repeticiones por entrevistado.
- **Encuesta pública**: link `/survey?study=<token>` que cualquiera puede responder
  sin cuenta. Guarda encuestado, pantallas mostradas y opción elegida.
- **Resultados**: % por categoría (suma 100% por atributo), tasa de preferencia,
  combinaciones más elegidas, ranking de categorías, **dashboards con gráficas**.
- **Exportación** a CSV y Excel (.xlsx con varias hojas).

## Requisitos

- Python 3.10+
- (Opcional) PostgreSQL. Sin él, usa SQLite automáticamente.

## Arranque rápido (SQLite, sin configurar nada)

```bash
cd conjoint
cp .env.example .env          # opcional; funciona sin él
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Abre **http://localhost:8000** → crea una cuenta → crea un estudio →
copia el "Link" de la encuesta y ábrelo en otra pestaña para responder →
vuelve a "Resultados".

(También puedes usar `bash run.sh`.)

## Usar PostgreSQL

1. Crea la base de datos:
   ```sql
   CREATE DATABASE conjoint;
   ```
2. En `.env`:
   ```
   DATABASE_URL=postgresql+psycopg2://usuario:password@localhost:5432/conjoint
   SECRET_KEY=una-clave-larga-y-secreta
   ```
3. Arranca igual que arriba. Las tablas se crean solas al iniciar.
   (Para migraciones versionadas en producción se recomienda Alembic.)

## Estructura

```
conjoint/
├── app/
│   ├── main.py            # app FastAPI + static
│   ├── database.py        # engine/sesión (Postgres o SQLite)
│   ├── models.py          # tablas: users, studies, attributes, categories,
│   │                      #         respondents, interactions, options, option_items
│   ├── schemas.py         # Pydantic
│   ├── auth.py            # hashing PBKDF2 + token firmado HMAC (sin deps externas)
│   ├── analytics.py       # generación de escenarios + cálculos
│   └── routers/
│       ├── auth.py        # /api/auth/*
│       ├── studies.py     # /api/studies/* (CRUD + preview de escenarios)
│       ├── survey.py      # /api/survey/* (público: start / submit)
│       └── results.py     # /api/studies/{id}/results, export.csv, export.xlsx
└── static/                # interfaz web (index.html, survey.html, app.js, survey.js, styles.css)
```

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` · `/login` | Crear cuenta / iniciar sesión |
| GET/POST | `/api/studies` | Listar / crear estudios |
| GET/PUT/DELETE | `/api/studies/{id}` | Ver / editar / eliminar |
| GET | `/api/studies/{id}/scenarios?count=` | Vista previa de combinaciones |
| GET | `/api/studies/{id}/results` | Cálculos de preferencia |
| GET | `/api/studies/{id}/export.csv` · `.xlsx` | Exportar |
| GET | `/api/survey/{token}/start` | Generar tareas para un encuestado |
| POST | `/api/survey/{token}/submit` | Guardar respuestas |

Documentación interactiva de la API en **http://localhost:8000/docs**.

## Notas de alcance (MVP)

- Cálculos = porcentajes/tasas de elección. Sin modelos avanzados (MNL,
  hierarchical Bayes, utilidades). Esos quedan como siguiente fase, igual que
  el simulador de escenarios y la segmentación por edad/sexo/municipio
  (los datos demográficos ya se capturan y guardan).
- La autenticación es deliberadamente simple para el MVP. Para producción
  considera bcrypt/argon2, JWT con expiración corta + refresh, y HTTPS.
```
