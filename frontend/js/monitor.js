/**
 * monitor.js - Live Monitor page logic (index.html).
 *
 * GOOD / BAD comes from head height and head tilt compared with your "Set good posture" level.
 * While you use the monitor, each second is also saved as an automatic learning sample,
 * labelled with the same decision, and the model retrains every AUTO_RETRAIN_EVERY samples.
 */
import "./pose-detector.js";
import { extractFeatures, featuresToArray } from "./posture-features.js";
import {
  POSTURE_GOOD_PERCENT,
  ROLL_TOLERANCE_DEG,
  BAD_POSTURE_ALERT_SECONDS,
  REST_INTERVAL_MS,
  BASELINE_SECONDS,
} from "./config.js";

const $ = (id) => document.getElementById(id);

const LOG_EVERY_MS = 1000;
const SAMPLE_EVERY_MS = 1000;   // one automatic learning sample per second
const AUTO_RETRAIN_EVERY = 60;  // retrain after every 60 automatic samples
const PREDICT_EVERY_MS = 1000;
const CHART_POINTS = 60;

const el = {
  video: $("video"),
  canvas: $("canvas"),
  badge: $("person-badge"),
  badOverlay: $("bad-overlay"),
  neck: $("neck"),
  tilt: $("tilt"),
  badDuration: $("bad-duration"),
  score: $("score"),
  postureAlert: $("posture-alert"),
  alertTitle: $("alert-title"),
  restAlert: $("rest-alert"),
  restDone: $("rest-done"),
  spine: $("spine"),
  error: $("error-msg"),
  username: $("username"),
  logout: $("logout"),
  counts: $("sample-counts"),
  btnGood: $("btn-good"),
  btnBad: $("btn-bad"),
  btnCalibrate: $("btn-calibrate"),
  btnTrain: $("btn-train"),
  trainMsg: $("train-msg"),
};

const state = {
  features: null,
  badSince: null,
  screenStart: null,
  restShowing: false,
  lastScore: null,
  lastLogAt: 0,
  lastSampleAt: 0,
  autoCount: 0,
  samples: { good: 0, bad: 0 },
  modelLabel: null,
  modelConfidence: null,
  predicting: false,
  lastPredictAt: 0,
  baseline: null,
  baseRoll: null,
  calibStart: null,
  calibHeights: [],
  calibRolls: [],
  smooth: null,
  smoothRoll: null,
};

async function api(url, body) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not logged in");
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function safe(fn) {
  fn().catch(() => {});
}

function setBadge(text, cls) {
  el.badge.textContent = text;
  el.badge.className = `pill ${cls}`;
}

// bend: 0 = straight spine, larger = more curved
function drawSpine(bend, mode) {
  const baseX = 150, baseY = 225, topY = 40;
  const topX = baseX - bend * 1.2;
  const ctrlX = baseX - bend * 0.5;
  const ctrlY = (baseY + topY) / 2;
  const color = mode === "bad" ? "#ff5b6e" : mode === "good" ? "#3ecf8e" : "#5b6275";
  el.spine.innerHTML = `
    <line x1="${baseX}" y1="${baseY}" x2="${baseX}" y2="${topY}" stroke="#2b303b" stroke-width="2" stroke-dasharray="4 6"/>
    <path d="M ${baseX} ${baseY} Q ${ctrlX} ${ctrlY} ${topX} ${topY}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="${topX}" cy="${topY}" r="12" fill="${color}"/>
    <circle cx="${baseX}" cy="${baseY}" r="8" fill="#8b93a7"/>`;
}

function showIdle(message) {
  state.features = null;
  state.badSince = null;
  state.lastScore = null;
  state.smooth = null;
  state.smoothRoll = null;
  // Leaving the frame restarts the good-posture countdown if it has not finished yet.
  if (state.baseline === null) {
    state.calibStart = null;
    state.calibHeights = [];
    state.calibRolls = [];
  }
  el.neck.textContent = "—";
  el.tilt.textContent = "—";
  el.score.textContent = "—";
  el.badDuration.textContent = "0s";
  el.postureAlert.classList.add("hidden");
  el.badOverlay.classList.add("hidden");
  setBadge(message, "");
  drawSpine(0, "idle");
}

// ----- Rest reminder: every 1 minute of screen time -----

function updateRestTimer(now) {
  if (state.screenStart === null) state.screenStart = now;
  if (!state.restShowing && now - state.screenStart >= REST_INTERVAL_MS) {
    state.restShowing = true;
    el.restAlert.classList.remove("hidden");
  }
}

