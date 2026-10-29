"""
train_model.py - trains a k-nearest-neighbours (k-NN) classifier from a user's samples.

Written in plain Python (no numpy or scikit-learn) because Windows Application Control
blocks some compiled ML libraries on this computer. The trained model is saved as JSON.
"""

import json
import math
import random

K = 5
TEST_FRACTION = 0.2


def _fit_scaler(rows):
    n = len(rows)
    d = len(rows[0])
    means = [sum(r[j] for r in rows) / n for j in range(d)]
    stds = []
    for j in range(d):
        var = sum((r[j] - means[j]) ** 2 for r in rows) / n
        stds.append(math.sqrt(var) or 1.0)
    return means, stds


def _scale(row, means, stds):
    return [(v - m) / s for v, m, s in zip(row, means, stds)]


def _build_model(rows):
    means, stds = _fit_scaler([features for features, _ in rows])
    return {
        "means": means,
        "stds": stds,
        "k": min(K, len(rows)),
        "points": [_scale(features, means, stds) for features, _ in rows],
        "labels": [label for _, label in rows],
    }


def knn_predict(model, features):
    x = _scale(features, model["means"], model["stds"])
    distances = []
    for point, label in zip(model["points"], model["labels"]):
        d = sum((a - b) ** 2 for a, b in zip(x, point))
        distances.append((d, label))
    distances.sort(key=lambda item: item[0])
    nearest = distances[: model["k"]]
    votes = {}
    for _, label in nearest:
        votes[label] = votes.get(label, 0) + 1
    best = max(votes, key=votes.get)
    return best, votes[best] / len(nearest)


def load_model(path):
    with open(path) as f:
        return json.load(f)


def train_from_arrays(X, y, model_path):
    if len(y) == 0:
        return {"error": "no_data", "message": "No samples yet. Record some GOOD and BAD samples first."}

    rows = [([float(v) for v in features], str(label)) for features, label in zip(X, y)]
    labels = sorted({label for _, label in rows})
    if len(labels) < 2:
        return {"error": "single_class", "message": "Need samples for BOTH good and bad before training."}
    counts = {lab: sum(1 for _, other in rows if other == lab) for lab in labels}
    if min(counts.values()) < 2:
        return {"error": "too_little_data", "message": "Need at least 2 samples of each label before training."}

    rng = random.Random(42)
    train_rows, test_rows = [], []
    for lab in labels:
        group = [r for r in rows if r[1] == lab]
        rng.shuffle(group)
        n_test = max(1, round(len(group) * TEST_FRACTION))
        test_rows += group[:n_test]
        train_rows += group[n_test:]

    check_model = _build_model(train_rows)
    correct = sum(1 for features, label in test_rows if knn_predict(check_model, features)[0] == label)
    accuracy = correct / len(test_rows)

    with open(model_path, "w") as f:
        json.dump(_build_model(rows), f)

    return {
        "status": "ok",
        "accuracy": round(accuracy, 4),
        "train_samples": len(train_rows),
        "test_samples": len(test_rows),
    }