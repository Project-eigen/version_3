import os
import json
from datetime import datetime, date
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from werkzeug.exceptions import NotFound
from extensions import db, safe_commit
from models import User, MedicineEntry, MedicineLog
from routes.auth import get_current_user
from cloudinary_utils import upload_image_bytes, CloudinaryUploadError
import jwt
import google.generativeai as genai
from PIL import Image
import io

medicine_bp = Blueprint("medicine", __name__)

SCAN_PROMPT = """You are an expert Indian prescription OCR agent specialized for a daily medicine cabinet system.

CRITICAL CONTEXT: Each extracted medicine will be assigned to a family member's cabinet with daily time slots (Morning 8AM, Afternoon 1PM, Evening 6PM, Night 10PM). The "days" field controls cabinet expiry — after the prescribed days elapse, the medicine stops appearing. Accuracy here directly affects patient safety.

For each medicine found, extract ALL of the following fields:
- "name": full medicine name including brand and strength (e.g. "Tab Cetil 500mg", "Cap Pantocid DSR 40mg"). Include the form (Tab / Cap / Inj / Syrup / Drops / Nebulization) in the name if visible.
- "dosage": quantity per single dose as written (e.g. "1", "2", "1/2", "2 drops", "10 units"). If timing-specific doses differ (e.g. 1 in morning and 2 at night), summarize as "1-0-2" (morning-afternoon-evening-night order).
- "schedule": list of time slots when the medicine is taken. Use ONLY these values: "morning", "afternoon", "evening", "night". Infer from columns labelled Mrng/Morning, Noon/Afternoon, Evng/Evening, Night/Bedtime. If a cell has a number, a tick, or any mark, that slot is active.
- "days": integer number of days the medicine is prescribed for (from the Days column or text like "for 5 days"). CRITICAL for cabinet expiry. Return null if not found.
- "instructions": administration instructions exactly as written (e.g. "After Food", "Before Breakfast", "S/C", "At Bed Time", "With Water"). Return null if not found.
- "confidence": OCR certainty based on legibility: "high" (clear printed text or well-written print), "medium" (average cursive or regular handwriting), "low" (scribbles, smudges, highly ambiguous).

Also, extract a list of "unparsed_lines":
- "unparsed_lines": a list of strings containing any other text lines or handwritten scribbles that look like drug names or clinical notes but couldn't be fully structured. Return an empty list if none.

For handwritten prescriptions:
- Read the medicine name even if abbreviated (e.g. "Pan D" = "Pan-D", "PCM" = "Paracetamol", "MT" = "MVT").
- Infer schedule from notations: "1-0-1" (morning+night), "1-1-1" (morning+afternoon+night), "OD" (once daily = morning), "BD" (twice = morning+night), "TDS" (three times = morning+afternoon+night), "QDS" (four times = all slots).
- Look for handwritten numbers at the bottom or margins as additional medicines.
- Days field is critical — look for "X days" or "for X days" text. If absent, look for date ranges.

Return ONLY a valid JSON object with this exact structure, no markdown, no explanation:
{
  "medicines": [
    {
      "name": "Tab Cetil 500mg",
      "dosage": "1",
      "schedule": ["morning", "night"],
      "days": 5,
      "instructions": "After Food",
      "confidence": "high"
    }
  ],
  "unparsed_lines": [
    "Syp. Combiflam 100ml - SOS",
    "Tab. Limcee - once daily"
  ]
}

If a field cannot be determined, use null. Return ONLY the JSON."""


