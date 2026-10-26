"""AES-256-GCM for secrets at rest (OAuth tokens). Byte-for-byte compatible with web/lib/crypto.ts:
"v1.<iv>.<tag>.<ciphertext>" (base64url), key = SHA-256(ENCRYPTION_KEY or "secrets:" + SESSION_SECRET),
so either service can read what the other wrote. A KMS-wrapped data key can replace the static key
later without changing callers."""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import get_settings


def _key() -> bytes:
    settings = get_settings()
    source = settings.encryption_key or f"secrets:{settings.session_secret}"
    if source == "secrets:":
        raise RuntimeError("ENCRYPTION_KEY is not set")
    return hashlib.sha256(source.encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def encrypt(plaintext: str) -> str:
    iv = os.urandom(12)
    sealed = AESGCM(_key()).encrypt(iv, plaintext.encode(), None)
    data, tag = sealed[:-16], sealed[-16:]
    return ".".join(["v1", _b64(iv), _b64(tag), _b64(data)])


def decrypt(token: str) -> str:
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v1":
        raise ValueError("Unreadable secret")
    _, iv, tag, data = parts
    return AESGCM(_key()).decrypt(_unb64(iv), _unb64(data) + _unb64(tag), None).decode()
