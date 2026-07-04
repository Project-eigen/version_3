import os
from flask import Flask
from flask_cors import CORS
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
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(family_bp)
    app.register_blueprint(medicine_bp)
    app.register_blueprint(notifications_bp)

    # Create DB tables & uploads folder
    with app.app_context():
        db.create_all()
        os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # Health check route for UptimeRobot
    @app.route("/")
    def health_check():
        return {"status": "healthy", "service": "DawaiSathi API"}, 200

    # Start notification scheduler.
    # WERKZEUG_RUN_MAIN guard: under Flask's debug reloader the parent
    # process is only a file-watcher; the child (WERKZEUG_RUN_MAIN="true")
    # runs the real app. Under gunicorn there is no reloader so we always
    # start the scheduler when app.debug is False OR when Werkzeug confirms
    # we are in the child process. Render also sets RENDER=true automatically.
    werkzeug_main = os.environ.get("WERKZEUG_RUN_MAIN")
    if not app.debug or werkzeug_main == "true" or os.environ.get("RENDER") == "true":
        from scheduler import init_scheduler
        init_scheduler(app)

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