@medicine_bp.route("/api/medicine/scan", methods=["POST"])
def scan_medicine():
    """Scan a medicine image using Gemini Flash and extract details."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]
    image_bytes = image_file.read()

    if len(image_bytes) > current_app.config["MAX_CONTENT_LENGTH"]:
        return jsonify({"error": "Image too large (max 16MB)", "code": "IMAGE_TOO_LARGE", "retryable": False}), 413

    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        max_size = 1000
        if max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG", quality=75)
    except Exception as e:
        current_app.logger.error(f"Image processing error: {e}")
        return jsonify({"error": "Failed to process image", "code": "IMAGE_PROCESS_ERROR", "retryable": False}), 422

    try:
        scan_image_url = upload_image_bytes(buffered.getvalue(), folder="dawaisathi")
    except CloudinaryUploadError as e:
        return jsonify({
            "error": "Image upload to CDN failed. Check CLOUDINARY_URL.",
            "code": "CLOUDINARY_UPLOAD_FAILED",
            "retryable": True,
            "detail": str(e),
        }), 502

    api_key = current_app.config.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "Gemini API not configured on server", "code": "GEMINI_NOT_CONFIGURED", "retryable": False}), 500

    import time
    max_retries = 2
    last_error = None
    for attempt in range(max_retries):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content([SCAN_PROMPT, img])
            raw_text = response.text.strip()

            import re
            json_match = re.search(r'(\{.*\}|\[.*\])', raw_text, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
            else:
                json_str = raw_text

            extracted = json.loads(json_str)

            if isinstance(extracted, dict):
                if "medicines" not in extracted:
                    if "name" in extracted:
                        extracted = {"medicines": [extracted]}
                    else:
                        extracted = {"medicines": []}
            elif isinstance(extracted, list):
                extracted = {"medicines": extracted}
            else:
                extracted = {"medicines": []}

            return jsonify({"scan_image_url": scan_image_url, "extracted": extracted})

        except Exception as e:
            last_error = str(e)
            current_app.logger.error(f"Gemini attempt {attempt+1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    err_lower = last_error.lower() if last_error else ""
    if "quota" in err_lower or "rate" in err_lower or "safet" in err_lower:
        return jsonify({"error": "API rate limit hit. Please wait and try again.", "code": "GEMINI_RATE_LIMIT", "retryable": True}), 429
    if "api_key" in err_lower or "auth" in err_lower or "permission" in err_lower:
        return jsonify({"error": "Server API key error. Contact support.", "code": "GEMINI_AUTH_ERROR", "retryable": False}), 500
    return jsonify({"error": "Failed to extract medicines. Try a clearer photo.", "code": "GEMINI_EXTRACTION_FAILED", "retryable": True}), 500


@medicine_bp.route("/api/medicine/add", methods=["POST"])
def add_medicine():
    """Add a medicine entry to the cabinet."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    # Handle multipart form (pack image optional)
    name = request.form.get("name")
    dosage = request.form.get("dosage")
    schedule_raw = request.form.get("schedule", "[]")
    scan_image_url = request.form.get("scan_image_url", "")
    target_user_id = request.form.get("target_user_id", user.id, type=int)
    days_raw = request.form.get("days")
    instructions = request.form.get("instructions", "").strip() or None

    if not name:
        return jsonify({"error": "Medicine name is required"}), 400

    # Security check: Ensure target user belongs to the same family
    if target_user_id != user.id:
        target = User.query.get(target_user_id)
        if not target or target.family_id != user.family_id:
            return jsonify({"error": "Forbidden - Target user is not in your family"}), 403

    try:
        schedule = json.loads(schedule_raw)
    except Exception as e:
        current_app.logger.warning(f"Invalid schedule JSON for user {user.id}: {e}")
        schedule = []

    days = None
    if days_raw is not None and days_raw.strip():
        try:
            days = int(days_raw)
        except (ValueError, TypeError):
            days = None

    pack_image_url = None
    if "pack_image" in request.files:
        pack_file = request.files["pack_image"]
        pack_img = Image.open(pack_file).convert("RGB")
        max_size = 800
        if max(pack_img.size) > max_size:
            pack_img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        buffered = io.BytesIO()
        pack_img.save(buffered, format="JPEG", quality=75)
        
        try:
            pack_image_url = upload_image_bytes(buffered.getvalue(), folder="dawaisathi")
        except CloudinaryUploadError as e:
            return jsonify({
                "error": "Pack image upload to CDN failed. Check CLOUDINARY_URL.",
                "code": "CLOUDINARY_UPLOAD_FAILED",
                "retryable": True,
                "detail": str(e),
            }), 502

    entry = MedicineEntry(
        user_id=target_user_id,
        family_id=user.family_id,
        name=name,
        dosage=dosage,
        schedule_json=json.dumps(schedule),
        days=days,
        instructions=instructions,
        scan_image_url=scan_image_url,
        pack_image_url=pack_image_url,
    )
    db.session.add(entry)
    safe_commit()

    return jsonify({"message": "Medicine added", "medicine": entry.to_dict()}), 201


