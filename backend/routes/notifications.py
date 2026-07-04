"""
routes/notifications.py
All API endpoints for the notification system:
  - Timezone sync
  - Notification settings (slots + custom times)
  - Telegram linking flow (code generation + webhook + status poll)
  - Web Push subscription management + test send
  - Utility: manually re-register Telegram webhook URL
"""
import json
import random
import logging
import requests
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, current_app
from extensions import db
from models import User, TelegramLinkCode, PushSubscription
from routes.auth import get_current_user

log = logging.getLogger(__name__)
notifications_bp = Blueprint("notifications", __name__)

VALID_SLOTS = {"morning", "afternoon", "evening", "night"}
DEFAULT_TIMES = {
    "morning":   "08:00",
    "afternoon": "13:00",
    "evening":   "18:00",
    "night":     "22:00",
}


# ── Timezone Sync ──────────────────────────────────────────────────────────────

@notifications_bp.route("/api/notifications/timezone", methods=["POST"])
def sync_timezone():
    """Called automatically on app load to keep the user's timezone current."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    try:
        offset = int(data.get("tz_offset", 0))
    except (TypeError, ValueError):
        offset = 0
    user.timezone_offset = offset
    db.session.commit()
    return jsonify({"ok": True})


# ── Settings ───────────────────────────────────────────────────────────────────

@notifications_bp.route("/api/notifications/settings", methods=["GET"])
def get_settings():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    slots = json.loads(user.notif_slots_json) if user.notif_slots_json else list(DEFAULT_TIMES.keys())
    times = json.loads(user.notif_times_json) if user.notif_times_json else DEFAULT_TIMES

    return jsonify({
        "telegram_linked": user.telegram_chat_id is not None,
        "push_enabled": PushSubscription.query.filter_by(user_id=user.id).count() > 0,
        "slots": slots,
        "times": times,
    })


@notifications_bp.route("/api/notifications/settings", methods=["POST"])
def update_settings():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}

    if "slots" in data:
        cleaned = [s for s in data["slots"] if s in VALID_SLOTS]
        user.notif_slots_json = json.dumps(cleaned)

    if "times" in data:
        times: dict[str, str] = {}
        for slot, val in data["times"].items():
            if slot not in VALID_SLOTS:
                continue
            try:
                h, m = map(int, str(val).split(":"))
                if 0 <= h <= 23 and 0 <= m <= 59:
                    times[slot] = f"{h:02d}:{m:02d}"
            except Exception:
                pass
        user.notif_times_json = json.dumps(times)

    db.session.commit()
    return jsonify({"ok": True})


# ── Telegram: generate link code ───────────────────────────────────────────────

@notifications_bp.route("/api/notifications/telegram/code", methods=["GET"])
def get_telegram_code():
    """Generate a 6-digit code the user will send to the bot to link their account."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    # Expire/remove old unused codes for this user
    TelegramLinkCode.query.filter_by(user_id=user.id, used=False).delete()
    db.session.flush()

    # Generate a unique 6-digit code
    for _ in range(10):
        code = "".join(str(random.randint(0, 9)) for _ in range(6))
        if not TelegramLinkCode.query.filter_by(code=code).first():
            break

    link = TelegramLinkCode(
        code=code,
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.session.add(link)
    db.session.commit()

    # Try to resolve the bot's username for the deep link
    token = current_app.config.get("TELEGRAM_BOT_TOKEN", "")
    bot_username = "DawaiSathiBot"  # fallback
    if token:
        try:
            resp = requests.get(
                f"https://api.telegram.org/bot{token}/getMe", timeout=5
            )
            if resp.ok:
                bot_username = resp.json().get("result", {}).get("username", bot_username)
        except Exception:
            pass

    return jsonify({
        "code": code,
        "bot_username": bot_username,
        "expires_in_minutes": 10,
    })


@notifications_bp.route("/api/notifications/telegram/status", methods=["GET"])
def telegram_status():
    """Polling endpoint: frontend polls this to detect when linking succeeds."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"linked": user.telegram_chat_id is not None})


@notifications_bp.route("/api/notifications/telegram/unlink", methods=["POST"])
def unlink_telegram():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    user.telegram_chat_id = None
    db.session.commit()
    return jsonify({"ok": True})


# ── Telegram: bot webhook ─────────────────────────────────────────────────────

@notifications_bp.route("/api/telegram/webhook", methods=["POST"])
def telegram_webhook():
    """
    Receives all inbound messages/updates from Telegram servers.
    No authentication is required here (Telegram sends a secret token in the URL
    in production, but for simplicity we rely on the unpredictable endpoint URL).
    """
    data = request.get_json(silent=True) or {}
    message = data.get("message", {})
    if not message:
        return jsonify({"ok": True})

    chat_id = str(message.get("chat", {}).get("id", ""))
    text = message.get("text", "").strip()

    if not chat_id:
        return jsonify({"ok": True})

    def _reply(msg: str) -> None:
        token = current_app.config.get("TELEGRAM_BOT_TOKEN", "")
        if not token:
            return
        try:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": msg, "parse_mode": "HTML"},
                timeout=10,
            )
        except Exception:
            pass

    # /start command
    if text == "/start":
        _reply(
            "👋 Welcome to <b>DawaiSathi</b>!\n\n"
            "To receive medicine reminders here:\n"
            "1. Open the DawaiSathi app\n"
            "2. Go to <b>Notifications</b> (🔔 in the header)\n"
            "3. Tap <b>Link Telegram</b>\n"
            "4. Send me the 6-digit code shown there\n\n"
            "💊 <i>Stay healthy!</i>"
        )
        return jsonify({"ok": True})

    # 6-digit link code
    if text.isdigit() and len(text) == 6:
        link_code = TelegramLinkCode.query.filter_by(code=text, used=False).first()

        if not link_code:
            _reply("❌ Invalid or expired code. Please generate a new one from the DawaiSathi app.")
            return jsonify({"ok": True})

        if datetime.utcnow() > link_code.expires_at:
            link_code.used = True
            db.session.commit()
            _reply("⏰ This code has expired. Please generate a fresh one from the app.")
            return jsonify({"ok": True})

        # Link the user's account
        target_user = User.query.get(link_code.user_id)
        if target_user:
            target_user.telegram_chat_id = chat_id
            link_code.used = True
            db.session.commit()
            _reply(
                f"✅ <b>Linked successfully!</b>\n\n"
                f"Hi {target_user.name}! 👋\n"
                f"You'll now get medicine reminders here.\n\n"
                f"Send /stop anytime to unlink."
            )
        else:
            _reply("❌ Something went wrong. Please try again.")
        return jsonify({"ok": True})

    # /stop command — unlink
    if text.lower() in ("/stop", "/unlink"):
        user_to_unlink = User.query.filter_by(telegram_chat_id=chat_id).first()
        if user_to_unlink:
            user_to_unlink.telegram_chat_id = None
            db.session.commit()
            _reply("✅ Unlinked. You won't receive reminders here anymore.\nSend /start to re-link.")
        else:
            _reply("You're not currently linked to any account.")
        return jsonify({"ok": True})

    # Unknown message
    _reply("Send /start for instructions or a 6-digit code to link your account.")
    return jsonify({"ok": True})


# ── Web Push ───────────────────────────────────────────────────────────────────

@notifications_bp.route("/api/notifications/push/vapid-key", methods=["GET"])
def vapid_public_key():
    """Returns the VAPID public key so the frontend can subscribe."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"public_key": current_app.config.get("VAPID_PUBLIC_KEY", "")})


@notifications_bp.route("/api/notifications/push/subscribe", methods=["POST"])
def push_subscribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    subscription = data.get("subscription")
    if not subscription:
        return jsonify({"error": "No subscription object provided"}), 400
    endpoint = subscription.get("endpoint", "")
    if not endpoint:
        return jsonify({"error": "No endpoint in subscription"}), 400

    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if existing:
        existing.subscription_json = json.dumps(subscription)
    else:
        db.session.add(PushSubscription(
            user_id=user.id,
            endpoint=endpoint,
            subscription_json=json.dumps(subscription),
        ))
    db.session.commit()
    return jsonify({"ok": True})


@notifications_bp.route("/api/notifications/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    endpoint = data.get("endpoint")

    query = PushSubscription.query.filter_by(user_id=user.id)
    if endpoint:
        query = query.filter_by(endpoint=endpoint)
    query.delete()
    db.session.commit()
    return jsonify({"ok": True})


@notifications_bp.route("/api/notifications/push/test", methods=["POST"])
def push_test():
    """Sends a test push to verify the subscription is working."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    sub = PushSubscription.query.filter_by(user_id=user.id).first()
    if not sub:
        return jsonify({"error": "No push subscription saved"}), 400

    from notification_helpers import send_push_notification
    result = send_push_notification(
        sub.subscription_json,
        title="💊 DawaiSathi — Test Notification",
        body="Push notifications are working correctly! ✓",
        url="/cabinet",
    )

    if result is True:
        return jsonify({"ok": True})
    if result == "expired":
        db.session.delete(sub)
        db.session.commit()
        return jsonify({"error": "Subscription expired — please re-enable"}), 400
    if isinstance(result, str):
        return jsonify({"error": f"Push send failed: {result}"}), 500
    return jsonify({"error": "Push send failed — check VAPID keys in .env"}), 500


# ── Utility: re-register Telegram webhook ────────────────────────────────────

@notifications_bp.route("/api/telegram/set-webhook", methods=["POST"])
def set_telegram_webhook():
    """
    Re-registers the Telegram webhook with the current TELEGRAM_WEBHOOK_URL.
    Call this after changing your VS Code tunnel URL.
    """
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    token = current_app.config.get("TELEGRAM_BOT_TOKEN", "")
    base_url = current_app.config.get("TELEGRAM_WEBHOOK_URL", "").rstrip("/")

    if not token:
        return jsonify({"error": "TELEGRAM_BOT_TOKEN not set in .env"}), 500
    if not base_url:
        return jsonify({"error": "TELEGRAM_WEBHOOK_URL not set in .env"}), 500

    webhook_url = f"{base_url}/api/telegram/webhook"
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json={"url": webhook_url},
            timeout=10,
        )
        if resp.ok:
            return jsonify({"ok": True, "webhook_url": webhook_url})
        return jsonify({"error": resp.json()}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Utility: external trigger for cron jobs ──────────────────────────────────

@notifications_bp.route("/api/notifications/trigger-check", methods=["GET", "POST"])
def trigger_check():
    """Webhook for external cron services (like cron-job.org) to trigger the notification run."""
    from scheduler import send_due_notifications
    try:
        send_due_notifications()
        return jsonify({"ok": True, "message": "Notification check executed"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
