import asyncio
import hashlib
import ipaddress
import socket
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .config import settings

REMOVE = "script,style,noscript,svg,nav,header,footer,aside,form,dialog,.sidebar,.advertisement,.ad,.social,.share,.related,.recommended"


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            return False
    return True


def validate_public_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("only public http/https URLs are allowed")
    if not _public_host(parsed.hostname):
        raise ValueError("private or local network target is not allowed")
    return url


def extract_html(html: str, max_chars: int) -> dict:
    soup = BeautifulSoup(html, "lxml")
    for node in soup.select(REMOVE):
        node.decompose()

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    og_title = soup.select_one('meta[property="og:title"]')
    if og_title and og_title.get("content"):
        title = og_title["content"].strip()

    description = ""
    desc = soup.select_one('meta[name="description"],meta[property="og:description"]')
    if desc and desc.get("content"):
        description = desc["content"].strip()

    root = soup.find("article") or soup.find("main") or soup.body or soup
    chunks = []
    for node in root.find_all(["h1", "h2", "h3", "p", "li", "pre", "blockquote"]):
        text = " ".join(node.stripped_strings)
        if len(text) >= 20:
            chunks.append(text)

    content = "\n".join(chunks)
    if len(content) < 200:
        content = " ".join(root.stripped_strings)
    content = content[:max_chars]

    passages = []
    for start in range(0, len(content), 1000):
        # Offsets refer to the exact returned raw_content, including whitespace.
        passage = content[start:start + 1000]
        if passage.strip():
            passages.append({
                "start": start,
                "end": start + len(passage),
                "text": passage,
                "sha256": hashlib.sha256(passage.encode("utf-8")).hexdigest(),
            })

    published = None
    for selector in [
        'meta[property="article:published_time"]',
        'meta[name="date"]',
        "time[datetime]",
    ]:
        node = soup.select_one(selector)
        if node:
            published = node.get("content") or node.get("datetime")
            if published:
                break

    return {
        "title": title,
        "description": description,
        "raw_content": content,
        "published_date": published,
        "content_length": len(content),
        "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "passages": passages,
    }


async def fetch_and_extract(url: str, max_chars: int = 12000) -> dict:
    safe_url = await asyncio.to_thread(validate_public_url, url)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; VantageSearch/1.0; +https://github.com/Freakz2z)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    timeout = httpx.Timeout(settings.fetch_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, http2=True, headers=headers) as client:
        current = safe_url
        for _ in range(3):
            response = await client.get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    break
                next_url = str(httpx.URL(current).join(location))
                current = await asyncio.to_thread(validate_public_url, next_url)
                continue
            response.raise_for_status()
            ctype = response.headers.get("content-type", "").lower()
            if "text/html" not in ctype and "application/xhtml" not in ctype:
                raise ValueError(f"unsupported content-type: {ctype or 'unknown'}")
            data = extract_html(response.text, max_chars)
            return {
                "url": current,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                **data,
            }
        raise ValueError("too many redirects")
