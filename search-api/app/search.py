import asyncio
import calendar
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from dateutil import parser as date_parser

from .config import settings
from .extract import fetch_and_extract
from .models import SearchRequest

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "source",
}
TRUSTED_DOMAINS = {
    "reuters.com": 1.0,
    "apnews.com": 1.0,
    "bbc.com": 0.95,
    "who.int": 1.0,
    "worldbank.org": 1.0,
    "oecd.org": 1.0,
    "github.com": 0.9,
    "docs.python.org": 0.95,
    "developer.mozilla.org": 0.95,
    "wikipedia.org": 0.82,
}
LOW_QUALITY_HINTS = (
    "pinterest.", "quora.com", "medium.com/tag/", "/tag/", "/search?", "login", "signin",
)
MARKET_REGIONS = {
    "东南亚": ("Southeast Asia", ("东南亚", "southeast asia")),
    "北美": ("North America", ("北美", "north america", "美国", "united states")),
    "美国": ("United States", ("美国", "united states", "u.s.", "usa")),
    "欧洲": ("Europe", ("欧洲", "europe", "european")),
    "中国": ("China", ("中国", "china", "chinese")),
}
MARKET_SECTORS = {
    "手机配件": ("mobile phone accessories", ("手机配件", "手机及附件", "phone accessories", "mobile accessories", "smartphone accessories"), "phone accessories import tariffs safety certification"),
    "便携储能": ("portable power station", ("便携储能", "便携式储能", "储能电源", "portable power station", "portable energy storage"), "portable power station UL 2743 safety certification"),
    "跨境物流": ("cross-border logistics", ("跨境物流", "cross-border logistics"), "cross-border logistics customs regulations"),
    "智能家居": ("smart home", ("智能家居", "smart home"), "smart home product safety regulations"),
    "户外装备": ("outdoor gear", ("户外装备", "outdoor gear", "outdoor equipment"), "outdoor gear import regulations"),
    "消费电子": ("consumer electronics", ("消费电子", "consumer electronics"), "consumer electronics safety regulations"),
}
OFFICIAL_PRODUCT_DOMAINS = (
    (("macbook", "iphone", "ipad", "airpods", "apple watch"), "apple.com"),
    (("jackery",), "jackery.com"),
    (("openrouter",), "openrouter.ai"),
    (("workbuddy",), "workbuddy.ai"),
)
MONTH_NUMBERS = {
    name.lower(): number
    for number, names in enumerate(calendar.month_name)
    if number
    for name in (names, calendar.month_abbr[number])
}
COUNTRY_EVIDENCE = {
    "canada": ("canada", "canadian", "ca."),
    "united states": ("united states", "usa", "u.s.", "us.", "/us/", "american"),
    "north america": ("north america", "united states", "canada", "usa", "u.s.", "us.", "ca."),
}


@dataclass(frozen=True)
class MarketFocus:
    sector: str
    region: str


def market_focus(query: str) -> MarketFocus | None:
    if not re.match(r"^(?:请|帮我)?(?:研究|分析一下|分析|调查)", query.strip()):
        return None
    if "市场" not in query:
        return None
    concise = re.sub(r"^(?:请|帮我)?(?:研究|分析一下|分析|调查)\s*", "", query.strip())
    concise = re.sub(r"(?:最近|过去|近)\s*\d{1,3}\s*(?:天|日|days?)", "", concise, count=1, flags=re.I)
    head = concise.split("市场", 1)[0].strip()
    region = next((name for name in MARKET_REGIONS if name in head), "")
    sector = head.replace(region, "").strip(" 在的、，, ")
    if not sector or len(sector) > 24:
        return None
    return MarketFocus(sector=sector, region=region)


def query_market_focus(query: str) -> MarketFocus | None:
    """Recognize known market sectors in Agent-generated phrase queries too."""
    focus = market_focus(query)
    if focus:
        return focus
    for sector in MARKET_SECTORS:
        if sector in query:
            region = next((name for name in MARKET_REGIONS if name in query), "")
            return MarketFocus(sector=sector, region=region)
    return None


def market_sector_info(focus: MarketFocus) -> tuple[str, tuple[str, ...], str] | None:
    for name, info in MARKET_SECTORS.items():
        if name in focus.sector:
            return info
    return None


