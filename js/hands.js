/* hands.js — MediaPipe hand tracking: aim with index finger, FIRE by curling the thumb.
   Exposes window.Hands for game.js. Runs fully in the browser, no server. */

import { HandLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const Hands = {
  status: 'loading',        // loading | ready | error
  error: '',
  landmarker: null,
  video: null,
  lastVideoTime: -1,

  /* live state consumed by the game */
  present: false,           // is a hand visible right now
  aimX: 0.5,                // smoothed, mirrored, normalized 0..1
  aimY: 0.5,
  thumbCurl: 1.5,           // debug value shown on HUD
  landmarks: null,          // current landmarks (for PIP skeleton)
  fireFlash: 0,             // >0 right after a trigger event

  _shots: 0,                // pending shot events
  _armed: false,            // must release thumb to arm (also on hand entry)
  _lastShotAt: 0,
  _lostFrames: 0,
  _fireFrames: 0,           // consecutive frames below fire threshold
  _wasPresent: false,
  _handSince: 0,            // when the current hand first appeared

  /* tuned trigger thresholds (ratios relative to hand size) */
  CURL_FIRE: 0.58,  CURL_ARM: 0.85,   // thumb tucked toward palm  -> fire
  CONFIRM_FRAMES: 2,                  // curl must hold 2 frames (kills jitter)
  GRACE_MS: 450,                      // no firing right after hand appears
  COOLDOWN: 400,                      // ms between shots

  async init() {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.status = 'ready';
    } catch (e) {
      /* GPU delegate can fail on some phones -> retry on CPU */
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 1,
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
      /* force the FRONT (selfie) camera — 'exact' makes it mandatory,
         so the browser can't silently switch to the back camera */
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      /* device rejected 'exact' (rare) -> ask for front as a preference */
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    }
    videoEl.srcObject = stream;
    await new Promise((res) => {
      videoEl.onloadedmetadata = res;
      setTimeout(res, 3000); // safety
    });
    await videoEl.play();
  },

  /* called once per game frame. Returns this (read .present/.aimX/.aimY). */
  detect(nowMs) {
    if (!this.landmarker || !this.video || this.video.readyState < 2) {
      this.present = false;
      return this;
    }
    if (this.video.currentTime === this.lastVideoTime) return this; // no new frame yet
    this.lastVideoTime = this.video.currentTime;

    let res;
    try { res = this.landmarker.detectForVideo(this.video, nowMs); }
    catch (e) { return this; }

    const lm = res.landmarks && res.landmarks[0];
    if (!lm) {
      this._lostFrames++;
      if (this._lostFrames > 6) {
        this.present = false; this.landmarks = null; this._wasPresent = false;
      }
      return this;
    }
    this._lostFrames = 0;
    this.present = true;
    this.landmarks = lm;

    /* ---- aim: index fingertip (landmark 8), mirrored so it feels natural ---- */
    const tx = 1 - lm[8].x;
    const ty = lm[8].y;
    const smooth = 0.38;
    this.aimX += (tx - this.aimX) * smooth;
    this.aimY += (ty - this.aimY) * smooth;

    /* ---- trigger: deliberate thumb curl only (pinch removed — pointing
       at the camera makes thumb+index overlap in 2D and caused ghost shots) ---- */
    const now = performance.now();
    if (!this._wasPresent) {
      // hand just entered frame: disarm until the thumb is clearly released
      this._armed = false;
      this._fireFrames = 0;
      this._handSince = now;
    }
    this._wasPresent = true;

    const handSize = dist2d(lm[0], lm[9]) || 1e-4; // wrist -> middle MCP
    const curl = dist2d(lm[4], lm[5]) / handSize;  // thumb tip -> index base
    this.thumbCurl = curl;

    const fired = curl < this.CURL_FIRE;
    const released = curl > this.CURL_ARM;
    this._fireFrames = fired ? this._fireFrames + 1 : 0;

    const settled = now - this._handSince > this.GRACE_MS;
    if (fired && this._armed && settled &&
        this._fireFrames >= this.CONFIRM_FRAMES &&
        now - this._lastShotAt > this.COOLDOWN) {
      this._shots++;
      this._armed = false;
      this._lastShotAt = now;
      this.fireFlash = 12;
    } else if (released) {
      this._armed = true;
    }
    if (this.fireFlash > 0) this.fireFlash--;
    return this;
  },

  /* consume pending shot events (usually 0 or 1 per frame) */
  takeShots() { const n = this._shots; this._shots = 0; return n; },
};

function dist2d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

window.Hands = Hands;
Hands.init(); // start loading the model immediately
