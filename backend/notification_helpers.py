"""
notification_helpers.py
Core send functions for Telegram and Web Push.
Both are called from scheduler.py with an active Flask app context.
"""
import json
import logging
import requests
from flask import current_app

log = logging.getLogger(__name__)


def send_telegram_message(chat_id: str, text: str) -> bool:
    """Send a plain HTML message to a Telegram user.
    Returns True on success, False on any error.
    """
    token = current_app.config.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        log.warning("TELEGRAM_BOT_TOKEN not configured — skipping Telegram send")
        return False
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if not resp.ok:
            log.error("Telegram API error %s: %s", resp.status_code, resp.text)
        return resp.ok
    except Exception as exc:
        log.error("Telegram send exception: %s", exc)
        return False


def send_push_notification(
    subscription_json: str,
    title: str,
    body: str,
    url: str = "/cabinet",
) -> bool | str:
    """Send a Web Push notification via VAPID.
    Returns:
        True      — sent successfully
        False     — transient error (retry later)
        "expired" — subscription is gone (410/404), caller should clear it
    """
    private_key = current_app.config.get("VAPID_PRIVATE_KEY", "")
    claims_email = current_app.config.get("VAPID_CLAIMS_EMAIL", "admin@dawaisathi.com")

    if not private_key:
        log.warning("VAPID_PRIVATE_KEY not configured — skipping push send")
        return False

    try:
        from pywebpush import webpush, WebPushException

        subscription = json.loads(subscription_json)
        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/pwa-192x192.png",
            "badge": "/pwa-192x192.png",
            "data": {"url": url},
        })

        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=private_key,
            vapid_claims={"sub": f"mailto:{claims_email}"},
        )
        return True

    except Exception as exc:
        # Check for WebPushException specifically
        if hasattr(exc, "response") and exc.response is not None:
            status = exc.response.status_code
            if status in (404, 410):
                log.info("Push subscription expired (status %s) — will clear", status)
                return "expired"
            log.error("Push send error (HTTP %s): %s", status, exc)
            return f"push_service_error_{status}"
        log.error("Push send error: %s", exc)
        return f"push_error_{type(exc).__name__}"