def market_entity_matches(focus: MarketFocus, text: str) -> bool:
    info = market_sector_info(focus)
    if info is None:
        return True
    lowered = text.lower()
    if any(alias in lowered for alias in info[1]):
        return True
    return focus.sector == "手机配件" and "iphone" in lowered and (
        "配件" in lowered or "accessor" in lowered
    )


def market_region_matches(focus: MarketFocus, text: str) -> bool:
    if not focus.region:
        return True
    lowered = text.lower()
    if any(alias in lowered for alias in MARKET_REGIONS[focus.region][1]):
        return True
    return focus.region == "美国" and bool(re.search(r"\b(?:us|american)\b", lowered))


class SearchBackendError(RuntimeError):
    pass


def result_host(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def normalize_url(url: str) -> str:
    try:
        p = urlparse(url)
        clean_qs = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k.lower() not in TRACKING_PARAMS]
        path = re.sub(r"/+$", "", p.path) or "/"
        host = p.hostname.lower() if p.hostname else ""
        netloc = host
        if p.port and p.port not in (80, 443):
            netloc = f"{host}:{p.port}"
        return urlunparse((p.scheme.lower(), netloc, path, "", urlencode(clean_qs), ""))
    except Exception:
        return url


def _tokens(text: str) -> list[str]:
    latin = re.findall(r"[a-z0-9][a-z0-9._+-]*", text.lower())
    han = "".join(re.findall(r"[\u4e00-\u9fff]", text))
    han_parts = []
    if han:
        han_parts.extend(list(han))
        han_parts.extend(han[i:i+2] for i in range(len(han) - 1))
    return list(dict.fromkeys(latin + han_parts))


def lexical_score(query: str, title: str, snippet: str) -> float:
    q = query.strip().lower()
    text = f"{title} {snippet}".lower()
    if not q:
        return 0.0
    if q in text:
        return 1.0

    q_tokens = _tokens(q)
    if not q_tokens:
        return 0.0
    t_tokens = set(_tokens(text))
    coverage = sum(1 for token in q_tokens if token in t_tokens) / len(q_tokens)

    q_nums = numeric_tokens(q)
    if q_nums and not any(n in text for n in q_nums):
        return min(coverage, 0.12)

    title_tokens = set(_tokens(title))
    title_coverage = sum(1 for token in q_tokens if token in title_tokens) / len(q_tokens)
    return min(1.0, coverage * 0.72 + title_coverage * 0.28)


def numeric_tokens(query: str) -> list[str]:
    tokens = []
    for match in re.finditer(r"\b\d+[a-z0-9-]*\b", query.lower()):
        token = match.group()
        following = query[match.end():].lstrip().lower()
        if token.isdigit() and len(token) <= 3 and re.match(
            r"(?:天|日|周|月|年|小时|days?\b|weeks?\b|months?\b|hours?\b)",
            following,
        ):
            continue
        # A publication year may be absent from a search-result snippet even
        # when the result is the original paper. Keep model numbers strict.
        if token.isdigit() and 1900 <= int(token) <= datetime.now().year + 1:
            continue
        tokens.append(token)
    return tokens


def plan_retrieval_query(query: str) -> str:
    original = " ".join(query.split())
    focus = market_focus(original)
    if focus:
        return " ".join(part for part in (focus.sector, focus.region, "市场") if part)
    if not re.match(r"^(?:请|帮我)?(?:研究|分析一下|分析|调查)", original):
        return original

    concise = re.sub(r"^(?:请|帮我)?(?:研究|分析一下|分析|调查)\s*", "", original)
    concise = re.sub(r"(?:最近|过去|近)\s*\d{1,3}\s*(?:天|日|days?)", "", concise, count=1, flags=re.I)
    concise = re.split(r"[，。；]", concise, maxsplit=1)[0]
    concise = concise.replace("：", " ").replace("找一条", " ")
    concise = " ".join(concise.split()).strip()
    return concise or original


def site_constraint(query: str) -> tuple[str, str, str] | None:
    match = re.search(r"(?<!\S)site:([a-z0-9.-]+)(/[^\s]*)?", query, flags=re.I)
    if not match:
        return None
    host = match.group(1).lower().removeprefix("www.")
    if "." not in host or ".." in host:
        return None
    return match.group(0), host, (match.group(2) or "").lower().rstrip("/")


