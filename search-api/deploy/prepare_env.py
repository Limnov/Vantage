"""Create persistent deployment secrets without printing them."""

import os
import secrets
from pathlib import Path


env_path = Path(".env")
source = env_path if env_path.exists() else Path(".env.example")
lines = source.read_text(encoding="utf-8").splitlines()

for key in ("SEARCH_API_KEY", "SEARXNG_SECRET"):
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            value = line.partition("=")[2].strip().strip("\"'")
            if not value:
                lines[index] = f"{key}={secrets.token_hex(32)}"
            break
    else:
        lines.append(f"{key}={secrets.token_hex(32)}")

if env_path.exists():
    os.chmod(env_path, 0o600)
fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as output:
    output.write("\n".join(lines) + "\n")
os.chmod(env_path, 0o600)
print("Deployment environment is ready")
