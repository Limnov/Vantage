from typing import Literal
from pydantic import BaseModel, Field, field_validator


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    search_depth: Literal["basic", "advanced"] = "basic"
    topic: Literal["general", "news"] = "general"
    max_results: int = Field(default=8, ge=1, le=20)
    include_domains: list[str] = Field(default_factory=list)
    exclude_domains: list[str] = Field(default_factory=list)
    time_range: Literal["day", "week", "month", "year"] | None = None
    days: int | None = Field(default=None, ge=1, le=3650)
    country: str | None = None
    include_answer: bool = False
    include_raw_content: bool = False
    language: str = "auto"
    engines: list[str] | None = None

    @field_validator("include_domains", "exclude_domains")
    @classmethod
    def clean_domains(cls, value: list[str]) -> list[str]:
        out = []
        for item in value[:20]:
            d = item.strip().lower().removeprefix("https://").removeprefix("http://").strip("/")
            if d:
                out.append(d)
        return out


class ExtractRequest(BaseModel):
    urls: str | list[str]
    max_chars: int = Field(default=12000, ge=500, le=50000)