def latin_entity_query(query: str) -> str | None:
    if not re.search(r"[\u4e00-\u9fff]", query):
        return None
    terms = re.findall(r"[a-z][a-z0-9._+-]*|\b\d+[a-z0-9-]*\b", query, flags=re.I)
    generic = {"ai", "api", "llm", "rag", "github", "arxiv", "pdf", "paper", "blog", "docs"}
    if not any(len(term) >= 3 and term.lower() not in generic for term in terms):
        return None
    return " ".join(terms)


def domain_score(url: str) -> float:
    try:
        host = urlparse(url).hostname.lower()
    except Exception:
        return 0.35
    if not host:
        return 0.35

    for domain, score in TRUSTED_DOMAINS.items():
        if host == domain or host.endswith("." + domain):
            return score

    if host.endswith(".gov") or ".gov." in host:
        return 0.96
    if host.endswith(".edu") or ".edu." in host:
        return 0.9
    if host.endswith(".org"):
        return 0.67
    if any(hint in url.lower() for hint in LOW_QUALITY_HINTS):
        return 0.28
    return 0.52


def source_intent_boost(query: str, url: str) -> float:
    host = result_host(url)
    if re.search(r"\barxiv\b", query, flags=re.I) and host == "arxiv.org":
        return 0.1
    if re.search(r"\bgithub\b", query, flags=re.I) and host == "github.com":
        return 0.1
    return 0.0


def official_product_domain(query: str) -> str | None:
    lowered = query.lower()
    for aliases, domain in OFFICIAL_PRODUCT_DOMAINS:
        if any(alias in lowered for alias in aliases):
            return domain
    return None


def source_intent_multiplier(req: SearchRequest, item: dict) -> float:
    """Use broad source types; a recent report date is not a recent event."""
    title = item.get("title", "").lower()
    path = urlparse(item["url"]).path.lower()
    host = result_host(item["url"])
    multiplier = 1.0

    official = official_product_domain(req.query)
    if official and (host == official or host.endswith("." + official)):
        multiplier *= 1.16

    if re.search(r"\brecall\b|召回", req.query, flags=re.I) and (
        host.endswith(".gov") or ".gov." in host
    ):
        multiplier *= 1.16

    focus = query_market_focus(req.query)
    days = requested_days(req)
    asks_for_forecast = bool(re.search(
        r"forecast|projection|cagr|市场规模|市场预测|预测|复合增长率",
        req.query,
        flags=re.I,
    ))
    if focus and days and days <= 31 and not asks_for_forecast:
        forecast_title = bool(re.search(
            r"forecast|projection|cagr|market size|market report|203[0-9]|预测|市场规模",
            title,
            flags=re.I,
        ))
        if forecast_title:
            multiplier *= 0.68
        elif "/reports/" in path and "market" in title:
            multiplier *= 0.82
    if not focus and req.country:
        country = req.country.lower().replace("_", " ").strip()
        if country in ("ca", "加拿大"):
            country = "canada"
        elif country in ("us", "usa", "美国"):
            country = "united states"
        evidence = COUNTRY_EVIDENCE.get(country)
        candidate = f"{host} {title} {item.get('content', '').lower()} {path}"
        if evidence and not any(term in candidate for term in evidence):
            multiplier *= 0.82
    return multiplier


def model_variant_multiplier(query: str, title: str) -> float:
    """Keep Plus/Pro/Max variants distinct even when their numbers match."""
    normalized_query = query.lower()
    normalized_title = title.lower()
    match = re.search(r"\b(\d{1,5})\s+(plus|pro|max|ultra)\b", normalized_query)
    if not match:
        return 1.0
    number, variant = match.groups()
    exact = re.search(rf"\b{re.escape(number)}\s+{variant}\b", normalized_title)
    if not exact:
        return 0.72
    if variant == "pro" and "pro max" not in normalized_query and re.search(
        rf"\b{re.escape(number)}\s+pro\s+max\b", normalized_title
    ):
        return 0.7
    return 1.0


