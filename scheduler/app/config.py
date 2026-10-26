from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # postgresql+asyncpg://… The same database as the web app; this service owns the `sched` schema.
    database_url: str = "postgresql+asyncpg://voice:voice@127.0.0.1:15432/voice"
    # Roles the service switches to after connecting (created by migration 0001). `sched_app` is
    # subject to row-level security; `sched_worker` bypasses it for cross-tenant jobs. Empty disables
    # the switch (only for databases where the connecting user can't SET ROLE).
    db_app_role: str = "sched_app"
    db_worker_role: str = "sched_worker"
    db_pool_size: int = 10

    redis_url: str = ""
    # Shared with the web app and the agent worker.
    internal_api_token: str = ""
    # Signs the short-lived tokens the web app's proxy sends for dashboard requests.
    sched_jwt_secret: str = ""
    # Same key as the web app (web/lib/crypto.ts): encrypts OAuth tokens at rest.
    encryption_key: str = ""
    session_secret: str = ""

    app_url: str = "http://localhost:3000"
    artifacts_dir: str = "/data/artifacts"
    # "local" or "s3".
    storage_driver: str = "local"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = ""

    # OAuth apps (same ones the web app uses for sign-in; see docs/integrations.md).
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    # Initial and periodic full sync cover now → this many days ahead.
    sync_horizon_days: int = 90
    # For automated end-to-end tests only: every Google endpoint (sign-in page, token, Calendar API)
    # served from this base URL by a fake.
    google_test_base_url: str = ""
    # Run background jobs in-process right after the request instead of through Redis
    # (tests and local development without a worker).
    inline_jobs: bool = False

    log_level: str = "INFO"
    log_json: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
