from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    searxng_url: str = "http://searxng:8080"
    redis_url: str = "redis://redis:6379/0"
    search_api_key: str = ""
    default_engines: str = "yahoo,yandex"
    search_timeout_seconds: float = 12.0
    fetch_timeout_seconds: float = 8.0
    cache_ttl_seconds: int = 300
    extract_cache_ttl_seconds: int = 1800
    max_results: int = 20
    max_concurrency: int = 8
    max_query_variants: int = 3
    max_advanced_tasks: int = 8
    max_results_per_domain: int = 2

    @property
    def engines(self) -> list[str]:
        return [x.strip() for x in self.default_engines.split(",") if x.strip()]


settings = Settings()
