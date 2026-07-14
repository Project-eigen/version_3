"""
scheduler.py
APScheduler background job that fires every minute to check which users
have a medicine dose due right now (in their local timezone) and sends
both Telegram + Web Push notifications.

Key design decisions:
  - Runs inside the Flask process (no extra worker process needed)
  - Each job execution pushes its own app context → safe DB access
  - NotificationLog gives idempotency: one send per (user, date, slot)
  - The `days` field on MedicineEntry prevents sending after the course ends
  - WERKZEUG_RUN_MAIN guard prevents double-start under Flask debug reloader
"""
import json
import logging
from datetime import datetime, timedelta, date, time

log = logging.getLogger(__name__)

# ── Slot configuration ────────────────────────────────────────────────────────
DEFAULT_SLOT_TIMES: dict[str, tuple[int, int]] = {
    "morning":   (8,  0),
    "afternoon": (13, 0),
    "evening":   (18, 0),
    "night":     (22, 0),
}

SLOT_LABELS: dict[str, str] = {
    "morning":   "Morning",
    "afternoon": "Afternoon",
    "evening":   "Evening",
    "night":     "Night",
}

_scheduler = None  # Singleton


# ── Main job ──────────────────────────────────────────────────────────────────

def send_due_notifications() -> None:
    """Called every minute by APScheduler (inside an app context)."""
    from extensions import db
    from models import User, NotificationLog, PushSubscription

    now_utc = datetime.utcnow()

    # Only query users who have at least one channel configured
    has_push = db.session.query(PushSubscription.user_id).distinct().subquery()
    users = User.query.filter(
        db.or_(
            User.telegram_chat_id.isnot(None),
            User.id.in_(db.session.query(has_push.c.user_id)),
        )
    ).all()

    for user in users:
        try:
            _check_user(user, now_utc, db)
        except Exception as exc:
            # Per-user errors must not break the whole job
            log.exception("Notification error for user %s: %s", user.id, exc)


# ── Per-user logic ────────────────────────────────────────────────────────────

def _check_user(user, now_utc: datetime, db) -> None:
    from models import NotificationLog
    from notification_helpers import send_telegram_message, send_push_notification

    # Convert UTC → user's local time
    # Browser's getTimezoneOffset(): UTC = Local + offset  →  Local = UTC − offset
    tz_offset = user.timezone_offset or 0
    user_local: datetime = now_utc - timedelta(minutes=tz_offset)
    today: date = user_local.date()

    enabled_slots: list[str] = (
        json.loads(user.notif_slots_json)
        if user.notif_slots_json
        else list(DEFAULT_SLOT_TIMES.keys())
    )
    custom_times: dict[str, str] = (
        json.loads(user.notif_times_json)
        if user.notif_times_json
        else {}
    )

    for slot in enabled_slots:
        if slot not in DEFAULT_SLOT_TIMES:
            continue

        # Resolve slot time (custom or default)
        time_str = custom_times.get(slot, "")
        if time_str:
            try:
                h, m = map(int, time_str.split(":"))
            except ValueError:
                h, m = DEFAULT_SLOT_TIMES[slot]
        else:
            h, m = DEFAULT_SLOT_TIMES[slot]

        # Has the slot time passed for today, and is it within a 2-hour catch-up window?
        slot_time = datetime.combine(today, time(h, m))
        if user_local < slot_time or user_local > slot_time + timedelta(hours=2):
            continue

        # Idempotency check — have we already sent for this slot today?
        already_sent = NotificationLog.query.filter_by(
            user_id=user.id, date=today, time_slot=slot
        ).first()
        if already_sent:
            continue

        # Gather medicines due for this slot (respecting days field)
        medicines = _get_due_medicines(user.id, slot, today)
        if not medicines:
            continue

        # Build notification content
        slot_label = SLOT_LABELS.get(slot, slot.capitalize())
        time_display = f"{h:02d}:{m:02d}"
        med_lines = _format_med_lines(medicines)

        # ── Telegram ──────────────────────────────────────────────────────────
        tg_ok = False
        if user.telegram_chat_id:
            tg_text = (
                f"💊 <b>DawaiSathi — {slot_label} Reminder ({time_display})</b>\n\n"
                + "\n".join(med_lines)
                + "\n\n<i>Open the app to log your dose ✓</i>"
            )
            tg_ok = send_telegram_message(user.telegram_chat_id, tg_text)

        # ── Web Push ──────────────────────────────────────────────────────────
        push_ok = False
        subscriptions = user.push_subscriptions.all()
        if subscriptions:
            push_body = " · ".join(m.name for m in medicines[:3])
            if len(medicines) > 3:
                push_body += f" +{len(medicines) - 3} more"

            for sub in subscriptions:
                result = send_push_notification(
                    sub.subscription_json,
                    title=f"💊 {slot_label} Medicines ({time_display})",
                    body=push_body,
                    url=f"/cabinet?date={today.isoformat()}&slot={slot}",
                )
                if result == "expired":
                    db.session.delete(sub)
                    db.session.commit()
                elif result is True:
                    push_ok = True

        # ── Log to prevent resending (only if at least one channel fired) ─────
        if not tg_ok and not push_ok:
            continue

        channel = "both"
        if tg_ok and not push_ok:
            channel = "telegram"
        elif push_ok and not tg_ok:
            channel = "push"

        try:
            log_entry = NotificationLog(
                user_id=user.id, date=today, time_slot=slot, channel=channel
            )
            db.session.add(log_entry)
            db.session.commit()
        except Exception:
            db.session.rollback()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_due_medicines(user_id: int, slot: str, today: date) -> list:
    """Return all active medicines for a user+family+slot, filtering by days field."""
    from models import MedicineEntry, User

    user = User.query.get(user_id)
    if not user:
        return []

    # Include the user's family members so a parent gets reminded about
    # medicines added for a child (or any other family member).
    if user.family_id:
        target_ids = [
            m.id for m in User.query.filter_by(family_id=user.family_id).all()
        ]
    else:
        target_ids = [user_id]

    medicines = MedicineEntry.query.filter(
        MedicineEntry.user_id.in_(target_ids)
    ).all()

    result = []
    for med in medicines:
        if slot not in (med.schedule or []):
            continue
        # Respect the days field: don't notify after the course ends
        if med.days is not None:
            end_date = med.created_at.date() + timedelta(days=med.days)
            if today >= end_date:
                continue
        result.append(med)
    return result


def _format_med_lines(medicines: list) -> list[str]:
    lines = []
    for med in medicines:
        line = f"• {med.name}"
        if med.dosage:
            line += f" ({med.dosage})"
        if med.instructions:
            line += f" — {med.instructions}"
        lines.append(line)
    return lines


# ── Scheduler lifecycle ───────────────────────────────────────────────────────

def init_scheduler(app) -> None:
    """Start the APScheduler background scheduler.
    Safe to call multiple times — uses singleton + replace_existing guard.
    """
    global _scheduler

    if _scheduler and _scheduler.running:
        log.info("Scheduler already running — skipping init")
        return

    from apscheduler.schedulers.background import BackgroundScheduler

    _scheduler = BackgroundScheduler(daemon=True)

    def _job():
        with app.app_context():
            send_due_notifications()

    _scheduler.add_job(
        _job,
        trigger="interval",
        minutes=1,
        id="notification_check",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=30,
    )

    _scheduler.start()
    log.info("✅ Notification scheduler started (fires every minute)")
