/**
 * pose-detector.js
 * Wraps MediaPipe's Pose Landmarker (runs fully in the browser; no images are sent to the server)
 * and drives the webcam + detection loop.
 * Exposes window.startPoseDetection(videoEl, canvasEl, onResult), which calls onResult(landmarks | null) per frame.
 */

import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

let poseLandmarker = null;

async function initPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

async function startWebcam(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve();
  });
  videoEl.play();
}

window.startPoseDetection = async function (videoEl, canvasEl, onResult) {
  await initPoseLandmarker();
  await startWebcam(videoEl);

  const ctx = canvasEl ? canvasEl.getContext("2d") : null;
  const drawingUtils = ctx ? new DrawingUtils(ctx) : null;
  let lastTime = -1;

  function loop() {
    if (videoEl.readyState >= 2 && videoEl.currentTime !== lastTime) {
      lastTime = videoEl.currentTime;
      const result = poseLandmarker.detectForVideo(videoEl, performance.now());

      if (canvasEl) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        ctx.save();
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      }

      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];
        if (drawingUtils) {
          drawingUtils.drawLandmarks(landmarks, { radius: 3 });
          drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);
        }
        onResult(landmarks);
      } else {
        onResult(null);
      }

      if (ctx) ctx.restore();
    }
    requestAnimationFrame(loop);
  }
  loop();
};