def source_format_multiplier(url: str, query: str) -> float:
    lowered_query = query.lower()
    if any(word in lowered_query for word in ("video", "youtube", "视频", "社媒")):
        return 1.0

    parsed = urlparse(url)
    host = result_host(url)
    path = parsed.path.lower()
    if official_product_domain(query) and re.search(r"(?:^|[-_/])(?:for[-_]?)?test(?:[-_/]|$)", path):
        return 0.55
    if host.endswith("tiktok.com") and (path.startswith("/@") or "/video/" in path):
        return 0.72
    if host.endswith("youtube.com") and path == "/watch":
        return 0.75
    if host.endswith("linkedin.com") and "/posts/" in path:
        return 0.75
    if host.endswith("facebook.com") and ("/groups/" in path or "/posts/" in path):
        return 0.75
    if query_market_focus(query):
        if host.endswith(("book118.com", "doc88.com")) or host == "wenku.baidu.com":
            return 0.62
        if host == "blog.csdn.net" or host.endswith(".accio.com"):
            return 0.72
    planned = plan_retrieval_query(query)
    latin_words = re.findall(r"[a-z0-9]+", planned.lower())
    han_chars = re.findall(r"[\u4e00-\u9fff]", planned)
    if path in ("", "/") and host.count(".") <= 1 and (
        len(latin_words) >= 3 or len(han_chars) >= 8
    ):
        return 0.78
    return 1.0


