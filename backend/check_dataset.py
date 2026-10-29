import sqlite3
c = sqlite3.connect("data/posture.db")
print("Total samples:", c.execute("SELECT COUNT(*) FROM posture_samples").fetchone()[0])
for label, source, n in c.execute("SELECT label, source, COUNT(*) FROM posture_samples GROUP BY label, source"):
    print(f"{label:5} {source:7} {n}")
print("Days with data:", c.execute("SELECT COUNT(DISTINCT DATE(created_at)) FROM posture_samples").fetchone()[0])
print("First sample:", c.execute("SELECT MIN(created_at) FROM posture_samples").fetchone()[0])
print("Last sample:", c.execute("SELECT MAX(created_at) FROM posture_samples").fetchone()[0])
