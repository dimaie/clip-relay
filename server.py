# server.py
import os
import json
import time
import base64
import mimetypes
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO

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
        save_item(clip_dir, idx, it)

    # write metadata last
    meta_path = os.path.join(clip_dir, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2)


def save_item(clip_dir, idx, item):
    itype = item["type"]
    name = item.get("name")

    if itype.startswith("text/"):
        fname = name or f"text_{idx}.txt"
        with open(os.path.join(clip_dir, fname), "w", encoding="utf-8") as f:
            f.write(item["data"])

    else:
        ext = mimetypes.guess_extension(itype) or ".bin"
        fname = name or f"item_{idx}{ext}"
        raw = base64.b64decode(item["data"])
        with open(os.path.join(clip_dir, fname), "wb") as f:
            f.write(raw)

def rebuild_store_and_broadcast():
    global store
    store = load_history_from_disk()
    socketio.emit("clip:update", {"store": store})

# ---------- API ----------

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
    payload = request.get_json(force=True) or {}

    entry = {
        "id": next_id(),
        "timestamp": int(time.time() * 1000),
        "items": payload.get("items", []),
        "meta": payload.get("meta", {})
    }

    save_entry_to_disk(entry)
    rebuild_store_and_broadcast()  # rebuild from disk + broadcast
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

if __name__ == "__main__":
    ensure_data_dir()
    store = load_history_from_disk()
    socketio.run(app, host="0.0.0.0", port=8080)