def freshness_score(value: str | None, topic: str) -> float:
    neutral = 0.48 if topic == "news" else 0.58
    if not value:
        return neutral
    try:
        dt = date_parser.parse(value)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        days = max(0.0, (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 86400)
    except Exception:
        return neutral

    half_life = 14 if topic == "news" else 180
    return max(0.08, math.exp(-math.log(2) * days / half_life))


def snippet_published_date(content: str) -> str | None:
    """Parse only a search-result date prefix, never an arbitrary body date."""
    match = re.match(r"^\s*([A-Z][a-z]{2,8}\s+\d{1,2},\s+20\d{2})\s*[·•]\s+", content)
    if not match:
        return None
    try:
        value = date_parser.parse(match.group(1), fuzzy=False).date()
        if value > datetime.now(timezone.utc).date():
            return None
        return value.isoformat()
    except (ValueError, OverflowError):
        return None


def build_query_variants(req: SearchRequest) -> list[str]:
    query = plan_retrieval_query(req.query)
    focus = query_market_focus(req.query)
    country = " ".join((req.country or "").split())
    search_query = query
    if country and country.lower() not in query.lower():
        search_query = f"{query} {country}"

    excluded = " ".join(f"-site:{d}" for d in req.exclude_domains[:5])
    if excluded:
        search_query = f"{search_query} {excluded}"

    variants = [search_query]

    # Some engines ignore site: on a long query. Search a shorter form while
    # enforcing the requested host (and optional path) on returned URLs.
    site = site_constraint(query)
    if req.search_depth == "advanced" and site:
        terms = query.replace(site[0], "", 1).split()
        if len(terms) > 6:
            variants.append(f"{site[0]} {' '.join(terms[:6])}")

    # Explicit include_domains should affect retrieval, not only post-filtering.
    # Otherwise a useful page can be filtered out simply because SearXNG did not
    # rank that domain highly enough in the first page of results.
    for domain in req.include_domains[:3]:
        variants.append(f"site:{domain} {query}")

    official = official_product_domain(req.query)
    if official and not req.include_domains and not site:
        variants.append(f"site:{official} {query}")

    # Mixed-language technical queries can lose the named paper or repository
    # when an engine tries to match every Chinese description word. Search the
    # explicit Latin names once as well, while keeping broad terms alone out.
    if req.search_depth == "advanced" and not focus:
        entity_query = latin_entity_query(query)
        if entity_query:
            variants.append(entity_query)

    if focus and not req.include_domains:
        # Let an explicit time window constrain retrieval; adding a year can
        # conflict with historical Agent query text and recall generic year pages.
        year = "" if effective_time_range(req) else str(datetime.now().year)
        info = market_sector_info(focus)
        if info:
            region = MARKET_REGIONS[focus.region][0] if focus.region else ""
            days = requested_days(req)
            recent = req.topic == "news" or (days is not None and days <= 31)
            evidence_terms = "market sales demand" if recent else "market"
            variants.append(" ".join(part for part in (info[0], region, evidence_terms, year) if part))
            variants.append(" ".join(part for part in (info[2], region, year) if part))
        else:
            variants.append(" ".join(part for part in (focus.sector, focus.region, "趋势", year) if part))
            variants.append(" ".join(part for part in (focus.sector, focus.region, "政策", "合规", year) if part))

    if req.search_depth == "advanced":
        stripped = re.sub(r"[？?！!，,。;；:：]+", " ", search_query)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        if stripped and stripped != search_query and not site:
            variants.append(stripped)

        freshness_words = ("最新", "recent", "latest", "today", "今年", "本周", "新闻", "news")
        if req.topic == "news" or any(word in query.lower() for word in freshness_words):
            year = str(datetime.now().year)
            if year not in search_query and not explicit_date_span(req.query):
                variants.append(f"{search_query} {year}")

    return list(dict.fromkeys(variants))[:settings.max_query_variants]


def build_search_tasks(req: SearchRequest) -> list[tuple[str, list[str]]]:
    """
    basic: one SearXNG aggregate request per query variant.
    advanced: use individual engines so RRF sees independent rankings without
    querying the same engines again through SearXNG's aggregate list.
    """
    variants = build_query_variants(req)
    engines = req.engines or settings.engines
    tasks: list[tuple[str, list[str]]] = []

    if req.search_depth == "basic":
        tasks.extend((variant, engines) for variant in variants)
    else:
        # Search the original query on every engine first. Give each extra
        # variant at least one engine before spending the remaining task budget.
        tasks.extend((variants[0], [engine]) for engine in engines)
        for index, variant in enumerate(variants[1:]):
            tasks.append((variant, [engines[index % len(engines)]]))
        for variant in variants[1:]:
            tasks.extend((variant, [engine]) for engine in engines)

    deduped = []
    seen = set()
    for query, selected_engines in tasks:
        key = (query, tuple(selected_engines))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((query, selected_engines))

    return deduped[:settings.max_advanced_tasks]


def requested_days(req: SearchRequest) -> int | None:
    if req.time_range:
        return {"day": 1, "week": 7, "month": 31, "year": 365}[req.time_range]
    days = req.days
    if not days:
        match = re.search(
            r"(?:最近|过去|近|last|past)\s*(\d{1,3})\s*(?:天|日|days?\b)",
            req.query,
            flags=re.I,
        )
        days = int(match.group(1)) if match else None
    return days


def explicit_date_span(query: str) -> tuple[date, date, str] | None:
    """Find an explicit calendar period, ignoring site: URL paths."""
    cleaned = re.sub(r"(?<!\S)site:\S+", " ", query, flags=re.I)
    calendar_date = re.search(
        r"(?<!\d)(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月\s*(?:(3[01]|[12]\d|0?[1-9])\s*日)?",
        cleaned,
    )
    if not calendar_date:
        calendar_date = re.search(
            r"(?<!\d)(20\d{2})[-/.](1[0-2]|0?[1-9])(?:[-/.](3[01]|[12]\d|0?[1-9]))?(?!\d)",
            cleaned,
        )
    if calendar_date:
        year, number = int(calendar_date.group(1)), int(calendar_date.group(2))
        day = calendar_date.group(3)
        if day:
            try:
                value = date(year, number, int(day))
                return value, value, calendar_date.group(0)
            except ValueError:
                pass
        last_day = calendar.monthrange(year, number)[1]
        return date(year, number, 1), date(year, number, last_day), calendar_date.group(0)

    named = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December|"
        r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(?:(3[01]|[12]\d|0?[1-9]),?\s+)?(20\d{2})\b",
        cleaned,
        flags=re.I,
    )
    if named:
        name = named.group(1).lower()
        number = 9 if name == "sept" else MONTH_NUMBERS[name]
        year = int(named.group(3))
        if named.group(2):
            try:
                value = date(year, number, int(named.group(2)))
                return value, value, named.group(0)
            except ValueError:
                pass
        return date(year, number, 1), date(year, number, calendar.monthrange(year, number)[1]), named.group(0)

    year_match = re.search(r"(?<!\d)(20\d{2})(?!\d)", cleaned)
    if year_match:
        year = int(year_match.group(1))
        return date(year, 1, 1), date(year, 12, 31), year_match.group(0)
    return None


