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
    # Sign in with Google
    public_url: str = "http://localhost:3000"  # address people open the site at; Google sends them back here
    google_client_id: str = ""
    google_client_secret: str = ""
    session_days: int = 30
    # The Google account with this email takes over the demo user (DEMO_USER_ID) and its data on first sign-in.
    demo_user_email: str = ""
    demo_user_id: int = 1


settings = Settings()
