import os
import json
import base64
from datetime import datetime, date
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from extensions import db
from models import User, MedicineEntry, MedicineLog
from routes.auth import get_current_user
import google.generativeai as genai
from PIL import Image
import io
import uuid

medicine_bp = Blueprint("medicine", __name__)

SCAN_PROMPT = """You are an expert Indian prescription and hospital discharge summary OCR agent.

Your task: analyze the image and extract every medicine listed — whether from a printed hospital table, a typed prescription, or a handwritten chit.

For each medicine found, extract ALL of the following fields:
- "name": full medicine name including brand and strength (e.g. "Tab Cetil 500mg", "Cap Pantocid DSR 40mg"). Include the form (Tab / Cap / Inj / Syrup / Drops / Nebulization) in the name if visible.
- "dosage": quantity per dose as written (e.g. "1", "2", "1/2", "2 drops", "10 units"). If timing-specific doses differ (e.g. 1 in morning and 1 at night), summarize as "1-0-1".
- "schedule": list of time slots when the medicine is taken. Use ONLY these values: "morning", "afternoon", "evening", "night". Infer from columns labelled Mrng/Morning, Noon/Afternoon, Evng/Evening, Night/Bedtime. If a cell has a number, a tick, or any mark, that slot is active.
- "days": integer number of days the medicine is prescribed for (from the Days column or text like "for 5 days"). Return null if not found.
- "instructions": administration instructions exactly as written (e.g. "After Food", "Before Breakfast", "S/C", "At Bed Time", "With Water"). Return null if not found.
- "confidence": estimate of OCR certainty based on handwriting legibility/clarity. Use ONLY "high" (for clear printed text/well-written print), "medium" (for average cursive/regular handwriting), or "low" (for scribbles, smudges, or highly ambiguous notes).

Also, extract a list of "unparsed_lines":
- "unparsed_lines": a list of strings containing any other text lines or handwritten scribbles on the prescription that look like drug names, dosage instructions, or other clinical notes but couldn't be fully structured or parsed into the medicines list. Return an empty list if none.

For handwritten prescriptions:
- Read the medicine name even if abbreviated (e.g. "Pan D" = "Pan-D", "PCM" = "Paracetamol").
- Infer schedule from notations like "1-0-1" (morning and night), "1-1-1" (morning, afternoon, night), "OD" (once daily = morning), "BD" (twice = morning + night), "TDS" (three times = morning, afternoon, night), "QDS" (four times = all slots).
- Look for handwritten numbers at the bottom or margins as additional medicines.

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

    # Save scan image
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"scan_{uuid.uuid4().hex}.jpg"
    filepath = os.path.join(upload_dir, filename)

    # Convert to JPEG and save
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img.save(filepath, "JPEG", quality=85)

    scan_image_url = f"/uploads/{filename}"

    # Call Gemini API
    try:
        api_key = current_app.config["GEMINI_API_KEY"]
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")

        img_for_gemini = Image.open(filepath)
        response = model.generate_content([SCAN_PROMPT, img_for_gemini])
        raw_text = response.text.strip()

        # Clean up markdown code blocks using robust regex finding
        import re
        json_match = re.search(r'(\{.*\}|\[.*\])', raw_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1).strip()
        else:
            json_str = raw_text

        extracted = json.loads(json_str)
        
        # Normalize: if the API returns a single medicine object instead of a list, wrap it
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
    except Exception as e:
        current_app.logger.error(f"Gemini error: {e}")
        extracted = {"medicines": []}

    return jsonify({
        "scan_image_url": scan_image_url,
        "extracted": extracted,
    })


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
    except Exception:
        schedule = []

    days = None
    if days_raw is not None and days_raw.strip():
        try:
            days = int(days_raw)
        except (ValueError, TypeError):
            days = None

    pack_image_url = None
    if "pack_image" in request.files:
        upload_dir = current_app.config["UPLOAD_FOLDER"]
        os.makedirs(upload_dir, exist_ok=True)
        pack_file = request.files["pack_image"]
        pack_filename = f"pack_{uuid.uuid4().hex}.jpg"
        pack_filepath = os.path.join(upload_dir, pack_filename)
        pack_img = Image.open(pack_file).convert("RGB")
        pack_img.save(pack_filepath, "JPEG", quality=85)
        pack_image_url = f"/uploads/{pack_filename}"

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
    db.session.commit()

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

    medicine_dicts = []
    for med in medicines:
        med_dict = med.to_dict()
        today_logs = MedicineLog.query.filter(
            MedicineLog.entry_id == med.id,
            MedicineLog.logged_at >= today_start,
            MedicineLog.logged_at <= today_end,
        ).all()
        med_dict["today_logs"] = [l.time_slot for l in today_logs]
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
    db.session.commit()

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
    if entry.family_id and entry.family_id != user.family_id and entry.user_id != user.id:
        return jsonify({"error": "Forbidden"}), 403

    # Delete all associated logs first
    MedicineLog.query.filter_by(entry_id=entry_id).delete()
    db.session.delete(entry)
    db.session.commit()

    return jsonify({"message": "Medicine permanently deleted"})


@medicine_bp.route("/uploads/<filename>")
def serve_upload(filename):
    """Serve uploaded images."""
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    return send_from_directory(upload_dir, filename)
