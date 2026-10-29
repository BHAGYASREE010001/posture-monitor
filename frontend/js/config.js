/**
 * config.js - settings for the live monitor.
 */

// BAD POSTURE when head height drops below this percentage of your good-posture level.
// Higher = more sensitive. Lower = fewer alerts.
export const POSTURE_GOOD_PERCENT = 92;

// BAD POSTURE when the head tilts sideways by more than this many degrees
// compared with your good-posture tilt. Lower = more sensitive.
export const ROLL_TOLERANCE_DEG = 6;

// How long bad posture must last before the alert changes to "Sit in proper position now".
export const BAD_POSTURE_ALERT_SECONDS = 8;

// Rest reminder after this much continuous screen time (1 minute).
export const REST_INTERVAL_MS = 60 * 1000;

// How many seconds to measure your good posture when you start or press "Set good posture".
export const BASELINE_SECONDS = 5;