/* hands.js — MediaPipe hand tracking: aim with index finger, FIRE by curling the thumb.
   Exposes window.Hands for game.js. Runs fully in the browser, no server. */

import { HandLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const Hands = {
  status: 'loading',
  error: '',
  landmarker: null,
  video: null,
  lastVideoTime: -1,

  present: false,
  aimX: 0.5,
  aimY: 0.5,
  thumbCurl: 1.5,
  landmarks: null,
  fireFlash: 0,

  _shots: 0,
  _armed: false,
  _lastShotAt: -Infinity,
  _lostFrames: 0,
  _stableFrames: 0,
  _fireFrames: 0,
  _releaseFrames: 0,
  _wasPresent: false,
  _handSince: 0,
  _thumbScore: 1,
  _lastThumbScore: 1,

  /* Trigger tuning. Higher score = more extended thumb, lower = more curled. */
  CURL_FIRE: 0.38,
  CURL_ARM: 0.62,
  CONFIRM_FRAMES: 4,
  RELEASE_FRAMES: 3,
  STABLE_FRAMES: 3,
  GRACE_MS: 500,
  COOLDOWN: 450,

  async init() {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.60,
        minHandPresenceConfidence: 0.60,
        minTrackingConfidence: 0.60,
      });
      this.status = 'ready';
    } catch (e) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.60,
          minHandPresenceConfidence: 0.60,
          minTrackingConfidence: 0.60,
        });
        this.status = 'ready';
      } catch (e2) {
        this.status = 'error';
        this.error = e2.message || String(e2);
      }
    }
    window.dispatchEvent(new CustomEvent('hands-status', { detail: this.status }));
  },

  async startCamera(videoEl) {
    this.video = videoEl;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: 'user' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, min: 24 },
        },
        audio: false,
      });
    } catch (err) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, min: 24 },
        },
        audio: false,
      });
    }
    videoEl.srcObject = stream;
    await new Promise((res) => {
      videoEl.onloadedmetadata = res;
      setTimeout(res, 3000);
    });
    await videoEl.play();
  },

  detect(nowMs) {
    if (!this.landmarker || !this.video || this.video.readyState < 2) {
      this.present = false;
      return this;
    }
    if (this.video.currentTime === this.lastVideoTime) return this;
    this.lastVideoTime = this.video.currentTime;

    let res;
    try { res = this.landmarker.detectForVideo(this.video, nowMs); }
    catch (e) { return this; }

    const lm = res.landmarks && res.landmarks[0];
    if (!lm) {
      this._lostFrames++;
      this._stableFrames = 0;
      this._fireFrames = 0;
      this._releaseFrames = 0;
      if (this._lostFrames > 3) {
        this.present = false;
        this.landmarks = null;
        this._wasPresent = false;
        this._armed = false;
      }
      return this;
    }

    this._lostFrames = 0;
    this._stableFrames++;
    this.present = this._stableFrames >= this.STABLE_FRAMES;
    this.landmarks = lm;

    /* Aim uses the index fingertip. Smooth enough to suppress landmark jitter,
       but still responsive for a game crosshair. */
    const tx = 1 - lm[8].x;
    const ty = lm[8].y;
    const smooth = 0.30;
    this.aimX += (tx - this.aimX) * smooth;
    this.aimY += (ty - this.aimY) * smooth;

    const now = performance.now();
    if (!this._wasPresent && this.present) {
      this._armed = false;
      this._fireFrames = 0;
      this._releaseFrames = 0;
      this._handSince = now;
    }
    this._wasPresent = this.present;

    /*
       Robust thumb-curl metric:
       - old code used only thumb-tip -> index-MCP in 2D;
       - this uses 3D thumb joint angle + thumb-tip distance to the palm;
       - both are normalized by hand size, making the result much less
         sensitive to distance from camera and hand rotation.

       A single accidental landmark jump therefore has much less influence.
    */
    const handSize = dist3d(lm[0], lm[9]) || 1e-4; // wrist -> middle MCP
    const palmCenter = average3d(lm[0], lm[5], lm[9], lm[13], lm[17]);

    const thumbAngle = angle3d(lm[2], lm[3], lm[4]); // MCP-IP-tip
    const thumbReach = dist3d(lm[4], palmCenter) / handSize;

    /* angleNorm: 1 = straight, 0 = strongly folded. */
    const angleNorm = clamp((thumbAngle - 45) / 120, 0, 1);
    /* reachNorm: 1 = extended away from palm, 0 = tucked in. */
    const reachNorm = clamp((thumbReach - 0.38) / 0.72, 0, 1);

    /* Combining independent geometry is substantially safer than one distance. */
    const rawScore = angleNorm * 0.62 + reachNorm * 0.38;
    const score = this._thumbScore + (rawScore - this._thumbScore) * 0.35;
    this._lastThumbScore = this._thumbScore;
    this._thumbScore = score;
    this.thumbCurl = score;

    const fired = score < this.CURL_FIRE;
    const released = score > this.CURL_ARM;
    this._fireFrames = fired ? this._fireFrames + 1 : 0;
    this._releaseFrames = released ? this._releaseFrames + 1 : 0;

    const settled = this.present && now - this._handSince > this.GRACE_MS;
    const stableTrigger = this._fireFrames >= this.CONFIRM_FRAMES;
    const stableRelease = this._releaseFrames >= this.RELEASE_FRAMES;

    if (stableRelease) {
      this._armed = true;
    }

    if (fired && this._armed && settled && stableTrigger &&
        now - this._lastShotAt >= this.COOLDOWN) {
      this._shots++;
      this._armed = false;
      this._lastShotAt = now;
      this.fireFlash = 12;
    }

    if (this.fireFlash > 0) this.fireFlash--;
    return this;
  },

  takeShots() {
    const n = this._shots;
    this._shots = 0;
    return n;
  },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function dist3d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function average3d(...points) {
  const p = { x: 0, y: 0, z: 0 };
  for (const q of points) {
    p.x += q.x; p.y += q.y; p.z += q.z || 0;
  }
  p.x /= points.length;
  p.y /= points.length;
  p.z /= points.length;
  return p;
}

/* Angle ABC in 3D, returned in degrees. */
function angle3d(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const abLen = Math.hypot(ab.x, ab.y, ab.z);
  const cbLen = Math.hypot(cb.x, cb.y, cb.z);
  if (!abLen || !cbLen) return 180;
  const cosine = clamp((ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / (abLen * cbLen), -1, 1);
  return Math.acos(cosine) * 180 / Math.PI;
}

window.Hands = Hands;
Hands.init();