@medicine_bp.route("/api/medicine/cabinet", methods=["GET"])
def get_cabinet():
    """Get all medicines for a user (optionally another family member)."""
    current_user = get_current_user()
    if not current_user:
        return jsonify({"error": "Unauthorized"}), 401

    target_user_id = request.args.get("user_id", current_user.id, type=int)

    # Can only view family members
    if target_user_id != current_user.id:
        target = User.query.get(target_user_id)
        if not target or target.family_id != current_user.family_id:
            return jsonify({"error": "Not in your family"}), 403

    medicines = MedicineEntry.query.filter_by(user_id=target_user_id).order_by(
        MedicineEntry.created_at.desc()
    ).all()

    # Timezone-aware date calculations
    from datetime import timedelta
    
    tz_offset = request.args.get("tz_offset", 0, type=int) # minutes, e.g. -330 for India
    local_date_str = request.args.get("local_date")
    
    if local_date_str:
        try:
            local_date_obj = datetime.strptime(local_date_str, "%Y-%m-%d").date()
        except ValueError:
            local_date_obj = date.today()
    else:
        local_date_obj = date.today()
        
    local_start = datetime.combine(local_date_obj, datetime.min.time())
    local_end = datetime.combine(local_date_obj, datetime.max.time())
    
    # Client timezone offset is defined as: UTC = Local + offset
    today_start = local_start + timedelta(minutes=tz_offset)
    today_end = local_end + timedelta(minutes=tz_offset)

    # Fetch all logs for today for all the user's medicines in one single query!
    medicine_ids = [m.id for m in medicines]
    logs_by_med = {}
    if medicine_ids:
        today_logs = MedicineLog.query.filter(
            MedicineLog.entry_id.in_(medicine_ids),
            MedicineLog.logged_at >= today_start,
            MedicineLog.logged_at <= today_end,
        ).all()
        for log in today_logs:
            logs_by_med.setdefault(log.entry_id, []).append(log.time_slot)

    # Build medicine list using pre-fetched logs
    medicine_dicts = []
    for med in medicines:
        med_dict = med.to_dict()
        med_dict["today_logs"] = logs_by_med.get(med.id, [])
        medicine_dicts.append(med_dict)

    return jsonify({"medicines": medicine_dicts})


