/**
 * posture-features.js - computes posture measurements from MediaPipe landmarks.
 *
 * neck_angle:    angle of the neck from vertical.
 * head_height:   how high the head is above the shoulders (ears and nose), divided by shoulder width.
 * head_roll:     sideways tilt of the head in degrees.
 * shoulder_tilt: how uneven the shoulders are.
 */

const LANDMARK = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
};

const FEATURE_NAMES = ["neck_angle", "head_height", "head_roll", "shoulder_tilt"];
const MIN_VISIBILITY = 0.5;

function angleToVertical(pLower, pUpper) {
  const dx = pUpper.x - pLower.x;
  let dy = pLower.y - pUpper.y; // image y grows downward
  if (dy === 0) dy = 1e-6;
  return Math.abs(Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI));
}

/**
 * landmarks: 33 points, each {x, y, z, visibility}, normalized 0-1.
 * Returns the measurements, or null if the ears or shoulders are not visible.
 */
export function extractFeatures(landmarks) {
  const lEar = landmarks[LANDMARK.LEFT_EAR];
  const rEar = landmarks[LANDMARK.RIGHT_EAR];
  const lSh = landmarks[LANDMARK.LEFT_SHOULDER];
  const rSh = landmarks[LANDMARK.RIGHT_SHOULDER];
  const nose = landmarks[LANDMARK.NOSE];

  const points = [lEar, rEar, lSh, rSh];
  if (points.some((p) => !p || (p.visibility ?? 1) < MIN_VISIBILITY)) return null;

  const midEar = { x: (lEar.x + rEar.x) / 2, y: (lEar.y + rEar.y) / 2 };
  const midSh = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 };
  const shoulderWidth = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y) + 1e-6;

  const earHeight = (midSh.y - midEar.y) / shoulderWidth;
  const noseVisible = nose && (nose.visibility ?? 1) >= MIN_VISIBILITY;
  const noseHeight = noseVisible ? (midSh.y - nose.y) / shoulderWidth : earHeight;
  const headHeight = (earHeight + noseHeight) / 2;

  const earAngle = Math.atan2(rEar.y - lEar.y, rEar.x - lEar.x);
  const shoulderAngle = Math.atan2(rSh.y - lSh.y, rSh.x - lSh.x);
  let headRoll = ((earAngle - shoulderAngle) * 180) / Math.PI;
  headRoll = ((headRoll + 540) % 360) - 180;

  const shoulderTilt = Math.abs(lSh.y - rSh.y) / shoulderWidth;
  const neckAngle = angleToVertical(midSh, midEar);

  return {
    neck_angle: Number(neckAngle.toFixed(2)),
    head_height: Number(headHeight.toFixed(3)),
    head_roll: Number(headRoll.toFixed(2)),
    shoulder_tilt: Number(shoulderTilt.toFixed(3)),
  };
}

export function featuresToArray(features) {
  return FEATURE_NAMES.map((name) => features[name]);
}