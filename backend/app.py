import os
import json
from datetime import datetime, timezone

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from config import Config
from extensions import db
from routes.auth import auth_bp
from routes.family import family_bp
from routes.medicine import medicine_bp
from routes.notifications import notifications_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # Initialize extensions
    db.init_app(app)
    CORS(
        app,
        origins=[app.config["FRONTEND_URL"]],
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization", "X-Cron-Secret"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(family_bp)
    app.register_blueprint(medicine_bp)
    app.register_blueprint(notifications_bp)

    # Create DB tables & uploads folder.
    # Keep startup resilient: a transient DB blip must not kill every Gunicorn worker.
    with app.app_context():
        os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
        try:
            db.create_all()

            # Self-healing check: Dynamically add timezone_name column to users table if missing
            try:
                from sqlalchemy import inspect
                inspector = inspect(db.engine)
                columns = [col["name"] for col in inspector.get_columns("users")]
                if "timezone_name" not in columns:
                    db.session.execute(db.text("ALTER TABLE users ADD COLUMN timezone_name VARCHAR(64);"))
                    db.session.commit()
                    app.logger.info("Successfully added missing timezone_name column to users table.")
            except Exception as e:
                db.session.rollback()
                app.logger.error(f"Error checking/adding timezone_name column: {e}")

            # Migrate old push subscriptions to the new table (if not already there)
            from models import User, PushSubscription
            legacy_users = User.query.filter(
                User.push_subscription_json.isnot(None)
            ).all()
            migrated = 0
            for user in legacy_users:
                if not user.push_subscription_json:
                    continue
                endpoint = ""
                try:
                    sub_data = json.loads(user.push_subscription_json)
                    endpoint = sub_data.get("endpoint", "")
                except Exception:
                    pass
                if not endpoint:
                    continue
                already = PushSubscription.query.filter_by(endpoint=endpoint).first()
                if not already:
                    db.session.add(PushSubscription(
                        user_id=user.id,
                        endpoint=endpoint,
                        subscription_json=user.push_subscription_json,
                    ))
                    migrated += 1
            if migrated:
                db.session.commit()
        except Exception as e:
            # Log and continue so / health checks can still answer while DB recovers.
            app.logger.exception(f"Database bootstrap failed (app will still start): {e}")

    # Liveness — process is up (UptimeRobot / load balancers)
    @app.route("/")
    def health_check():
        return {"status": "healthy", "service": "DawaiSathi API"}, 200

    # Readiness — process + database + system notification config (no auth, no user PII)
    @app.route("/healthz")
    def healthz():
        import runtime_state

        db_ok = False
        db_error = None
        try:
            db.session.execute(db.text("SELECT 1"))
            db_ok = True
        except Exception as e:
            db_error = str(e)
            try:
                db.session.rollback()
            except Exception:
                pass

        cloudinary_configured = bool(app.config.get("CLOUDINARY_URL"))
        vapid_configured = bool(
            app.config.get("VAPID_PUBLIC_KEY") and app.config.get("VAPID_PRIVATE_KEY")
        )
        telegram_token_configured = bool(app.config.get("TELEGRAM_BOT_TOKEN"))
        telegram_webhook_base_configured = bool(
            (app.config.get("TELEGRAM_WEBHOOK_URL") or "").strip()
        )
        cron_secret_configured = bool((app.config.get("CRON_SECRET") or "").strip())

        payload = {
            "status": "ok" if db_ok else "degraded",
            "service": "DawaiSathi API",
            "time": datetime.now(timezone.utc).isoformat(),
            "checks": {
                "database": {"ok": db_ok, "error": db_error},
                "cloudinary_configured": cloudinary_configured,
                "vapid_configured": vapid_configured,
                "telegram_token_configured": telegram_token_configured,
                "telegram_webhook_base_configured": telegram_webhook_base_configured,
                "cron_secret_configured": cron_secret_configured,
                "notifications": {
                    "cron_secret_configured": cron_secret_configured,
                    "last_trigger_at": runtime_state.LAST_TRIGGER_CHECK_AT,
                    "last_trigger_ok": runtime_state.LAST_TRIGGER_CHECK_OK,
                    "recommended_interval_minutes": "20-30",
                    "telegram_token_configured": telegram_token_configured,
                    "telegram_webhook_base_configured": telegram_webhook_base_configured,
                    "vapid_configured": vapid_configured,
                },
            },
        }
        return jsonify(payload), (200 if db_ok else 503)

    # Start notification scheduler.
    # WERKZEUG_RUN_MAIN guard: under Flask's debug reloader the parent
    # process is only a file-watcher; the child (WERKZEUG_RUN_MAIN="true")
    # runs the real app. Under gunicorn there is no reloader so we always
    # start the scheduler when app.debug is False OR when Werkzeug confirms
    # we are in the child process. Render also sets RENDER=true automatically.
    werkzeug_main = os.environ.get("WERKZEUG_RUN_MAIN")
    if not app.debug or werkzeug_main == "true" or os.environ.get("RENDER") == "true":
        # Internal scheduler disabled - triggered via external webhook /api/notifications/trigger-check

        # Automatically register Telegram webhook on startup in a background thread
        # so it does not block Gunicorn worker boot (blocking requests during boot = worker failure)
        token = app.config.get("TELEGRAM_BOT_TOKEN", "")
        base_url = app.config.get("TELEGRAM_WEBHOOK_URL", "").rstrip("/")
        if token and base_url:
            import threading
            import requests as _requests

            def _register_telegram_webhook():
                webhook_url = f"{base_url}/api/telegram/webhook"
                try:
                    resp = _requests.post(
                        f"https://api.telegram.org/bot{token}/setWebhook",
                        json={"url": webhook_url},
                        timeout=10,
                    )
                    if resp.ok:
                        app.logger.info(f"Telegram webhook auto-set to: {webhook_url}")
                    else:
                        app.logger.warning(f"Telegram webhook not set: {resp.json()}")
                except Exception as exc:
                    app.logger.warning(f"Error setting Telegram webhook on startup: {exc}")

            t = threading.Thread(target=_register_telegram_webhook, daemon=True)
            t.start()

    @app.teardown_request
    def handle_teardown(exception=None):
        if exception:
            try:
                db.session.rollback()
            except Exception:
                pass

    @app.errorhandler(HTTPException)
    def handle_http_exception(error: HTTPException):
        # Expected client/server HTTP errors — do not log full stack as ERROR
        if error.code and error.code >= 500:
            app.logger.error(f"HTTP {error.code}: {error}")
        else:
            app.logger.info(f"HTTP {error.code}: {error.name}")
        return jsonify({
            "error": error.description or error.name,
            "code": error.name.upper().replace(" ", "_") if error.name else "HTTP_ERROR",
        }), error.code or 500

    @app.errorhandler(500)
    def internal_error(error):
        app.logger.error(f"Unhandled 500: {error}")
        return jsonify({"error": "Internal server error", "code": "INTERNAL_ERROR", "retryable": True}), 500

    @app.errorhandler(Exception)
    def unhandled_exception(error):
        # HTTPException is handled above; this is only unexpected errors
        if isinstance(error, HTTPException):
            return handle_http_exception(error)
        app.logger.exception(f"Unhandled exception: {error}")
        return jsonify({"error": "Internal server error", "code": "INTERNAL_ERROR", "retryable": True}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