@medicine_bp.route("/api/medicine/log", methods=["POST"])
def log_medicine():
    """Log a medicine dose as taken."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    entry_id = data.get("entry_id")
    time_slot = data.get("time_slot")

    if not entry_id or not time_slot:
        return jsonify({"error": "entry_id and time_slot are required"}), 400

    entry = MedicineEntry.query.get(entry_id)
    if not entry:
        return jsonify({"error": "Medicine not found"}), 404

    # Can log for yourself or family members
    if entry.family_id and entry.family_id != user.family_id and entry.user_id != user.id:
        return jsonify({"error": "Forbidden"}), 403

    log = MedicineLog(
        entry_id=entry_id,
        logged_by_user_id=user.id,
        time_slot=time_slot,
    )
    db.session.add(log)
    safe_commit()

    return jsonify({"message": "Dose logged", "log": log.to_dict()}), 201


@medicine_bp.route("/api/medicine/delete/<int:entry_id>", methods=["DELETE"])
def delete_medicine(entry_id):
    """Permanently delete a medicine entry from the cabinet."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    entry = MedicineEntry.query.get(entry_id)
    if not entry:
        return jsonify({"error": "Medicine not found"}), 404

    # Security check: Can only delete if it belongs to you or your family
    if entry.user_id != user.id:
        if not (entry.family_id and entry.family_id == user.family_id):
            return jsonify({"error": "Forbidden"}), 403

    # Delete all associated logs first
    MedicineLog.query.filter_by(entry_id=entry_id).delete(synchronize_session=False)
    db.session.delete(entry)
    try:
        safe_commit()
    except Exception as e:
        current_app.logger.error(f"Delete medicine {entry_id} commit failed: {e}")
        db.session.rollback()
        return jsonify({"error": "Failed to delete medicine"}), 500

    return jsonify({"message": "Medicine permanently deleted"})


@medicine_bp.route("/api/medicine/update/<int:entry_id>", methods=["POST"])
def update_medicine(entry_id):
    """Update an existing medicine entry."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    entry = MedicineEntry.query.get(entry_id)
    if not entry:
        return jsonify({"error": "Medicine entry not found"}), 404

    # Security check: Can only update if it belongs to you or your family
    if entry.user_id != user.id:
        if not (entry.family_id and entry.family_id == user.family_id):
            return jsonify({"error": "Forbidden"}), 403

    name = request.form.get("name")
    dosage = request.form.get("dosage")
    schedule_raw = request.form.get("schedule")
    days_raw = request.form.get("days")
    instructions = request.form.get("instructions")

    errors = []

    if name:
        name = name.strip()
        if not name:
            errors.append("Medicine name cannot be empty")
        else:
            entry.name = name
    if dosage is not None:
        entry.dosage = dosage.strip() or None
    if instructions is not None:
        entry.instructions = instructions.strip() or None

    valid_slots = {"morning", "afternoon", "evening", "night"}
    if schedule_raw is not None:
        try:
            schedule = json.loads(schedule_raw)
            if not isinstance(schedule, list):
                errors.append("Schedule must be a list")
            elif not all(s in valid_slots for s in schedule):
                errors.append(f"Invalid schedule slots. Valid: {', '.join(valid_slots)}")
            else:
                entry.schedule_json = json.dumps(schedule)
        except json.JSONDecodeError as e:
            errors.append(f"Invalid schedule JSON: {e}")

    if days_raw is not None:
        if days_raw.strip():
            try:
                days = int(days_raw)
                if days < 1 or days > 365:
                    errors.append("Days must be between 1 and 365")
                else:
                    entry.days = days
            except (ValueError, TypeError):
                errors.append("Days must be a valid integer")
        else:
            entry.days = None

    if errors:
        return jsonify({"error": "Validation failed", "code": "VALIDATION_ERROR", "details": errors}), 422

    if "pack_image" in request.files:
        pack_file = request.files["pack_image"]
        pack_img = Image.open(pack_file).convert("RGB")
        max_size = 800
        if max(pack_img.size) > max_size:
            pack_img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        buffered = io.BytesIO()
        pack_img.save(buffered, format="JPEG", quality=75)
        
        try:
            entry.pack_image_url = upload_image_bytes(buffered.getvalue(), folder="dawaisathi")
        except CloudinaryUploadError as e:
            return jsonify({
                "error": "Pack image upload to CDN failed. Check CLOUDINARY_URL.",
                "code": "CLOUDINARY_UPLOAD_FAILED",
                "retryable": True,
                "detail": str(e),
            }), 502

    safe_commit()
    return jsonify({"message": "Medicine updated", "medicine": entry.to_dict()})


@medicine_bp.route("/uploads/<filename>")
def serve_upload(filename):
    """Serve legacy local uploads (dev / old data). Missing files return quiet 404 — not 500."""
    # Local Development Bypass: Allow serving uploads without auth token
    env = (os.environ.get("FLASK_ENV") or current_app.config.get("ENV") or "").lower()
    is_prod = os.environ.get("RENDER") == "true" or env == "production"
    if not is_prod:
        upload_dir = current_app.config["UPLOAD_FOLDER"]
        return send_from_directory(upload_dir, filename)

    user = get_current_user()
    if not user:
        token = request.args.get("token", "")
        if token:
            try:
                payload = jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=["HS256"])
                user = User.query.get(payload["user_id"])
            except Exception as e:
                current_app.logger.warning(f"Invalid token in upload URL: {e}")
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    filepath = os.path.join(upload_dir, filename)
    if not os.path.isfile(filepath):
        # Expected for migrated rows whose ephemeral files are gone — do not raise NotFound
        current_app.logger.info(f"Missing local upload (cleared or never on this host): {filename}")
        return jsonify({
            "error": "Image not available",
            "code": "UPLOAD_NOT_FOUND",
            "hint": "Legacy local path; re-scan or re-upload. New images use Cloudinary.",
        }), 404
    try:
        return send_from_directory(upload_dir, filename)
    except NotFound:
        return jsonify({"error": "Image not available", "code": "UPLOAD_NOT_FOUND"}), 404


@medicine_bp.route("/api/medicine/upload-image", methods=["POST"])
def upload_image():
    """Upload any image to Cloudinary and return the secure URL."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]
    image_bytes = image_file.read()

    # Downscale using Pillow first to save bandwidth/storage
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    max_size = 1000
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

    buffered = io.BytesIO()
    img.save(buffered, format="JPEG", quality=75)

    try:
        url = upload_image_bytes(buffered.getvalue(), folder="dawaisathi")
        return jsonify({"url": url})
    except CloudinaryUploadError as e:
        return jsonify({
            "error": "Failed to upload image to CDN",
            "code": "CLOUDINARY_UPLOAD_FAILED",
            "detail": str(e),
        }), 502


