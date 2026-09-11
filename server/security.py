"""Password derivation and opaque sessions use separate random secrets."""
import hashlib
import hmac
import re
import secrets

from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


def _derive(password, salt):
    # Apple's Python/OpenSSL build may omit hashlib.scrypt. The portable KDF
    # keeps the same scrypt parameters and stored format on macOS and Linux.
    return Scrypt(salt=salt, length=32, n=16384, r=8, p=1).derive(password.encode("utf-8"))


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _derive(password, salt)
    return "scrypt$16384$8$1$" + salt.hex() + "$" + digest.hex()


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt" or (n, r, p) != ("16384", "8", "1"):
            return False
        actual = _derive(password, bytes.fromhex(salt))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError, OverflowError):
        return False


def digest_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_email(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Enter a valid email address.")
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise ValueError("Enter a valid email address.")
    return value


def validate_password(value: object) -> str:
    if not isinstance(value, str) or not 12 <= len(value) <= 128:
        raise ValueError("Use a password of 12 to 128 characters.")
    return value


def clean_name(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 100 or any(ord(c) < 32 for c in value):
        raise ValueError("Enter a name of 1 to 100 characters.")
    return value.strip()
