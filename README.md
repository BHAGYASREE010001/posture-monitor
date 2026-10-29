# Smart Posture Monitor

Webcam posture monitor with login, a SQLite database, and a per-user learning model.

## Run (Windows PowerShell)
    cd backend
    python -m venv venv
    venv\Scripts\python.exe -m pip install -r requirements.txt
    venv\Scripts\python.exe app.py

Open http://localhost:5000 and sign up.

## Structure
- backend/app.py: Flask server, accounts, database, API
- backend/train_model.py: k-nearest-neighbours classifier (plain Python)
- frontend/: login, register, live monitor, history pages
- frontend/js/monitor.js: live monitor logic
- frontend/js/posture-features.js: measurements from MediaPipe landmarks
- frontend/js/config.js: thresholds