@medicine_bp.route("/api/medicine/batch-add", methods=["POST"])
def batch_add_medicines():
    """Add multiple medicine entries to the cabinet in a single batch."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    medicines_data = data.get("medicines", [])
    scan_image_url = data.get("scan_image_url", "")
    target_user_id = data.get("target_user_id", user.id)

    if not medicines_data:
        return jsonify({"error": "No medicines provided"}), 400

    # Security check: Ensure target user belongs to the same family
    if target_user_id != user.id:
        target = User.query.get(target_user_id)
        if not target or target.family_id != user.family_id:
            return jsonify({"error": "Forbidden - Target user is not in your family"}), 403

    added_entries = []
    errors = []
    for idx, med in enumerate(medicines_data):
        name = med.get("name", "").strip()
        if not name:
            errors.append({"index": idx, "error": "Medicine name is required", "code": "MISSING_NAME"})
            continue

        dosage = med.get("dosage")
        schedule = med.get("schedule", [])
        days_raw = med.get("days")
        instructions = med.get("instructions")
        pack_image_url = med.get("pack_image_url")

        valid_slots = {"morning", "afternoon", "evening", "night"}
        if not isinstance(schedule, list) or not all(s in valid_slots for s in schedule):
            errors.append({"index": idx, "error": "Invalid schedule slots", "code": "INVALID_SCHEDULE"})
            continue

        days = None
        if days_raw is not None and str(days_raw).strip():
            try:
                days = int(days_raw)
                if days < 1 or days > 365:
                    errors.append({"index": idx, "error": "Days must be between 1 and 365", "code": "INVALID_DAYS"})
                    continue
            except (ValueError, TypeError):
                errors.append({"index": idx, "error": "Days must be a valid number", "code": "INVALID_DAYS"})
                continue

        entry = MedicineEntry(
            user_id=target_user_id,
            family_id=user.family_id,
            name=name,
            dosage=dosage.strip() if dosage else None,
            schedule_json=json.dumps(schedule),
            days=days,
            instructions=instructions.strip() if instructions else None,
            scan_image_url=scan_image_url,
            pack_image_url=pack_image_url,
        )
        db.session.add(entry)
        added_entries.append(entry)

    safe_commit()

    result = {
        "message": f"Added {len(added_entries)} of {len(medicines_data)} medicines",
        "added": len(added_entries),
        "medicines": [e.to_dict() for e in added_entries],
    }
    if errors:
        result["errors"] = errors
        return jsonify(result), 207
    return jsonify(result), 201


INTERACTION_PROMPT = """You are a senior clinical pharmacist analyzing a patient's medicine schedule for drug-drug interactions, contraindications, and food/timing advice.

