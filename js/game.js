/* game.js — HAND HUNT engine. NES-style Duck Hunt played with your hand.
   Logical resolution 256x240, scaled to fit the screen. */
(function () {
  'use strict';

  /* ================= constants ================= */
  const W = 256, H = 240;
  const SKY_TOP = 12, SKY_BOTTOM = 166;   // duck flight area
  const GRASS_Y = 168;                    // top of the grass strip
  const HUD_Y = 192;                      // top of bottom info bar
  const DUCKS_PER_ROUND = 10;
  const MIN_HITS = 6;                     // ducks you must hit to pass a round

  const DUCK_COLORS = [
    { body: '#101010', wing: '#3a3a3a' },  // black
    { body: '#00a800', wing: '#00e436' },  // green
    { body: '#b53121', wing: '#e45c10' },  // red
  ];

  const ST = {
    INTRO: 'intro', WAVE: 'wave', DOG: 'dog', SUMMARY: 'summary', GAMEOVER: 'gameover',
  };

  /* ================= dom ================= */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const video = document.getElementById('cam');
  const startScreen = document.getElementById('startScreen');
  const statusLine = document.getElementById('statusLine');
  const btnA = document.getElementById('btnA');
  const btnB = document.getElementById('btnB');

  ctx.imageSmoothingEnabled = false;

  /* fit canvas to screen keeping 256:240 */
  function fitCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', fitCanvas);
  fitCanvas();

  /* ================= game state ================= */
  const G = {
    running: false,
    state: ST.INTRO,
    mode: 1,              // 1 = game A, 2 = game B
    round: 1,
    score: 0,
    topScore: 0,
    ammo: 3,
    ducksLeft: DUCKS_PER_ROUND,   // waves still to spawn this round
    hitsThisRound: 0,
    slots: [],            // 10 entries: 'pending'|'current'|'hit'|'miss'
    slotIndex: 0,
    ducks: [],            // active ducks this wave
    waveTimer: 0,
    stateTimer: 0,
    dogKind: 'hold',      // 'hold' | 'laugh'
    dogDucks: 1,
    popups: [],           // floating score texts
    muzzle: 0,            // frames of muzzle flash left
    shake: 0,
    flapClock: 0,
    hintTimer: 0,
  };

  /* crosshair (canvas coords) */
  const aim = { x: W / 2, y: H / 2, haveHand: false };

  /* pointer fallback input (also handy for desktop testing) */
  const pointer = { x: W / 2, y: H / 2, fire: false, used: false };

  /* ================= helpers ================= */
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function text(str, x, y, color, size, align) {
    ctx.font = (size || 8) + 'px "Press Start 2P", monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color || '#fcfcfc';
    ctx.fillText(str, Math.round(x), Math.round(y));
  }

  function duckValue() {
    if (G.round <= 1) return 500;
    if (G.round <= 3) return 800;
    return 1000;
  }

  /* ================= ducks ================= */
  function spawnWave() {
    G.ducks = [];
    G.ammo = 3;
    G.waveTimer = Math.max(3.2, 6.4 - G.round * 0.25);
    const n = G.mode;
    for (let i = 0; i < n; i++) {
      const speed = rand(50, 66) + G.round * 9;
      const ang = rand(Math.PI * 0.15, Math.PI * 0.85) * (Math.random() < 0.5 ? 1 : -1);
      G.ducks.push({
        x: n === 1 ? rand(60, W - 60) : (i === 0 ? rand(40, 100) : rand(W - 100, W - 40)),
        y: SKY_BOTTOM - 6,
        vx: Math.cos(ang) * speed * (Math.random() < 0.5 ? -1 : 1),
        vy: -Math.abs(Math.sin(ang) * speed) - 20,
        speed,
        state: 'fly',       // fly | hit | fall | landed | escape | gone
        anim: Math.random() * 3,
        turnIn: rand(0.5, 1.1),
        variant: (Math.random() * 3) | 0,
        hitTimer: 0,
        vyFall: 0,
      });
    }
    G.state = ST.WAVE;
  }

  function updateDuck(d, dt) {
    if (d.state === 'fly') {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.anim += dt * 10;
      /* bounce inside sky box */
      if (d.x < 14) { d.x = 14; d.vx = Math.abs(d.vx); }
      if (d.x > W - 14) { d.x = W - 14; d.vx = -Math.abs(d.vx); }
      if (d.y < SKY_TOP + 6) { d.y = SKY_TOP + 6; d.vy = Math.abs(d.vy); }
      if (d.y > SKY_BOTTOM) { d.y = SKY_BOTTOM; d.vy = -Math.abs(d.vy); }
      /* erratic direction changes */
      d.turnIn -= dt;
      if (d.turnIn <= 0) {
        d.turnIn = rand(0.45, 1.1);
        const a = rand(-Math.PI, Math.PI);
        d.vx = Math.cos(a) * d.speed;
        d.vy = Math.sin(a) * d.speed * 0.8 - d.speed * 0.15; // slight upward bias
      }
    } else if (d.state === 'hit') {
      d.hitTimer -= dt;
      if (d.hitTimer <= 0) {
        d.state = 'fall';
        d.vyFall = 0;
        SFX.fallWhistle();
      }
    } else if (d.state === 'fall') {
      d.vyFall += 460 * dt;
      d.y += d.vyFall * dt;
      if (d.y >= GRASS_Y - 2) {
        d.y = GRASS_Y - 2;
        d.state = 'landed';
        SFX.thud();
      }
    } else if (d.state === 'escape') {
      d.y += d.vy * dt;
      d.anim += dt * 14;
      if (d.y < -30) d.state = 'gone';
    }
  }

  function drawDuck(d) {
    const c = DUCK_COLORS[d.variant];
    const dir = d.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(Math.round(d.x), Math.round(d.y));
    if (d.state === 'fall') { ctx.rotate(Math.PI); }
    ctx.scale(dir, 1);

    if (d.state === 'fly' || d.state === 'escape') {
      const wing = Math.floor(d.anim) % 3; // 0 up, 1 mid, 2 down
      /* wing */
      if (wing === 0) px(-4, -13, 8, 9, c.wing);
      else if (wing === 1) px(-5, -4, 9, 6, c.wing);
      else px(-4, 4, 8, 9, c.wing);
      /* tail + body */
      px(-13, -2, 5, 4, c.body);
      px(-9, -4, 16, 9, c.body);
      /* white belly stripe */
      px(-7, 2, 12, 3, '#fcfcfc');
      /* head + beak + eye */
      px(5, -10, 7, 7, c.body);
      px(12, -8, 5, 3, '#e45c10');
      px(8, -8, 2, 2, '#fcfcfc');
      px(9, -8, 1, 1, '#000');
    } else {
      /* shot / fall: wings up in a V, X eyes */
      px(-9, -12, 4, 8, c.wing);
      px(4, -12, 4, 8, c.wing);
      px(-13, -2, 5, 4, c.body);
      px(-9, -4, 16, 9, c.body);
      px(-7, 2, 12, 3, '#fcfcfc');
      px(5, -10, 7, 7, c.body);
      px(12, -8, 5, 3, '#e45c10');
      px(7, -9, 1, 1, '#fff'); px(9, -7, 1, 1, '#fff');
      px(9, -9, 1, 1, '#fff'); px(7, -7, 1, 1, '#fff');
    }
    ctx.restore();
  }

  /* ================= the dog ================= */
  function drawDogHold(x, y, count) {
    /* dog rising from grass holding ducks aloft */
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    /* arms up */
    px(-14, -20, 4, 14, '#a05018');
    px(10, -20, 4, 14, '#a05018');
    /* head */
    px(-10, -8, 20, 14, '#c87830');
    px(-14, -10, 6, 8, '#8c4c14');   // ear L
    px(8, -10, 6, 8, '#8c4c14');    // ear R
    px(-6, 0, 12, 6, '#f0d0a0');    // muzzle
    px(-2, 1, 4, 3, '#101010');     // nose
    px(-6, -5, 3, 3, '#101010');    // eye L
    px(3, -5, 3, 3, '#101010');     // eye R
    px(-12, 6, 24, 12, '#c87830');  // chest
    /* held ducks */
    for (let i = 0; i < count; i++) {
      const dx = count === 1 ? 0 : (i === 0 ? -14 : 14);
      ctx.save();
      ctx.translate(dx, -26);
      ctx.rotate(Math.PI);
      px(-7, -3, 13, 7, DUCK_COLORS[0].body);
      px(-5, 2, 9, 2, '#fcfcfc');
      px(4, -7, 6, 5, DUCK_COLORS[0].body);
      px(-9, -1, 4, 3, DUCK_COLORS[0].body);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDogLaugh(x, y, frame) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + (frame ? 1 : 0)));
    /* head tilted back laughing */
    px(-10, -10, 20, 15, '#c87830');
    px(-15, -8, 6, 8, '#8c4c14');
    px(9, -12, 6, 8, '#8c4c14');
    /* closed happy eyes */
    px(-6, -6, 4, 1, '#101010');
    px(3, -6, 4, 1, '#101010');
    /* open laughing mouth */
    px(-4, -1, 9, frame ? 6 : 4, '#7c1c10');
    px(-2, frame ? 2 : 1, 5, 2, '#e45c5c');
    px(-3, -2, 7, 1, '#f0d0a0');
    /* paw covering mouth area */
    px(6, -2, 6, 5, '#a05018');
    px(-12, 6, 24, 12, '#c87830');
    ctx.restore();
  }

  function drawDogSniff(x, y, frame) {
    /* side-view dog walking, head down sniffing */
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    const bob = frame ? 1 : 0;
    /* body */
    px(-16, -8 + bob, 22, 10, '#c87830');
    /* tail */
    px(-20, -12 + bob, 5, 5, '#8c4c14');
    /* head down-front */
    px(4, -4 + bob, 12, 9, '#c87830');
    px(14, 0 + bob, 5, 4, '#f0d0a0');
    px(17, 1 + bob, 2, 2, '#101010');
    px(6, -8 + bob, 5, 5, '#8c4c14'); // ear
    px(8, -2 + bob, 2, 2, '#101010'); // eye
    /* legs */
    if (frame) { px(-12, 2, 4, 7, '#a05018'); px(0, 1, 4, 6, '#a05018'); }
    else { px(-12, 1, 4, 6, '#a05018'); px(0, 2, 4, 7, '#a05018'); }
    ctx.restore();
  }

  /* ================= background ================= */
  function drawBackground() {
    /* sky */
    px(0, 0, W, GRASS_Y, '#3cbcfc');
    /* sun-ish cloud deco */
    px(190, 24, 26, 8, '#fcfcfc'); px(198, 18, 14, 8, '#fcfcfc');
    px(30, 46, 22, 7, '#fcfcfc');
    /* tree on the left */
    px(20, 96, 10, 74, '#7c4a10');
    px(2, 58, 46, 44, '#008400');
    px(8, 46, 32, 20, '#00a800');
    px(14, 70, 24, 20, '#00a800');
    /* bushes on right */
    px(200, 146, 52, 24, '#008400');
    px(212, 138, 32, 14, '#00a800');
    px(150, 156, 30, 14, '#00a800');
    /* grass strip */
    px(0, GRASS_Y, W, 12, '#00a800');
    px(0, GRASS_Y, W, 3, '#00e436');
    for (let i = 0; i < 32; i++) px(i * 8 + ((i % 2) * 4), GRASS_Y + 6, 3, 3, '#008400');
    px(0, GRASS_Y + 12, W, HUD_Y - GRASS_Y - 12, '#005c00');
  }

  function drawHUD() {
    px(0, HUD_Y, W, H - HUD_Y, '#000');
    px(0, HUD_Y, W, 2, '#fcfcfc');

    /* round + ammo */
    text('R=' + String(G.round).padStart(2, '0'), 8, HUD_Y + 8, '#fcfcfc');
    for (let i = 0; i < 3; i++) {
      px(10 + i * 10, HUD_Y + 22, 6, 10, i < G.ammo ? '#e45c10' : '#3a3a3a');
      px(12 + i * 10, HUD_Y + 20, 2, 2, i < G.ammo ? '#fcfcfc' : '#3a3a3a');
    }
    text('SHOT', 8, HUD_Y + 36, '#7c7c7c');

    /* duck slots: 2 rows of 5 */
    for (let i = 0; i < DUCKS_PER_ROUND; i++) {
      const row = i < 5 ? 0 : 1;
      const col = i % 5;
      const sx = 92 + col * 14;
      const sy = HUD_Y + 8 + row * 17;
      const s = G.slots[i];
      let color = '#3a3a3a';
      if (s === 'hit') color = '#e45c10';
      else if (s === 'miss') color = '#00a800';
      else if (s === 'current' && (Math.floor(performance.now() / 250) % 2 === 0)) color = '#fcfcfc';
      drawMiniDuck(sx, sy, color);
    }

    /* score + hits */
    text('SCORE', 196, HUD_Y + 8, '#fcfcfc');
    text(String(G.score).padStart(6, '0'), 196, HUD_Y + 20, '#fcfcfc');
    text('HIT ' + G.hitsThisRound, 196, HUD_Y + 36, G.hitsThisRound >= MIN_HITS ? '#00e436' : '#fcfcfc');
  }

  function drawMiniDuck(x, y, color) {
    px(x, y + 2, 3, 3, color);       // head
    px(x + 3, y + 3, 2, 1, color);   // beak
    px(x - 2, y + 5, 7, 4, color);   // body
    px(x - 1, y + 9, 4, 1, color);   // feet
  }

  /* ================= camera PIP + crosshair ================= */
  function drawPIP() {
    const pw = 62, ph = 46, x = W - pw - 4, y = 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, pw + 4, ph + 4);
    const hands = window.Hands;
    if (hands && hands.video && hands.video.readyState >= 2) {
      ctx.save();
      ctx.translate(x + pw, y);
      ctx.scale(-1, 1);
      ctx.drawImage(hands.video, 0, 0, pw, ph);
      ctx.restore();
      /* hand skeleton */
      if (hands.landmarks) {
        ctx.fillStyle = hands.fireFlash > 0 ? '#ff3030' : '#30ff60';
        for (const p of hands.landmarks) {
          ctx.fillRect(Math.round(x + (1 - p.x) * pw) - 1, Math.round(y + p.y * ph) - 1, 2, 2);
        }
      }
    }
    /* status frame */
    ctx.strokeStyle = hands && hands.present ? '#30ff60' : '#ff3030';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1.5, y - 1.5, pw + 3, ph + 3);
    if (hands && hands.fireFlash > 0) text('FIRE!', x + 6, y + ph + 4, '#ff3030');
  }

  function drawCrosshair() {
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    const x = Math.round(aim.x), y = Math.round(aim.y);
    ctx.strokeStyle = aim.haveHand ? '#fcfcfc' : (blink ? '#8c8c8c' : '#fcfcfc');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
    ctx.stroke();
    if (G.muzzle > 0) {
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 ? 4 : 12;
        const mx = x + Math.cos(a) * r, my = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ================= input ================= */
  function canvasCoords(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H,
    };
  }
  canvas.addEventListener('pointermove', (e) => {
    const p = canvasCoords(e);
    pointer.x = p.x; pointer.y = p.y; pointer.used = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    const p = canvasCoords(e);
    pointer.x = p.x; pointer.y = p.y; pointer.fire = true; pointer.used = true;
    if (G.state === ST.GAMEOVER && G.stateTimer <= 0) backToTitle();
  });

  function updateAim() {
    const hands = window.Hands;
    if (hands && hands.present) {
      aim.x = hands.aimX * W;
      aim.y = hands.aimY * H;
      aim.haveHand = true;
    } else {
      aim.haveHand = false;
      if (pointer.used) { aim.x = pointer.x; aim.y = pointer.y; }
    }
    aim.x = Math.max(0, Math.min(W, aim.x));
    aim.y = Math.max(0, Math.min(H, aim.y));
  }

  function shotsThisFrame() {
    const hands = window.Hands;
    let n = hands ? hands.takeShots() : 0;
    if (pointer.fire) {
      pointer.fire = false;
      // touch/click only fires when NO hand is being tracked (fallback mode),
      // so accidental screen taps can't shoot during hand-tracked play
      if (!hands || !hands.present) n += 1;
    }
    return n;
  }

  /* ================= shooting ================= */
  function fireShot() {
    if (G.state !== ST.WAVE) return;
    if (G.ammo <= 0) { SFX.emptyClick(); return; }
    G.ammo--;
    G.muzzle = 4;
    G.shake = 3;
    SFX.shot();

    const hitR = G.mode === 1 ? 18 : 16;
    let hitAny = false;
    for (const d of G.ducks) {
      if (d.state !== 'fly') continue;
      const dx = d.x - aim.x, dy = d.y - aim.y;
      if (dx * dx + dy * dy <= hitR * hitR) {
        d.state = 'hit';
        d.hitTimer = 0.35;
        hitAny = true;
        const v = duckValue();
        G.score += v;
        G.popups.push({ x: d.x, y: d.y - 14, text: '+' + v, ttl: 1 });
        SFX.hitDuck();
        break; // one bullet, one duck
      }
    }
    if (!hitAny) SFX.quack();
  }

  /* ================= wave / round flow ================= */
  function waveOver() {
    return G.ducks.every((d) => d.state === 'landed' || d.state === 'gone');
  }

  function resolveWave() {
    const hits = G.ducks.filter((d) => d.state === 'landed').length;
    G.hitsThisRound += hits;
    for (let i = 0; i < G.ducks.length; i++) {
      const idx = G.slotIndex + i;
      G.slots[idx] = G.ducks[i].state === 'landed' ? 'hit' : 'miss';
    }
    G.slotIndex += G.ducks.length;
    G.dogKind = hits > 0 ? 'hold' : 'laugh';
    G.dogDucks = hits;
    G.state = ST.DOG;
    G.stateTimer = 2.3;
    if (G.dogKind === 'laugh') SFX.laugh();
    else { SFX.dogJump(); setTimeout(() => SFX.pickup(), 350); }
  }

  function startRoundIntro() {
    G.state = ST.INTRO;
    G.stateTimer = 2.6;
    G.slots = new Array(DUCKS_PER_ROUND).fill('pending');
    G.slotIndex = 0;
    G.hitsThisRound = 0;
    G.ducksLeft = DUCKS_PER_ROUND;
    SFX.roundStart();
  }

  function startGame(mode) {
    G.mode = mode;
    G.round = 1;
    G.score = 0;
    G.running = true;
    startRoundIntro();
  }

  function endRound() {
    G.state = ST.SUMMARY;
    G.stateTimer = 2.6;
    if (G.hitsThisRound === DUCKS_PER_ROUND) {
      G.score += 5000;
      SFX.perfect();
    }
  }

  function backToTitle() {
    G.running = false;
    startScreen.classList.remove('hidden');
    btnA.disabled = false;
    btnB.disabled = false;
  }

  /* ================= update ================= */
  function update(dt) {
    updateAim();
    if (G.muzzle > 0) G.muzzle--;
    if (G.shake > 0) G.shake--;
    G.popups.forEach((p) => { p.ttl -= dt; p.y -= 20 * dt; });
    G.popups = G.popups.filter((p) => p.ttl > 0);

    const shots = shotsThisFrame();

    switch (G.state) {
      case ST.INTRO: {
        G.stateTimer -= dt;
        if (shots > 0) SFX.emptyClick();
        if (G.stateTimer <= 0) spawnWave();
        break;
      }
      case ST.WAVE: {
        for (let i = 0; i < shots; i++) fireShot();
        G.ducks.forEach((d) => updateDuck(d, dt));
        /* ambient flap sound */
        G.flapClock -= dt;
        if (G.flapClock <= 0 && G.ducks.some((d) => d.state === 'fly')) {
          SFX.flap();
          G.flapClock = 0.24;
        }
        /* escape timer */
        const anyFlying = G.ducks.some((d) => d.state === 'fly');
        if (anyFlying) {
          G.waveTimer -= dt;
          if (G.waveTimer <= 0) {
            for (const d of G.ducks) {
              if (d.state === 'fly') { d.state = 'escape'; d.vy = -(d.speed * 1.7); }
            }
            SFX.flyAway();
          }
        }
        if (waveOver()) resolveWave();
        break;
      }
      case ST.DOG: {
        G.stateTimer -= dt;
        if (G.stateTimer <= 0) {
          G.ducksLeft -= G.mode;
          if (G.ducksLeft > 0) spawnWave();
          else endRound();
        }
        break;
      }
      case ST.SUMMARY: {
        G.stateTimer -= dt;
        if (G.stateTimer <= 0) {
          if (G.hitsThisRound >= MIN_HITS) {
            G.round++;
            startRoundIntro();
          } else {
            G.state = ST.GAMEOVER;
            G.stateTimer = 1.2;
            G.topScore = Math.max(G.topScore, G.score);
            SFX.gameOver();
          }
        }
        break;
      }
      case ST.GAMEOVER: {
        G.stateTimer -= dt;
        break;
      }
    }
  }

  /* ================= render ================= */
  function render() {
    ctx.save();
    if (G.shake > 0) ctx.translate(rand(-2, 2), rand(-1, 1));

    drawBackground();

    if (G.state === ST.INTRO) {
      /* dog sniffing across the grass */
      const t = 1 - G.stateTimer / 2.6;
      const frame = Math.floor(t * 14) % 2;
      drawDogSniff(-30 + t * (W + 70), GRASS_Y - 2, frame);
    }

    /* ducks */
    for (const d of G.ducks) if (d.state !== 'gone' && d.state !== 'landed') drawDuck(d);
    for (const d of G.ducks) if (d.state === 'landed') drawDuck(d);

    /* dog result animation */
    if (G.state === ST.DOG) {
      const t = 1 - G.stateTimer / 2.3;
      let rise; // 0 hidden -> 1 fully up -> back to 0
      if (t < 0.2) rise = t / 0.2;
      else if (t < 0.75) rise = 1;
      else rise = Math.max(0, 1 - (t - 0.75) / 0.25);
      const dy = (1 - rise) * 46;
      const frame = Math.floor(t * 10) % 2;
      if (G.dogKind === 'laugh') drawDogLaugh(W / 2, GRASS_Y - 8 + dy, frame);
      else drawDogHold(W / 2, GRASS_Y - 4 + dy, Math.max(1, G.dogDucks));
    }

    /* popups */
    for (const p of G.popups) text(p.text, p.x, p.y, '#fcfcfc', 8, 'center');

    drawHUD();
    drawPIP();

    /* messages */
    if (G.state === ST.INTRO) {
      text('ROUND ' + G.round, W / 2, 60, '#fcfcfc', 16, 'center');
      text('HIT ' + MIN_HITS + ' OF 10 TO PASS', W / 2, 84, '#ffe600', 8, 'center');
      const blink = Math.floor(performance.now() / 400) % 2 === 0;
      if (blink) text('AIM: MOVE HAND   FIRE: CURL THUMB', W / 2, 120, '#fcfcfc', 8, 'center');
    }

    if (G.state === ST.WAVE) {
      const anyFlying = G.ducks.some((d) => d.state === 'fly');
      if (anyFlying && G.waveTimer < 2) {
        const blink = Math.floor(performance.now() / 200) % 2 === 0;
        if (blink) text('FLY AWAY!', W / 2, 40, '#ff3030', 8, 'center');
      }
      if (!aim.haveHand && !pointer.used) {
        const blink = Math.floor(performance.now() / 350) % 2 === 0;
        if (blink) text('SHOW YOUR HAND!', W / 2, 56, '#ffe600', 8, 'center');
      }
    }

    if (G.state === ST.SUMMARY) {
      px(48, 70, W - 96, 66, '#000');
      ctx.strokeStyle = '#fcfcfc';
      ctx.strokeRect(48.5, 70.5, W - 97, 65);
      if (G.hitsThisRound === DUCKS_PER_ROUND) {
        text('PERFECT!', W / 2, 82, '#ffe600', 8, 'center');
        text('BONUS +5000', W / 2, 98, '#fcfcfc', 8, 'center');
      } else if (G.hitsThisRound >= MIN_HITS) {
        text('ROUND CLEAR', W / 2, 82, '#00e436', 8, 'center');
        text(G.hitsThisRound + '/10 DUCKS', W / 2, 98, '#fcfcfc', 8, 'center');
      } else {
        text('ONLY ' + G.hitsThisRound + '/10 DUCKS', W / 2, 90, '#ff3030', 8, 'center');
      }
      text('SCORE ' + String(G.score).padStart(6, '0'), W / 2, 116, '#fcfcfc', 8, 'center');
    }

    if (G.state === ST.GAMEOVER) {
      drawDogLaugh(W / 2, GRASS_Y - 8, Math.floor(performance.now() / 300) % 2);
      text('GAME OVER', W / 2, 66, '#ff3030', 16, 'center');
      text('SCORE ' + String(G.score).padStart(6, '0'), W / 2, 96, '#fcfcfc', 8, 'center');
      text('TOP ' + String(G.topScore).padStart(6, '0'), W / 2, 110, '#ffe600', 8, 'center');
      if (G.stateTimer <= 0) {
        const blink = Math.floor(performance.now() / 400) % 2 === 0;
        if (blink) text('TAP TO CONTINUE', W / 2, 134, '#fcfcfc', 8, 'center');
      }
    }

    drawCrosshair();
    ctx.restore();
  }

  /* ================= main loop ================= */
  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    if (window.Hands) window.Hands.detect(t);
    if (G.running) {
      update(dt);
      render();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ================= title screen wiring ================= */
  function setStatus(msg, isErr) {
    statusLine.textContent = msg;
    statusLine.classList.toggle('err', !!isErr);
  }

  window.addEventListener('hands-status', (e) => {
    if (!G.running) {
      if (e.detail === 'ready') setStatus('hand-tracking ready — choose a game mode');
      else if (e.detail === 'error') {
        setStatus('hand-tracking unavailable (' + (window.Hands ? window.Hands.error : '') + ') — touch controls enabled', true);
        btnA.disabled = false; btnB.disabled = false;
      }
    }
  });

  async function launch(mode) {
    SFX.init();
    SFX.select();
    btnA.disabled = true; btnB.disabled = true;
    setStatus('starting camera… allow permission when asked');
    try {
      if (window.Hands && window.Hands.status !== 'error') {
        await window.Hands.startCamera(video);
      } else {
        setStatus('camera unavailable — playing with touch controls', true);
      }
    } catch (err) {
      setStatus('camera error: ' + err.message + ' — playing with touch controls', true);
    }
    /* let one camera frame render before hiding the overlay */
    setTimeout(() => {
      startScreen.classList.add('hidden');
      startGame(mode);
    }, 300);
  }

  btnA.addEventListener('click', () => launch(1));
  btnB.addEventListener('click', () => launch(2));

  /* keep the screen awake-ish & prevent scroll/zoom gestures on mobile */
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
})();