function resetRestTimer() {
  state.screenStart = null;
  state.restShowing = false;
  el.restAlert.classList.add("hidden");
}

// ----- Good posture level (calibration) -----

function startCalibration() {
  state.baseline = null;
  state.baseRoll = null;
  state.calibStart = null;
  state.calibHeights = [];
  state.calibRolls = [];
  el.trainMsg.textContent =
    `Sit properly with your head up and straight. Hold still for ${BASELINE_SECONDS} seconds.`;
}

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function updateCalibration(features, now) {
  if (state.baseline !== null) return;
  if (state.calibStart === null) state.calibStart = now;
  state.calibHeights.push(features.head_height);
  state.calibRolls.push(features.head_roll);
  if (now - state.calibStart >= BASELINE_SECONDS * 1000) {
    state.baseline = average(state.calibHeights);
    state.baseRoll = average(state.calibRolls);
    state.calibHeights = [];
    state.calibRolls = [];
    el.trainMsg.textContent = "Good posture level saved. Samples are now recorded automatically.";
  }
}

// ----- Samples, learning and prediction -----

function renderStatus() {
  const total = state.samples.good + state.samples.bad;
  const model = state.modelLabel
    ? `Model: ${state.modelLabel.toUpperCase()} ${Math.round(state.modelConfidence * 100)}%`
    : "Model: still learning";
  el.counts.textContent =
    `Samples: ${total} (good ${state.samples.good}, bad ${state.samples.bad})  ·  ${model}`;
}

async function retrain(auto) {
  const { ok, data } = await api("/api/retrain", {});
  if (ok) {
    const used = data.train_samples + data.test_samples;
    el.trainMsg.textContent =
      `Model trained on ${used} samples. Accuracy on unseen samples: ${(data.accuracy * 100).toFixed(0)}%`;
  } else if (!auto) {
    el.trainMsg.textContent = data.message;
  }
}

async function autoLearn(label, features, now) {
  if (now - state.lastSampleAt < SAMPLE_EVERY_MS) return;
  state.lastSampleAt = now;
  const { ok } = await api("/api/collect", {
    features: featuresToArray(features),
    label,
    source: "auto",
  });
  if (!ok) return;
  state.samples[label] += 1;
  state.autoCount += 1;
  renderStatus();
  if (state.autoCount % AUTO_RETRAIN_EVERY === 0) await retrain(true);
}

async function recordSample(label) {
  if (!state.features) {
    el.trainMsg.textContent = "Move fully into the camera frame first.";
    return;
  }
  const { ok, data } = await api("/api/collect", {
    features: featuresToArray(state.features),
    label,
    source: "manual",
  });
  if (!ok) {
    el.trainMsg.textContent = data.message || "Could not save the sample.";
    return;
  }
  state.samples[label] += 1;
  renderStatus();
  el.trainMsg.textContent = `Correction saved as ${label.toUpperCase()}.`;
}

async function requestPrediction(features, now) {
  if (state.predicting || now - state.lastPredictAt < PREDICT_EVERY_MS) return;
  state.predicting = true;
  state.lastPredictAt = now;
  try {
    const { ok, data } = await api("/api/predict", { features: featuresToArray(features) });
    state.modelLabel = ok ? data.label : null;
    state.modelConfidence = ok ? data.confidence : null;
    renderStatus();
  } catch (e) {
    // Keep the last value if the request fails.
  } finally {
    state.predicting = false;
  }
}

async function loadStatus() {
  const { data } = await api("/api/status");
  state.samples = data.samples;
  renderStatus();
}

// ----- Frame handling -----

function logReading(label, now) {
  if (now - state.lastLogAt < LOG_EVERY_MS) return;
  state.lastLogAt = now;
  safe(() => api("/api/log", { label, confidence: 1 }));
}