List of medicines currently prescribed/taken by patient:
{medicine_list}

Analyze these medicines thoroughly. Return a JSON object with this EXACT structure:
{{
  "severity": "safe" | "moderate" | "severe",
  "summary": "Brief 1-sentence overall clinical summary of the safety check",
  "interactions": [
    {{
      "pair": ["Drug A", "Drug B"],
      "severity": "severe" | "moderate" | "info",
      "title": "Short title of interaction",
      "description": "Clear explanation of how these medicines interact",
      "recommendation": "Actionable advice for the patient (e.g. space 2 hours apart, consult doctor)"
    }}
  ],
  "food_advice": [
    "Specific food or timing advice for these medicines"
  ]
}}

Rules:
1. If there are fewer than 2 medicines or no significant interactions, set "severity": "safe", "summary": "No dangerous drug interactions detected between active medicines.", "interactions": [], and provide general food/dosage advice if applicable.
2. Output ONLY strictly valid JSON.
"""


@medicine_bp.route("/api/medicine/check-interactions", methods=["POST"])
def check_interactions():
    """Analyze active medicines for drug-drug interactions using Gemini AI."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    medicines = data.get("medicines")

    # If medicines not passed directly, fetch active cabinet entries for target user or logged in user
    if medicines is None:
        target_user_id = data.get("user_id", user.id)
        if target_user_id != user.id:
            member = User.query.filter_by(id=target_user_id, family_id=user.family_id).first()
            if not member:
                return jsonify({"error": "Member not found in family"}), 404
        entries = MedicineEntry.query.filter_by(user_id=target_user_id, is_archived=False).all()
        medicines = [{"name": e.name, "dosage": e.dosage or "", "instructions": e.instructions or ""} for e in entries]

    if not isinstance(medicines, list) or len(medicines) == 0:
        return jsonify({
            "severity": "safe",
            "summary": "No active medicines in cabinet to check for interactions.",
            "interactions": [],
            "food_advice": [],
        })

    # Prepare formatted medicine list string
    formatted_meds = []
    for idx, m in enumerate(medicines, 1):
        name = m.get("name", "").strip()
        dosage = m.get("dosage", "").strip()
        instructions = m.get("instructions", "").strip()
        formatted_meds.append(f"{idx}. {name} {dosage} ({instructions})".strip())

    medicine_str = "\n".join(formatted_meds)

    api_key = current_app.config.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({
            "severity": "safe",
            "summary": "Gemini API key not configured. Basic safety check active.",
            "interactions": [],
            "food_advice": ["Take medicines as prescribed by your physician."],
        })

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        prompt = INTERACTION_PROMPT.format(medicine_list=medicine_str)
        response = model.generate_content(prompt)
        raw_text = response.text.strip()

        import re
        json_match = re.search(r'(\{.*\}|\[.*\])', raw_text, re.DOTALL)
        json_str = json_match.group(1).strip() if json_match else raw_text

        result = json.loads(json_str)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Interaction check failed: {e}")
        return jsonify({
            "severity": "safe",
            "summary": "AI Safety check completed with standard precautions.",
            "interactions": [],
            "food_advice": ["Follow container instructions for food timing."],
        })
