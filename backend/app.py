"""
app.py - Flask backend for the Smart Posture Monitor.

- Login / register / logout with hashed passwords (werkzeug.security)
- SQLite database (data/posture.db) for users, training samples and posture logs
- One trained model per user (data/models/model_<user_id>.json)
- Serves the frontend pages from ../frontend
"""

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from functools import wraps

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from train_model import knn_predict, load_model, train_from_arrays

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(DATA_DIR, "models")
DB_PATH = os.path.join(DATA_DIR, "posture.db")
SECRET_PATH = os.path.join(DATA_DIR, "secret_key.txt")

FEATURE_COUNT = 4  # neck_angle, head_height, head_roll, shoulder_tilt

os.makedirs(MODEL_DIR, exist_ok=True)


def load_secret_key():
    if not os.path.isfile(SECRET_PATH):
        with open(SECRET_PATH, "w") as f:
            f.write(os.urandom(24).hex())
    with open(SECRET_PATH) as f:
        return f.read().strip()


app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.secret_key = load_secret_key()


# ---------- Database ----------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS posture_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                neck_angle REAL NOT NULL,
                head_height REAL NOT NULL,
                head_roll REAL NOT NULL,
                shoulder_tilt REAL NOT NULL,
                label TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS posture_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                label TEXT NOT NULL,
                confidence REAL NOT NULL,
                created_at TEXT NOT NULL
            );
        """)


init_db()


# ---------- Helpers ----------

def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def error(message, status=400, code="bad_request"):
    return jsonify({"error": code, "message": message}), status


def parse_features(raw):
    if not isinstance(raw, list) or len(raw) != FEATURE_COUNT:
        return None
    try:
        return [float(v) for v in raw]
    except (TypeError, ValueError):
        return None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return error("Please log in first.", 401, "unauthorized")
        return view(*args, **kwargs)
    return wrapper


_models = {}


def model_file(user_id):
    return os.path.join(MODEL_DIR, f"model_{user_id}.json")


def get_model(user_id):
    if user_id not in _models:
        path = model_file(user_id)
        if not os.path.isfile(path):
            return None
        _models[user_id] = load_model(path)
    return _models[user_id]


# ---------- Pages ----------

@app.route("/")
def page_monitor():
    if "user_id" not in session:
        return redirect("/login")
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/login")
def page_login():
    return send_from_directory(FRONTEND_DIR, "login.html")


@app.route("/register")
def page_register():
    return send_from_directory(FRONTEND_DIR, "register.html")


@app.route("/history")
def page_history():
    if "user_id" not in session:
        return redirect("/login")
    return send_from_directory(FRONTEND_DIR, "history.html")


# ---------- API: accounts ----------

@app.route("/api/register", methods=["POST"])
def api_register():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if len(username) < 3:
        return error("Username must be at least 3 characters.")
    if len(password) < 6:
        return error("Password must be at least 6 characters.")
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, generate_password_hash(password), now_iso()),
            )
    except sqlite3.IntegrityError:
        return error("That username is already taken.", 409, "duplicate")
    return jsonify({"status": "ok"})


@app.route("/api/login", methods=["POST"])
def api_login():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return error("Wrong username or password.", 401, "bad_credentials")
    session.clear()
    session["user_id"] = row["id"]
    session["username"] = username
    return jsonify({"status": "ok", "username": username})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"status": "ok"})


@app.route("/api/me")
def api_me():
    if "user_id" not in session:
        return error("Not logged in.", 401, "unauthorized")
    return jsonify({"username": session["username"]})


# ---------- API: posture (login required) ----------

@app.route("/api/predict", methods=["POST"])
@login_required
def api_predict():
    model = get_model(session["user_id"])
    if model is None:
        return error("Model is still learning. Keep the monitor open to collect samples.")
    values = parse_features((request.get_json(silent=True) or {}).get("features"))
    if values is None:
        return error("Expected 4 numbers in 'features'.")
    label, confidence = knn_predict(model, values)
    return jsonify({"label": label, "confidence": confidence})


@app.route("/api/collect", methods=["POST"])
@login_required
def api_collect():
    body = request.get_json(silent=True) or {}
    values = parse_features(body.get("features"))
    label = body.get("label")
    source = body.get("source", "manual")
    if values is None:
        return error("Expected 4 numbers in 'features'.")
    if label not in ("good", "bad"):
        return error("'label' must be 'good' or 'bad'.")
    if source not in ("auto", "manual"):
        return error("'source' must be 'auto' or 'manual'.")
    with get_db() as conn:
        conn.execute(
            """INSERT INTO posture_samples
               (user_id, neck_angle, head_height, head_roll, shoulder_tilt, label, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session["user_id"], *values, label, source, now_iso()),
        )
    return jsonify({"status": "ok"})


@app.route("/api/log", methods=["POST"])
@login_required
def api_log():
    body = request.get_json(silent=True) or {}
    label = body.get("label")
    try:
        confidence = float(body.get("confidence"))
    except (TypeError, ValueError):
        return error("'confidence' must be a number.")
    if label not in ("good", "bad"):
        return error("'label' must be 'good' or 'bad'.")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO posture_logs (user_id, label, confidence, created_at) VALUES (?, ?, ?, ?)",
            (session["user_id"], label, round(confidence, 3), now_iso()),
        )
    return jsonify({"status": "ok"})


@app.route("/api/status")
@login_required
def api_status():
    user_id = session["user_id"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT label, COUNT(*) AS n FROM posture_samples WHERE user_id = ? GROUP BY label",
            (user_id,),
        ).fetchall()
    counts = {r["label"]: r["n"] for r in rows}
    return jsonify({
        "samples": {"good": counts.get("good", 0), "bad": counts.get("bad", 0)},
        "model_trained": os.path.isfile(model_file(user_id)),
    })


@app.route("/api/history")
@login_required
def api_history():
    user_id = session["user_id"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT label, COUNT(*) AS n FROM posture_logs WHERE user_id = ? GROUP BY label",
            (user_id,),
        ).fetchall()
        recent = conn.execute(
            "SELECT created_at, label, confidence FROM posture_logs "
            "WHERE user_id = ? ORDER BY id DESC LIMIT 100",
            (user_id,),
        ).fetchall()
    counts = {r["label"]: r["n"] for r in rows}
    good, bad = counts.get("good", 0), counts.get("bad", 0)
    total = good + bad
    return jsonify({
        "summary": {
            "total": total,
            "good_pct": round(good / total * 100, 1) if total else 0,
            "bad_pct": round(bad / total * 100, 1) if total else 0,
        },
        "records": [
            {"timestamp": r["created_at"], "label": r["label"], "confidence": r["confidence"]}
            for r in recent
        ],
    })


@app.route("/api/retrain", methods=["POST"])
@login_required
def api_retrain():
    user_id = session["user_id"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT neck_angle, head_height, head_roll, shoulder_tilt, label "
            "FROM posture_samples WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    X = [[r["neck_angle"], r["head_height"], r["head_roll"], r["shoulder_tilt"]] for r in rows]
    y = [r["label"] for r in rows]
    result = train_from_arrays(X, y, model_file(user_id))
    if result.get("error"):
        return jsonify(result), 400
    _models.pop(user_id, None)
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)