def search_warnings(req: SearchRequest, result_count: int) -> list[dict[str, str]]:
    days = requested_days(req)
    if not days:
        return []
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days)
    period = explicit_date_span(req.query)
    if period and (period[1] < start or period[0] > today):
        return [{
            "code": "time_window_conflict",
            "message": f"Query period {period[2]} does not overlap the requested {days}-day window ({start} to {today}).",
            "suggested_action": "Review the explicit date or remove the relative time filter before retrying.",
        }]
    if result_count == 0:
        return [{
            "code": "no_results_in_time_window",
            "message": f"No results were found in the requested {days}-day window; this does not establish that the event does not exist.",
            "suggested_action": "Review the time window and retry without it if historical evidence is needed.",
        }]
    return []


def effective_time_range(req: SearchRequest) -> str | None:
    if req.time_range:
        return req.time_range
    days = requested_days(req)
    if not days:
        return None
    if days <= 1:
        return "day"
    if days <= 7:
        return "week"
    if days <= 31:
        return "month"
    return "year"


def date_within_request(value: str | None, req: SearchRequest) -> bool:
    """Reject only candidates with a detectable date outside the requested window."""
    days = requested_days(req)
    if not days or not value:
        return True
    try:
        published = date_parser.parse(value).date()
    except (ValueError, OverflowError, TypeError):
        return True
    delta = (datetime.now(timezone.utc).date() - published).days
    return -1 <= delta <= days


def domain_allowed(url: str, req: SearchRequest) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if req.include_domains and not any(host == d or host.endswith("." + d) for d in req.include_domains):
        return False
    if req.exclude_domains and any(host == d or host.endswith("." + d) for d in req.exclude_domains):
        return False
    site = site_constraint(req.query)
    if site:
        _, requested_host, requested_path = site
        normalized_host = host.removeprefix("www.")
        if normalized_host != requested_host and not normalized_host.endswith("." + requested_host):
            return False
        path = parsed.path.lower()
        if requested_path and path != requested_path and not path.startswith(requested_path + "/"):
            return False
    return True


async def search_searx(
    query: str,
    req: SearchRequest,
    engines: list[str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> list[dict]:
    if client is None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.search_timeout_seconds),
            http2=True,
        ) as owned_client:
            return await search_searx(query, req, engines, owned_client)

    selected_engines = engines or req.engines or settings.engines
    params = {
        "q": query,
        "format": "json",
        "language": req.language,
        "engines": ",".join(selected_engines),
        "safesearch": 0,
    }
    time_range = effective_time_range(req)
    if time_range:
        params["time_range"] = time_range

    response = await client.get(f"{settings.searxng_url.rstrip('/')}/search", params=params)
    response.raise_for_status()
    data = response.json()

    raw_results = data.get("results") or []

    # SearXNG can return a successful HTTP response while every requested
    # engine is unavailable. Treat that as a backend failure so callers can
    # distinguish outage from a legitimate zero-result query.
    if not raw_results:
        unresponsive = data.get("unresponsive_engines") or []
        failed_names = set()
        for entry in unresponsive:
            if isinstance(entry, str):
                failed_names.add(entry.split()[0].lower())
            elif isinstance(entry, (list, tuple)) and entry:
                failed_names.add(str(entry[0]).lower())
            elif isinstance(entry, dict):
                name = entry.get("engine") or entry.get("name")
                if name:
                    failed_names.add(str(name).lower())

        requested_names = {engine.lower() for engine in selected_engines}
        if requested_names and requested_names.issubset(failed_names):
            raise SearchBackendError(
                f"SearXNG engines unavailable: {', '.join(sorted(requested_names))}"
            )

        # One bounded spelling-correction retry can recover misspelled entity
        # queries without involving an LLM.
        suggestions = data.get("corrections") or data.get("suggestions") or []
        suggestion = suggestions[0] if suggestions else None
        if isinstance(suggestion, dict):
            suggestion = suggestion.get("text") or suggestion.get("query")
        if isinstance(suggestion, str) and suggestion.strip() and suggestion.strip() != query:
            retry_params = dict(params)
            retry_params["q"] = suggestion.strip()
            retry = await client.get(
                f"{settings.searxng_url.rstrip('/')}/search",
                params=retry_params,
            )
            retry.raise_for_status()
            data = retry.json()
            raw_results = data.get("results") or []

    output = []
    for rank, item in enumerate(raw_results, start=1):
        url = item.get("url") or ""
        if not url or not domain_allowed(url, req):
            continue
        engines_seen = item.get("engines") or ([item.get("engine")] if item.get("engine") else [])
        positions = item.get("positions") or []
        content = item.get("content") or item.get("description") or ""
        engine_date = item.get("publishedDate") or item.get("published_date")
        snippet_date = snippet_published_date(content) if not engine_date else None
        output.append({
            "title": item.get("title") or "",
            "url": url,
            "content": content,
            "published_date": engine_date or snippet_date,
            "published_date_source": "search_engine" if engine_date else ("search_snippet" if snippet_date else None),
            "engines": [e for e in engines_seen if e] or list(selected_engines),
            "positions": positions,
            "searx_score": float(item.get("score") or 0.0),
            "_rank": rank,
            "_variant_query": query,
        })
    return output


