"""All settings come from environment variables (or the .env file)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql://haat:haat@localhost:5432/haat"
    redis_url: str = "redis://localhost:6379/0"
    db_pool_min: int = 5
    db_pool_max: int = 20
    cache_ttl_seconds: int = 60
    cors_origins: str = "*"
    cdn_url: str = ""  # e.g. https://cdn.example.com; images are served from here when set
    demo_user_id: int = 1  # signed-in user until login is added


settings = Settings()
