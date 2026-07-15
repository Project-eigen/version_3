from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def safe_commit():
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
