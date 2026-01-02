
# server.py (replace your Flask app init with this)
import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
import time

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

store = []
next_id = 1

@app.route("/api/clip", methods=["GET"])
def list_clips():
    return jsonify(store)

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
    global next_id
    payload = request.get_json(force=True) or {}
    entry = {
        "id": next_id,
        "timestamp": int(time.time() * 1000),
        "items": payload.get("items", []),
        "meta":  payload.get("meta", {})
    }
    store.append(entry)
    next_id += 1
    socketio.emit("clip:new", entry)
    return jsonify({"ok": True, "id": entry["id"]})

@app.route("/")
def index():
    # serve public/index.html
    return send_from_directory("static", "index.html")

@app.route("/viewer.html")
def viewer():
    # serve public/viewer.html
    return send_from_directory("static", "viewer.html")

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)
