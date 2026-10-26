"""Where call recordings sent by third-party agents are kept. Private either way: files are served
only through short-lived signed URLs."""

from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path
from typing import Protocol

from .config import get_settings


class Storage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def signed_url(self, key: str, expires_in: int = 900) -> str: ...


def _sign(key: str, expires: int) -> str:
    secret = (get_settings().sched_jwt_secret or get_settings().internal_api_token).encode()
    return hmac.new(secret, f"{key}:{expires}".encode(), hashlib.sha256).hexdigest()


def verify_signature(key: str, expires: int, signature: str) -> bool:
    return expires > time.time() and hmac.compare_digest(_sign(key, expires), signature)


class LocalStorage:
    """Files on a private volume, served by GET /files/{key} with an expiring signature."""

    def __init__(self, root: str) -> None:
        self.root = Path(root)

    def path(self, key: str) -> Path:
        resolved = (self.root / key).resolve()
        if not resolved.is_relative_to(self.root.resolve()):
            raise ValueError("invalid storage key")
        return resolved

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def signed_url(self, key: str, expires_in: int = 900) -> str:
        expires = int(time.time()) + expires_in
        return f"/files/{key}?expires={expires}&sig={_sign(key, expires)}"


class S3Storage:
    """Private S3-compatible bucket (AWS S3, MinIO, R2); needs the `s3` extra (boto3)."""

    def __init__(self, bucket: str, endpoint_url: str | None, region: str | None) -> None:
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint_url or None, region_name=region or None)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        import asyncio

        await asyncio.to_thread(
            self.client.put_object, Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
            ServerSideEncryption="AES256",
        )

    def signed_url(self, key: str, expires_in: int = 900) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires_in
        )


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage(s.s3_bucket, s.s3_endpoint_url, s.s3_region) if s.storage_driver == "s3" else LocalStorage(s.artifacts_dir)
    return _storage
