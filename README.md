# HAND HUNT

**A Duck Hunt (NES, 1984) remake where your hand is the gun.**
Point your index finger to aim, curl your thumb to shoot — no controller, no webcam rig, just your phone's front camera and [MediaPipe](https://ai.google.dev/edge/mediapipe) hand tracking running fully in the browser.

**Play it live: [https://hand-hunt-zeta.vercel.app](https://hand-hunt-zeta.vercel.app)**

## Screenshots

| Title screen | Gameplay |
|:---:|:---:|
| ![Title screen](https://hand-hunt-zeta.vercel.app/screenshots/home.png) | ![Gameplay](https://hand-hunt-zeta.vercel.app/screenshots/gameplay.png) |

## How to play

1. Open the game on your phone (landscape works best) and pick **Game A** (1 duck) or **Game B** (2 ducks).
2. Allow camera access — the **front camera** watches your hand.
3. **AIM** — point your index finger; move your hand to move the crosshair.
4. **FIRE** — curl your thumb down sharply, like pulling a trigger. Release to re-arm.
5. Hit 6 of 10 ducks to clear the round. Miss and the dog laughs at you. Just like 1984.

Tips: keep the phone ~one arm away, good lighting, one hand in frame.

## Features

- Real-time 21-landmark hand tracking (MediaPipe HandLandmarker, GPU with CPU fallback)
- Thumb-curl trigger with anti-ghost-shot safety: hysteresis, 2-frame confirmation, release-to-arm, grace period and cooldown
- Full Duck Hunt loop: rounds, 3 shots per wave, fly-away timer, falling ducks, score values by round, perfect-round bonus, game over
- The dog: sniffs at round start, holds up your ducks, laughs when you miss
- Live camera picture-in-picture with hand skeleton + FIRE indicator
- Retro NES-style rendering (256x240 logical resolution) and synthesized WebAudio sound effects — zero asset files
- Minimal Manrope title screen; touch/mouse fallback controls when no hand is detected

## Tech stack

- Vanilla JavaScript + Canvas (no framework, no build step)
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) (hand landmarker, loaded from CDN)
- WebAudio API for all sound effects
- Served as a static site (Vercel)

## Run locally

```bash
# any static server works, e.g.:
python -m http.server 8080
# open http://localhost:8080
```

Camera access requires a secure context (HTTPS or localhost). To play on your phone from your PC, expose the local server through a tunnel (e.g. `npx cloudflared tunnel --url http://localhost:8080`) or deploy to Vercel.

## Project structure

```
index.html        title screen + layout
css/style.css     minimal UI styles (Manrope)
js/hands.js       MediaPipe hand tracking, aim + thumb-curl trigger
js/game.js        game engine: ducks, dog, rounds, scoring, HUD
js/audio.js       WebAudio retro SFX synth
screenshots/      images used in this README
```

## Privacy

All hand tracking runs **on-device in your browser**. No video ever leaves your phone.

---

Fan-made tribute for learning purposes. Duck Hunt is a trademark of Nintendo; this project is not affiliated with or endorsed by Nintendo.
