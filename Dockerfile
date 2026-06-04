# Alternativa con Docker (no es obligatoria si usas render.yaml / Python nativo).
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Render/host inyecta el puerto en la variable $PORT (default 8000 en local).
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