def fuse_results(groups: list[list[dict]], req: SearchRequest) -> list[dict]:
    merged: dict[str, dict] = {}
    rrf_scores = defaultdict(float)
    appearances = defaultdict(int)

    for group in groups:
        for rank, item in enumerate(group, start=1):
            key = normalize_url(item["url"])
            rrf_scores[key] += 1.0 / (60.0 + rank)
            appearances[key] += 1
            if key not in merged:
                merged[key] = dict(item)
            else:
                current = merged[key]
                current["engines"] = sorted(set(current.get("engines", [])) | set(item.get("engines", [])))
                if len(item.get("content", "")) > len(current.get("content", "")):
                    current["content"] = item["content"]
                if item.get("published_date") and (
                    not current.get("published_date")
                    or (current.get("published_date_source") == "search_snippet" and item.get("published_date_source") == "search_engine")
                ):
                    current["published_date"] = item["published_date"]
                    current["published_date_source"] = item.get("published_date_source")
                current["searx_score"] = max(current.get("searx_score", 0.0), item.get("searx_score", 0.0))

    if not merged:
        return []

    max_rrf = max(rrf_scores.values()) or 1.0
    max_appearances = max(appearances.values()) or 1

    ranked = []
    focus = query_market_focus(req.query)
    sector_info = market_sector_info(focus) if focus else None
    for key, item in merged.items():
        text = f"{item['title']} {item['content']}".lower()
        if not date_within_request(item.get("published_date"), req):
            continue
        if any(token not in text for token in numeric_tokens(req.query)):
            continue
        if focus and not market_entity_matches(focus, text):
            continue
        lexical_query = plan_retrieval_query(req.query)
        if focus and not market_focus(req.query):
            lexical_query = " ".join(part for part in (focus.sector, focus.region, "市场") if part)
        lexical = lexical_score(lexical_query, item["title"], item["content"])
        if req.search_depth == "advanced" and not focus:
            entity_query = latin_entity_query(req.query)
            if entity_query:
                url_words = re.sub(r"[./:]", " ", item["url"])
                lexical = max(lexical, 0.8 * lexical_score(entity_query, item["title"], f"{item['content']} {url_words}"))
        if sector_info:
            english_query = " ".join(
                part for part in (
                    sector_info[0],
                    MARKET_REGIONS[focus.region][0] if focus.region else "",
                ) if part
            )
            lexical = max(lexical, lexical_score(english_query, item["title"], item["content"]))
        fusion = rrf_scores[key] / max_rrf
        diversity = min(1.0, len(item.get("engines", [])) / 3)
        repeat = appearances[key] / max_appearances
        source = domain_score(item["url"])
        # Snippet prefix dates are useful metadata but too weak to influence ranking.
        fresh = freshness_score(
            item.get("published_date") if item.get("published_date_source") != "search_snippet" else None,
            req.topic,
        )
        upstream = min(1.0, math.log1p(max(0.0, item.get("searx_score", 0.0))) / math.log(4))

        score = (
            lexical * 0.34
            + fusion * 0.22
            + diversity * 0.12
            + repeat * 0.08
            + source * 0.11
            + fresh * 0.08
            + upstream * 0.05
            + source_intent_boost(req.query, item["url"])
        )

        if lexical < 0.08:
            score *= 0.62
        if focus and not market_entity_matches(focus, item["title"]):
            score *= 0.76
        if focus and not market_region_matches(focus, text):
            score *= 0.72
        score *= source_format_multiplier(item["url"], req.query)
        score *= source_intent_multiplier(req, item)
        score *= model_variant_multiplier(req.query, item["title"])
        item["score"] = round(max(0.0, min(1.0, score)), 4)
        item["_signals"] = {
            "lexical": round(lexical, 4),
            "fusion": round(fusion, 4),
            "engine_diversity": round(diversity, 4),
            "freshness": round(fresh, 4),
            "source_quality": round(source, 4),
        }
        ranked.append(item)

    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked


