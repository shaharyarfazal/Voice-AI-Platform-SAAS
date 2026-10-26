FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
# Dependencies are installed before the code is copied, so code changes don't reinstall them.
RUN python -c 'import tomllib,subprocess,sys; p=tomllib.load(open("pyproject.toml","rb"))["project"]; subprocess.check_call([sys.executable,"-m","pip","install","--no-cache-dir",*p["dependencies"]])'

FROM base AS dev
RUN python -c 'import tomllib,subprocess,sys; p=tomllib.load(open("pyproject.toml","rb"))["project"]; subprocess.check_call([sys.executable,"-m","pip","install","--no-cache-dir",*p["optional-dependencies"]["dev"]])'
COPY . .

FROM base AS prod
COPY . .
RUN useradd --system --uid 10001 app && mkdir -p /data/artifacts && chown app /data/artifacts
USER app
EXPOSE 8100
# The API runs migrations before starting; the worker runs `arq app.worker.settings.WorkerSettings`.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host ${HOST:-127.0.0.1} --port ${PORT:-8100}"]
