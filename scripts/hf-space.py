"""The demo's import service on a Hugging Face Space (see Dockerfile and apps/api/src/public.ts).

    python scripts/hf-space.py url      prints the Space's address
    python scripts/hf-space.py deploy   uploads the repo to the Space and waits until it answers

Needs HF_TOKEN (a write token). SPACE_NAME defaults to landing-page-harness.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi

api = HfApi(token=os.environ["HF_TOKEN"])
user = api.whoami()["name"]
repo_id = f"{user}/{os.environ.get('SPACE_NAME', 'landing-page-harness')}"

# The front matter is how Hugging Face knows to build the Dockerfile and which port it serves.
README = """---
title: Landing page harness import service
emoji: 🧭
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Reads a site's brand for the harness demo
---

The import service behind the [landing-page-harness](https://github.com/tywiththewifi/landing-page-harness) demo.
It opens a public site in a headless browser and hands the measured brand back once, keeping nothing.
Deployed from GitHub by `.github/workflows/import-service.yml`; changes made here are overwritten.
"""


def url() -> str:
    try:
        host = api.space_info(repo_id).host
        if host:
            return host
    except Exception:
        pass
    # Before the first deploy: Hugging Face's own rule for Space subdomains.
    return f"https://{re.sub(r'[^a-z0-9]+', '-', repo_id.lower().replace('/', '-'))}.hf.space"


def deploy() -> None:
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        # Committed files only, without the screenshots the image doesn't need.
        archive = subprocess.run(["git", "archive", "HEAD"], check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
        shutil.rmtree(Path(tmp, "docs", "screenshots"), ignore_errors=True)
        Path(tmp, "README.md").write_text(README)
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        # delete_patterns removes files that are gone from the repo; unchanged files aren't re-sent.
        api.upload_folder(folder_path=tmp, repo_id=repo_id, repo_type="space", commit_message=f"Deploy {sha}", delete_patterns=["*"])

    address = url()
    print(f"Uploaded to https://huggingface.co/spaces/{repo_id}, waiting for {address} to build")
    start = time.time()
    built = False
    while time.time() < start + 20 * 60:
        stage = api.get_space_runtime(repo_id).stage
        if stage in ("BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"):
            sys.exit(f"The Space failed ({stage}). See the logs at https://huggingface.co/spaces/{repo_id}")
        built = built or stage in ("BUILDING", "RUNNING_BUILDING", "APP_STARTING", "RUNNING_APP_STARTING")
        # Until the rebuild has started, a running Space is still the old version.
        # Two minutes without one means nothing changed. A sleeping Space wakes on the request.
        if stage in ("RUNNING", "SLEEPING") and (built or time.time() > start + 120):
            try:
                with urllib.request.urlopen(f"{address}/api/health", timeout=30) as res:
                    print(f"Running: {res.read().decode()}")
                    return
            except Exception:
                pass
        time.sleep(15)
    sys.exit("The Space didn't start within 20 minutes.")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "url":
        print(url())
    elif command == "deploy":
        deploy()
    else:
        sys.exit(__doc__)