def diversify_results(results: list[dict], limit: int, max_per_domain: int | None = None) -> list[dict]:
    """
    Keep the best result from each domain before admitting repeats.
    This prevents a single publisher or marketplace from occupying the whole top-N.
    """
    if limit <= 0:
        return []

    domain_cap = max(1, max_per_domain or settings.max_results_per_domain)
    selected: list[dict] = []
    selected_ids = set()
    domain_counts = defaultdict(int)

    for pass_cap in range(1, domain_cap + 1):
        for item in results:
            if len(selected) >= limit:
                return selected
            identity = normalize_url(item.get("url", ""))
            if not identity or identity in selected_ids:
                continue
            host = result_host(item.get("url", ""))
            if domain_counts[host] >= pass_cap:
                continue
            selected.append(item)
            selected_ids.add(identity)
            domain_counts[host] += 1

    # If the requested result count is larger than the domain cap can satisfy,
    # fill with the remaining globally-ranked items.
    for item in results:
        if len(selected) >= limit:
            break
        identity = normalize_url(item.get("url", ""))
        if identity and identity not in selected_ids:
            selected.append(item)
            selected_ids.add(identity)

    return selected


async def run_search(req: SearchRequest) -> list[dict]:
    tasks = build_search_tasks(req)
    semaphore = asyncio.Semaphore(settings.max_concurrency)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.search_timeout_seconds),
        http2=True,
    ) as client:
        async def execute(query: str, engines: list[str]):
            async with semaphore:
                return await search_searx(query, req, engines, client)

        settled = await asyncio.gather(
            *(execute(query, engines) for query, engines in tasks),
            return_exceptions=True,
        )
    valid_groups = [group for group in settled if isinstance(group, list)]
    failures = [error for error in settled if isinstance(error, Exception)]

    if not valid_groups and failures:
        raise SearchBackendError(f"all SearXNG search tasks failed ({len(failures)} failures)")

    ranked = fuse_results(valid_groups, req)

    take = min(req.max_results, settings.max_results)
    chosen = diversify_results(ranked, take)

    if req.include_raw_content and chosen:
        semaphore = asyncio.Semaphore(settings.max_concurrency)

        async def enrich(item: dict) -> dict:
            async with semaphore:
                try:
                    extracted = await fetch_and_extract(item["url"])
                    item["raw_content"] = extracted.get("raw_content") or None
                    if extracted.get("published_date") and (
                        not item.get("published_date") or item.get("published_date_source") == "search_snippet"
                    ):
                        item["published_date"] = extracted["published_date"]
                        item["published_date_source"] = "page_metadata"
                    if extracted.get("description") and len(item.get("content", "")) < 80:
                        item["content"] = extracted["description"]
                except Exception:
                    item["raw_content"] = None
                return item

        chosen = await asyncio.gather(*(enrich(dict(item)) for item in chosen))
        chosen = [item for item in chosen if date_within_request(item.get("published_date"), req)]

    for item in chosen:
        item.pop("_rank", None)
        item.pop("_variant_query", None)
        item.pop("_signals", None)
        item.pop("positions", None)
        item["snippet"] = item.get("content", "")[:500]

    return chosen
