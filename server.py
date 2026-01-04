# server.py
import os
import json
import time
import mimetypes
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
from flask import send_file
from flask import send_from_directory
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("clip-relay")

DATA_DIR = "data"

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# in-memory index (authoritative after startup)
store = []


# ---------- filesystem helpers ----------
def delete_entry_from_disk(cid: int):
    cid_str = f"{cid:06d}"
    clip_dir = os.path.join(DATA_DIR, cid_str)

    if not os.path.isdir(clip_dir):
        return False

    # remove files first
    for name in os.listdir(clip_dir):
        path = os.path.join(clip_dir, name)
        if os.path.isfile(path):
            os.remove(path)

    os.rmdir(clip_dir)
    return True

def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def load_history_from_disk():
    ensure_data_dir()
    entries = []

    for d in sorted(os.listdir(DATA_DIR)):
        if not d.isdigit():
            continue

        clip_dir = os.path.join(DATA_DIR, d)
        meta_file = os.path.join(clip_dir, "meta.json")

        if not os.path.isfile(meta_file):
            continue

        with open(meta_file, "r", encoding="utf-8") as f:
            entry = json.load(f)

        entries.append(entry)

    # newest last internally
    entries.sort(key=lambda e: e["id"])
    return entries


def next_id():
    if not store:
        return 1
    return store[-1]["id"] + 1


def save_entry_to_disk(entry):
    cid = f"{entry['id']:06d}"
    clip_dir = os.path.join(DATA_DIR, cid)
    os.makedirs(clip_dir, exist_ok=False)

    # write payloads
    for idx, it in enumerate(entry["items"]):
        save_item(clip_dir, idx, it, entry["id"])

    # write metadata last
    meta_path = os.path.join(clip_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2)


def save_item(clip_dir, idx, item, entry_id):
    itype = item["type"]
    name = item.get("name")

    if itype.startswith("text/"):
        fname = name or f"text_{idx}.txt"
        file_path = os.path.join(clip_dir, fname)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(item["data"])
        # Update metadata
        item["path"] = os.path.join(f"{entry_id:06d}", fname)
        item["size"] = len(item["data"])
        # optional: remove inline text to save memory
        del item["data"]

    else:
        ext = mimetypes.guess_extension(itype) or ".bin"
        fname = name or f"item_{idx}{ext}"
        file_path = os.path.join(clip_dir, fname)

        # NEW: convert numeric array to bytes instead of Base64 decoding
        raw = bytes(item["data"])
        with open(file_path, "wb") as f:
            f.write(raw)

        item["path"] = os.path.join(f"{entry_id:06d}", fname)
        item["size"] = len(raw)
        del item["data"]

def rebuild_store_and_broadcast():
    global store
    store = load_history_from_disk()
    socketio.emit("clip:update", {"store": list(reversed(store))})

# ---------- API ----------
@app.route("/data/<path:filename>")
def serve_data(filename):
    # Serve files from the DATA_DIR directory
    return send_from_directory(DATA_DIR, filename)


@app.route("/api/clip/<int:cid>/item/<path:filename>")
def serve_clip_file(cid, filename):
    clip_dir = os.path.join(DATA_DIR, f"{cid:06d}")
    file_path = os.path.join(clip_dir, filename)
    if not os.path.isfile(file_path):
        return jsonify({"error": "File not found"}), 404

    mime_type, _ = mimetypes.guess_type(file_path)
    return send_file(file_path, mimetype=mime_type or "application/octet-stream")

@app.route("/api/clip", methods=["GET"])
def list_clips():
    # newest first
    return jsonify(list(reversed(store)))


@app.route("/api/clip/latest", methods=["GET"])
def latest_clip():
    return jsonify(store[-1] if store else None)


@app.route("/api/clip/<int:cid>", methods=["GET"])
def get_clip(cid):
    for e in store:
        if e["id"] == cid:
            return jsonify(e)
    return jsonify(None)


@app.route("/api/clip", methods=["POST"])
def post_clip():
    entry = {
        "id": next_id(),
        "timestamp": int(time.time() * 1000),
        "items": [],
        "meta": {}
    }

    # 1️⃣ handle FormData files
    if request.files:
        source = request.form.get("source", "")
        entry["meta"]["source"] = source

        cid_str = f"{entry['id']:06d}"
        clip_dir = os.path.join(DATA_DIR, cid_str)
        os.makedirs(clip_dir, exist_ok=True)

        for idx, file in enumerate(request.files.getlist("files")):
            fname = file.filename
            path = os.path.join(clip_dir, fname)
            file.save(path)
            entry["items"].append({
                "type": file.mimetype,
                "name": fname,
                "path": os.path.join(cid_str, fname),
                "size": os.path.getsize(path)
            })

    # 2️⃣ handle JSON payload (text items)
    elif request.is_json:
        payload = request.get_json()
        entry["meta"] = payload.get("meta", {})
        cid_str = f"{entry['id']:06d}"
        clip_dir = os.path.join(DATA_DIR, cid_str)
        os.makedirs(clip_dir, exist_ok=True)

        for idx, item in enumerate(payload.get("items", [])):
            itype = item["type"]
            name = item.get("name") or f"text_{idx}.txt"
            file_path = os.path.join(clip_dir, name)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(item["data"])
            entry["items"].append({
                "type": itype,
                "name": name,
                "path": os.path.join(cid_str, name),
                "size": len(item["data"])
            })

    # 3️⃣ write metadata
    meta_path = os.path.join(clip_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2)

    rebuild_store_and_broadcast()
    return jsonify({"ok": True, "id": entry["id"]})

@app.route("/api/clip", methods=["DELETE"])
def delete_clips():
    payload = request.get_json(force=True) or {}
    ids = payload.get("ids", [])

    if not isinstance(ids, list):
        return jsonify({"ok": False, "error": "ids must be a list"}), 400

    deleted = []
    failed = []

    global store

    for cid in ids:
        try:
            removed = delete_entry_from_disk(int(cid))
            if removed:
                deleted.append(int(cid))
        except Exception as e:
            failed.append(int(cid))

    if failed:
        return jsonify({
            "ok": False,
            "deleted": deleted,
            "failed": failed
        }), 500

    # rebuild and broadcast
    rebuild_store_and_broadcast()

    return jsonify({
        "ok": True,
        "deleted": deleted
    })

# ---------- static ----------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/viewer.html")
def viewer():
    return send_from_directory("static", "viewer.html")


# ---------- startup ----------
def require_tls_certificates(certfile: str, keyfile: str):
    missing = []

    if not os.path.isfile(certfile):
        missing.append(certfile)
    if not os.path.isfile(keyfile):
        missing.append(keyfile)

    if missing:
        log.error("HTTPS startup aborted.")
        for f in missing:
            log.error("Missing TLS file: %s", os.path.abspath(f))
        sys.exit(1)

    log.info("HTTPS enabled")
    log.info("Using TLS certificate: %s", os.path.abspath(certfile))
    log.info("Using TLS private key: %s", os.path.abspath(keyfile))

if __name__ == "__main__":
    ensure_data_dir()
    store = load_history_from_disk()

    CERT_FILE = "cert.pem"
    KEY_FILE = "key.pem"

    require_tls_certificates(CERT_FILE, KEY_FILE)

    socketio.run(
        app,
        host="0.0.0.0",
        port=8080,
        certfile=CERT_FILE,
        keyfile=KEY_FILE,
    )
