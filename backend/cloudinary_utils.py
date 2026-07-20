"""Cloudinary upload helpers — never use ephemeral local disk in production."""
from __future__ import annotations

import os

from flask import current_app


class CloudinaryUploadError(Exception):
    """Raised when CDN upload fails or Cloudinary is not configured for production."""


def is_production() -> bool:
    if os.environ.get("RENDER") == "true":
        return True
    env = (os.environ.get("FLASK_ENV") or current_app.config.get("ENV") or "").lower()
    return env == "production"


def upload_image_bytes(image_bytes: bytes, folder: str = "dawaisathi") -> str:
    """
    Upload image bytes to Cloudinary and return the secure HTTPS URL.

    In production: requires CLOUDINARY_URL and fails hard on error (no /uploads fallback).
    In local dev: still prefers Cloudinary; only if unset may raise so callers decide.
    """
    cloudinary_url = current_app.config.get("CLOUDINARY_URL") or os.environ.get("CLOUDINARY_URL", "")
    if not cloudinary_url:
        if is_production():
            raise CloudinaryUploadError(
                "CLOUDINARY_URL is not configured. Set it on Render — local disk is not used in production."
            )
        # Local Development Fallback: Save image to local uploads folder
        import uuid
        filename = f"local_{uuid.uuid4().hex}.jpg"
        upload_dir = current_app.config["UPLOAD_FOLDER"]
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)
        try:
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            return f"/uploads/{filename}"
        except Exception as e:
            current_app.logger.error(f"Local file write error: {e}")
            raise CloudinaryUploadError(f"Failed to write file locally: {e}") from e

    import cloudinary
    import cloudinary.uploader

    # Ensure SDK picks up env; also set explicitly if needed
    if not os.environ.get("CLOUDINARY_URL"):
        os.environ["CLOUDINARY_URL"] = cloudinary_url

    try:
        # Parse cloudinary://key:secret@cloud for reliability
        rest = cloudinary_url.split("://", 1)[1]
        creds, cloud_name = rest.rsplit("@", 1)
        api_key, api_secret = creds.split(":", 1)
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True,
        )
        result = cloudinary.uploader.upload(image_bytes, folder=folder)
        url = result.get("secure_url")
        if not url:
            raise CloudinaryUploadError("Cloudinary returned no secure_url")
        return url
    except CloudinaryUploadError:
        raise
    except Exception as e:
        current_app.logger.error(f"Cloudinary upload error: {e}")
        raise CloudinaryUploadError(str(e)) from e
