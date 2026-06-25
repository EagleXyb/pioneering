from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:root@localhost:5432/pioneering"

    jwt_secret: str = "default-secret-change-in-production"
    jwt_expiration_hours: int = 2
    refresh_token_expiration_days: int = 30

    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_default_model: str = "deepseek-v4-flash"

    host: str = "0.0.0.0"
    port: int = 3000
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    upload_dir: str = "./uploads"
    max_upload_size: int = 10 * 1024 * 1024  # 10MB

    log_dir: str = "./logs"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "case_sensitive": False}


settings = Settings()