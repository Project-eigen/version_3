from datetime import datetime
import json
from extensions import db


class Family(db.Model):
    __tablename__ = "families"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    family_code = db.Column(db.String(6), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_family_code', 'family_code'),
    )

    # Relationships
    members = db.relationship("User", backref="family", lazy=True)
    join_requests = db.relationship("FamilyJoinRequest", backref="family", lazy=True)
    medicines = db.relationship("MedicineEntry", backref="family", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "family_code": self.family_code,
            "created_at": self.created_at.isoformat(),
        }


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    google_id = db.Column(db.String(128), unique=True, nullable=False)
    name = db.Column(db.String(128), nullable=False)
    email = db.Column(db.String(256), unique=True, nullable=False)
    avatar_url = db.Column(db.String(512))
    family_id = db.Column(db.Integer, db.ForeignKey("families.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_user_family_id', 'family_id'),
        db.Index('idx_user_telegram_chat_id', 'telegram_chat_id'),
    )

    # ── Notification fields ────────────────────────────────────────────────────
    # Browser's getTimezoneOffset() value (e.g. -330 for IST). UTC = Local + offset.
    timezone_offset = db.Column(db.Integer, default=0)
    # User selected timezone name (e.g., "Asia/Kolkata")
    timezone_name = db.Column(db.String(64), nullable=True)
    # Telegram chat ID once the bot is linked
    telegram_chat_id = db.Column(db.String(64), nullable=True)
    # Full browser PushSubscription JSON (endpoint + keys)
    push_subscription_json = db.Column(db.Text, nullable=True)
    # JSON array of enabled slots e.g. ["morning","night"]
    notif_slots_json = db.Column(db.Text, default='["morning","afternoon","evening","night"]')
    # JSON map of custom slot times e.g. {"morning":"08:00","night":"22:00"}
    notif_times_json = db.Column(db.Text, default='{"morning":"08:00","afternoon":"13:00","evening":"18:00","night":"22:00"}')

    # Relationships
    medicines = db.relationship("MedicineEntry", backref="user", lazy=True)
    logs = db.relationship("MedicineLog", backref="user", lazy=True)
    push_subscriptions = db.relationship("PushSubscription", backref="user", lazy="dynamic")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "avatar_url": self.avatar_url,
            "family_id": self.family_id,
            "telegram_linked": self.telegram_chat_id is not None,
            "push_enabled": self.push_subscriptions.count() > 0,
            "timezone_name": self.timezone_name,
        }



class PushSubscription(db.Model):
    __tablename__ = "push_subscriptions"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = db.Column(db.Text, nullable=False)
    subscription_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_push_sub_user_id', 'user_id'),
        db.Index('idx_push_sub_endpoint', 'endpoint'),
    )


class FamilyJoinRequest(db.Model):
    __tablename__ = "family_join_requests"

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    family_id = db.Column(db.Integer, db.ForeignKey("families.id"), nullable=False)
    status = db.Column(
        db.String(16), default="pending"
    )  # pending | accepted | rejected
    responder_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_fjr_requester_id', 'requester_id'),
        db.Index('idx_fjr_family_id', 'family_id'),
        db.Index('idx_fjr_status', 'status'),
    )

    requester = db.relationship("User", foreign_keys=[requester_id])
    responder = db.relationship("User", foreign_keys=[responder_id])

    def to_dict(self):
        return {
            "id": self.id,
            "requester": self.requester.to_dict(),
            "family_id": self.family_id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
        }


class MedicineEntry(db.Model):
    __tablename__ = "medicine_entries"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    family_id = db.Column(db.Integer, db.ForeignKey("families.id"), nullable=True)
    name = db.Column(db.String(256), nullable=False)
    dosage = db.Column(db.String(128))
    schedule_json = db.Column(db.Text)  # JSON: ["morning", "evening"] etc.
    days = db.Column(db.Integer, nullable=True)  # Number of days to take this medicine
    instructions = db.Column(db.String(256), nullable=True)  # e.g. "After Food", "Before Breakfast"
    scan_image_url = db.Column(db.Text)  # image from scanner
    pack_image_url = db.Column(db.Text)  # image of the physical pack
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_medicine_user_id', 'user_id'),
        db.Index('idx_medicine_family_id', 'family_id'),
    )

    logs = db.relationship("MedicineLog", backref="medicine", lazy=True)

    @property
    def schedule(self):
        if not hasattr(self, '_schedule_cache'):
            if self.schedule_json:
                self._schedule_cache = json.loads(self.schedule_json)
            else:
                self._schedule_cache = []
        return self._schedule_cache

    @schedule.setter
    def schedule(self, value):
        self.schedule_json = json.dumps(value)
        self._schedule_cache = value

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "family_id": self.family_id,
            "name": self.name,
            "dosage": self.dosage,
            "schedule": self.schedule,
            "days": self.days,
            "instructions": self.instructions,
            "scan_image_url": self.scan_image_url,
            "pack_image_url": self.pack_image_url,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MedicineLog(db.Model):
    __tablename__ = "medicine_logs"

    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey("medicine_entries.id"), nullable=False)
    logged_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    time_slot = db.Column(db.String(16))  # morning | afternoon | evening | night
    logged_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_med_log_entry_id', 'entry_id'),
        db.Index('idx_med_log_logged_at', 'logged_at'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "entry_id": self.entry_id,
            "logged_by_user_id": self.logged_by_user_id,
            "time_slot": self.time_slot,
            "logged_at": self.logged_at.isoformat(),
        }


class TelegramLinkCode(db.Model):
    """Temporary 6-digit code used to pair a user with the Telegram bot.
    The user sends this code to the bot; the bot webhook then saves their chat_id.
    """
    __tablename__ = "telegram_link_codes"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(6), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)

    user = db.relationship("User", foreign_keys=[user_id])


class NotificationLog(db.Model):
    """Idempotency guard: one record per (user, date, slot) ensures we never
    send the same notification twice even if the scheduler fires multiple times.
    """
    __tablename__ = "notification_logs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    date = db.Column(db.Date, nullable=False)
    time_slot = db.Column(db.String(16), nullable=False)
    channel = db.Column(db.String(16), default="both")  # telegram | push | both
    sent_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "date", "time_slot", name="uq_notif_user_date_slot"),
        db.Index('idx_notif_lookup', 'user_id', 'date', 'time_slot'),
    )