function onFrame(landmarks) {
  const now = Date.now();

  if (!landmarks) {
    resetRestTimer();
    showIdle("NO PERSON");
    return;
  }
  const features = extractFeatures(landmarks);
  if (!features) {
    showIdle("MOVE INTO FRAME");
    return;
  }

  state.features = features;
  updateRestTimer(now);
  updateCalibration(features, now);

  if (state.baseline === null) {
    const secondsLeft = Math.max(0, Math.ceil((BASELINE_SECONDS * 1000 - (now - state.calibStart)) / 1000));
    setBadge(`CALIBRATING ${secondsLeft}s - sit still`, "");
    el.neck.textContent = "—";
    el.tilt.textContent = "—";
    el.score.textContent = "—";
    el.badDuration.textContent = "0s";
    el.postureAlert.classList.add("hidden");
    el.badOverlay.classList.add("hidden");
    drawSpine(0, "idle");
    return;
  }

  // Smooth both measurements over recent frames to reduce camera jitter.
  state.smooth = state.smooth === null
    ? features.head_height
    : state.smooth * 0.6 + features.head_height * 0.4;
  state.smoothRoll = state.smoothRoll === null
    ? features.head_roll
    : state.smoothRoll * 0.6 + features.head_roll * 0.4;

  const percent = state.baseline > 0 ? (state.smooth / state.baseline) * 100 : 100;
  const tiltOff = Math.abs(state.smoothRoll - state.baseRoll);
  const forwardBad = percent < POSTURE_GOOD_PERCENT;
  const sideBad = tiltOff > ROLL_TOLERANCE_DEG;
  const improper = forwardBad || sideBad;

  if (improper && state.badSince === null) state.badSince = now;
  if (!improper) state.badSince = null;
  const badSeconds = state.badSince === null ? 0 : Math.floor((now - state.badSince) / 1000);

  el.neck.textContent = `${Math.round(percent)}%`;
  el.tilt.textContent = `${tiltOff.toFixed(1)}°`;
  el.badDuration.textContent = `${badSeconds}s`;

  state.lastScore = Math.round(Math.min(100, Math.max(0, Math.min(percent, 100 - tiltOff * 4))));
  el.score.textContent = state.lastScore;

  el.badOverlay.classList.toggle("hidden", !improper);
  el.postureAlert.classList.toggle("hidden", !improper);
  el.alertTitle.textContent = badSeconds >= BAD_POSTURE_ALERT_SECONDS
    ? "Sit in proper position now"
    : "BAD POSTURE";

  const bend = Math.min(90, Math.max(0, (100 - percent) * 2));
  drawSpine(bend, improper ? "bad" : "good");

  setBadge(improper ? "BAD POSTURE" : "GOOD POSTURE", improper ? "pill-bad" : "pill-good");
  logReading(improper ? "bad" : "good", now);

  safe(() => autoLearn(improper ? "bad" : "good", features, now));
  requestPrediction(features, now);
}

// ----- Score over time chart -----

let scoreChart = null;

function initChart() {
  scoreChart = new Chart($("scoreChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: "#ffb673",
        backgroundColor: "rgba(255, 182, 115, 0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { min: 0, max: 100, ticks: { color: "#8b93a7", stepSize: 20 }, grid: { color: "#2b303b" } },
      },
    },
  });
}

function tick() {
  if (state.lastScore === null) return;
  const d = scoreChart.data;
  d.labels.push("");
  d.datasets[0].data.push(state.lastScore);
  if (d.labels.length > CHART_POINTS) {
    d.labels.shift();
    d.datasets[0].data.shift();
  }
  scoreChart.update("none");
}

// ----- Buttons and keys -----

async function loadMe() {
  const { data } = await api("/api/me");
  el.username.textContent = data.username;
}

el.btnGood.addEventListener("click", () => safe(() => recordSample("good")));
el.btnBad.addEventListener("click", () => safe(() => recordSample("bad")));
el.btnCalibrate.addEventListener("click", () => startCalibration());

el.btnTrain.addEventListener("click", () => safe(async () => {
  el.trainMsg.textContent = "Training…";
  await retrain(false);
}));

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === "g") safe(() => recordSample("good"));
  if (key === "b") safe(() => recordSample("bad"));
  if (key === "c") startCalibration();
});

el.restDone.addEventListener("click", () => {
  state.screenStart = Date.now();
  state.restShowing = false;
  el.restAlert.classList.add("hidden");
});

el.logout.addEventListener("click", () => safe(async () => {
  await api("/api/logout", {});
  window.location.href = "/login";
}));

// ----- Start -----

initChart();
safe(loadMe);
safe(loadStatus);
setInterval(tick, 1000);

setBadge("OPENING CAMERA...", "");
window.startPoseDetection(el.video, el.canvas, onFrame).catch((e) => {
  el.error.textContent = "Camera error: " + e.message + ". Allow camera access and reload the page.";
  el.error.classList.remove("hidden");
});