const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const livesEl = document.getElementById('lives');
const modeStatusEl = document.getElementById('modeStatus');
const weaponEl = document.getElementById('weaponStatus');
const bossStatusEl = document.getElementById('bossStatus');
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const characterButtons = [...document.querySelectorAll('.character-btn')];
const difficultyButtons = [...document.querySelectorAll('.difficulty-btn')];
const selectedCharacterEl = document.getElementById('selectedCharacter');
const leaderboardListEl = document.getElementById('leaderboardList');

const HIGH_SCORE_KEY = 'orbit-escape-high-score';
const LEADERBOARD_KEY = 'orbit-escape-leaderboard';
const BASE_LIVES = 3;
const MODE_CONFIG = {
  normal: { label: 'Normal', spawnRate: 1, enemySpeed: 1, bossHealth: 1 },
  hard: { label: 'Hard', spawnRate: 1.3, enemySpeed: 1.25, bossHealth: 1.5 },
  insane: { label: 'Insane', spawnRate: 1.6, enemySpeed: 1.5, bossHealth: 2 },
};

let lastTime = 0;
let spawnTimer = 0;
let stars = [];
let meteors = [];
let particles = [];
let powerUps = [];
let projectiles = [];
let animationId = 0;
let running = false;
let paused = false;
let justStarted = true;
let activePointerX = null;
let selectedCharacter = 'nova';
let boss = null;
let bossWaveIndex = 0;
let audioContext = null;

const characters = {
  nova: { name: 'Nova', primary: '#7ee7ff', accent: '#ffb86b', trail: '#6bf2ae', speed: 360, radius: 18 },
  vex: { name: 'Vex', primary: '#ff8ae2', accent: '#ffd166', trail: '#8dffb1', speed: 420, radius: 16 },
};

const gameState = {
  score: 0,
  lives: BASE_LIVES,
  best: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
  difficulty: 1,
  time: 0,
  mode: 'normal',
};

const ship = {
  x: canvas.width / 2,
  y: canvas.height - 56,
  radius: 18,
  speed: 360,
  drift: 0,
  invulnerable: 0,
  primary: characters.nova.primary,
  accent: characters.nova.accent,
  trail: characters.nova.trail,
  fireCooldown: 0,
  rapidTimer: 0,
  spreadTimer: 0,
  shieldTimer: 0,
};

const input = { left: false, right: false, up: false, down: false };

function getModeSettings() {
  return MODE_CONFIG[gameState.mode] || MODE_CONFIG.normal;
}

function ensureAudio() {
  if (audioContext) {
    return;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return;
  }

  audioContext = new AudioCtor();
}

function playTone(frequency, duration, type = 'square', gainValue = 0.03, slide = 0) {
  if (!audioContext) {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  if (slide) {
    oscillator.frequency.linearRampToValueAtTime(frequency + slide, audioContext.currentTime + duration);
  }

  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(gainValue, audioContext.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playShootSound() { ensureAudio(); playTone(220, 0.08, 'square', 0.018, 60); }
function playHitSound() { ensureAudio(); playTone(120, 0.12, 'sawtooth', 0.025, -30); }
function playPowerupSound() { ensureAudio(); playTone(360, 0.12, 'triangle', 0.026, 80); }
function playBossSound() { ensureAudio(); playTone(80, 0.2, 'sawtooth', 0.04, -40); }
function playGameOverSound() { ensureAudio(); playTone(180, 0.22, 'sawtooth', 0.04, -60); }

function loadLeaderboard() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    return [];
  }
}

function saveLeaderboard(entries) {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
}

function renderLeaderboard() {
  const entries = loadLeaderboard();
  leaderboardListEl.innerHTML = '';

  if (!entries.length) {
    const li = document.createElement('li');
    li.textContent = 'No runs yet';
    leaderboardListEl.appendChild(li);
    return;
  }

  entries.slice(0, 5).forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.name} — ${entry.score} (${entry.mode})`;
    leaderboardListEl.appendChild(li);
  });
}

function addScoreToLeaderboard() {
  const entries = loadLeaderboard();
  entries.push({
    name: characters[selectedCharacter].name,
    score: Math.floor(gameState.score),
    mode: MODE_CONFIG[gameState.mode].label,
  });
  entries.sort((a, b) => b.score - a.score);
  saveLeaderboard(entries.slice(0, 5));
  renderLeaderboard();
}

function applyCharacterSelection(key) {
  selectedCharacter = key;
  const profile = characters[key];
  ship.primary = profile.primary;
  ship.accent = profile.accent;
  ship.trail = profile.trail;
  ship.speed = profile.speed;
  ship.radius = profile.radius;
  selectedCharacterEl.textContent = profile.name;
  characterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.character === key);
  });
}

function applyDifficultySelection(mode) {
  gameState.mode = mode;
  difficultyButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  modeStatusEl.textContent = MODE_CONFIG[mode].label;
}

function resetGame() {
  gameState.score = 0;
  gameState.lives = BASE_LIVES;
  gameState.difficulty = 1;
  gameState.time = 0;
  ship.x = canvas.width / 2;
  ship.y = canvas.height - 56;
  ship.drift = 0;
  ship.invulnerable = 0;
  ship.fireCooldown = 0;
  ship.rapidTimer = 0;
  ship.spreadTimer = 0;
  ship.shieldTimer = 0;
  meteors = [];
  particles = [];
  powerUps = [];
  projectiles = [];
  boss = null;
  bossWaveIndex = 0;
  spawnTimer = 0.45;
  updateHud();
}

function updateHud() {
  scoreEl.textContent = Math.floor(gameState.score);
  livesEl.textContent = gameState.lives;
  highScoreEl.textContent = Math.floor(gameState.best);
  modeStatusEl.textContent = MODE_CONFIG[gameState.mode].label;

  if (ship.shieldTimer > 0) {
    weaponEl.textContent = 'Shield';
  } else if (ship.rapidTimer > 0) {
    weaponEl.textContent = 'Rapid';
  } else if (ship.spreadTimer > 0) {
    weaponEl.textContent = 'Spread';
  } else {
    weaponEl.textContent = 'Pulse';
  }

  bossStatusEl.textContent = boss ? `${Math.ceil(boss.health)}/${Math.ceil(boss.maxHealth)}` : 'None';
}

function setOverlayVisible(visible) {
  overlay.classList.toggle('visible', visible);
}

function startGame() {
  ensureAudio();
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  justStarted = false;
  running = true;
  paused = false;
  pauseButton.textContent = 'Pause';
  applyCharacterSelection(selectedCharacter);
  resetGame();
  setOverlayVisible(false);
  lastTime = 0;
  animationId = requestAnimationFrame(loop);
}

function togglePause() {
  if (!running) {
    return;
  }

  paused = !paused;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';

  if (paused) {
    cancelAnimationFrame(animationId);
    overlay.querySelector('h1').textContent = 'Paused';
    overlay.querySelector('p').textContent = 'Take a breather. Press Resume to continue.';
    overlay.querySelector('button').textContent = 'Resume';
    setOverlayVisible(true);
    return;
  }

  setOverlayVisible(false);
  lastTime = 0;
  animationId = requestAnimationFrame(loop);
}

function resumeFromPause() {
  if (!paused) {
    return;
  }
  togglePause();
}

function gameOver() {
  running = false;
  paused = false;
  pauseButton.textContent = 'Pause';
  playGameOverSound();
  const high = Math.max(gameState.best, gameState.score);
  gameState.best = high;
  localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(gameState.best)));
  addScoreToLeaderboard();
  updateHud();
  setOverlayVisible(true);
  overlay.querySelector('h1').textContent = 'Game Over';
  overlay.querySelector('p').textContent = `You survived ${Math.floor(gameState.score)} points. Press Start to try again.`;
  overlay.querySelector('button').textContent = 'Play Again';
  cancelAnimationFrame(animationId);
}

function toggleReadyScreen() {
  overlay.querySelector('h1').textContent = 'SPC RAKER';
  overlay.querySelector('p').textContent = 'Steer your ship, dodge the meteor shower, and survive as long as you can.';
  overlay.querySelector('button').textContent = 'Start Game';
  setOverlayVisible(true);
}

function createStars() {
  stars = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: Math.random() * 2 + 1,
    speed: Math.random() * 0.7 + 0.2,
    alpha: Math.random() * 0.8 + 0.2,
  }));
}

function createBurst(x, y, color, count = 16) {
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 180,
      vy: (Math.random() - 0.5) * 180,
      life: 0.7 + Math.random() * 0.5,
      maxLife: 0.7 + Math.random() * 0.5,
      color,
      radius: Math.random() * 3 + 2,
    });
  }
}

function spawnEnemyBolt(x, y, targetX, targetY, speed = 180) {
  const angle = Math.atan2(targetY - y, targetX - x);
  projectiles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 5,
    color: '#ff6b78',
    from: 'enemy',
    damage: 1,
  });
}

function spawnMeteor() {
  const settings = getModeSettings();
  const kindRoll = Math.random();
  const radius = Math.random() * 16 + 12;
  const obstacle = {
    x: Math.random() * (canvas.width - radius * 2) + radius,
    y: -radius,
    radius,
    speed: (Math.random() * 90 + 120 + gameState.difficulty * 18) * settings.enemySpeed,
    drift: (Math.random() - 0.5) * 90,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 2,
    kind: 'meteor',
    value: 8,
    health: 1,
    fireTimer: 0,
  };

  if (kindRoll > 0.7) {
    obstacle.kind = 'satellite';
    obstacle.radius = Math.random() * 10 + 14;
    obstacle.speed += 35;
    obstacle.value = 12;
    obstacle.health = 2;
    obstacle.fireTimer = 2.4;
  }

  meteors.push(obstacle);
}

function spawnWave() {
  const settings = getModeSettings();
  const count = 1 + (Math.random() > 0.65 ? 1 : 0) + (gameState.difficulty > 2 && Math.random() > 0.8 ? 1 : 0);
  for (let i = 0; i < count; i += 1) {
    spawnMeteor();
  }
  spawnTimer = Math.max(0.2, 0.82 / settings.spawnRate - gameState.difficulty * 0.04);
}

function maybeSpawnBoss() {
  if (!running || paused || boss) {
    return;
  }

  const nextWave = Math.floor(gameState.score / 260);
  if (nextWave <= bossWaveIndex) {
    return;
  }

  bossWaveIndex = nextWave;
  const settings = getModeSettings();
  boss = {
    x: canvas.width / 2,
    y: 110,
    width: 180,
    height: 72,
    radius: 52,
    speed: 90,
    direction: 1,
    health: (18 + bossWaveIndex * 8) * settings.bossHealth,
    maxHealth: (18 + bossWaveIndex * 8) * settings.bossHealth,
    fireTimer: 1.6,
  };
  playBossSound();
}

function fireWeapon() {
  if (!running || paused || ship.fireCooldown > 0) {
    return;
  }

  const spreadAngles = ship.spreadTimer > 0 ? [-0.35, 0, 0.35] : [0];
  const shotSpeed = ship.rapidTimer > 0 ? 620 : 540;
  const damage = ship.spreadTimer > 0 ? 2 : 1;

  spreadAngles.forEach((angleOffset) => {
    const angle = -Math.PI / 2 + angleOffset;
    projectiles.push({
      x: ship.x,
      y: ship.y - 20,
      vx: Math.cos(angle) * shotSpeed,
      vy: Math.sin(angle) * shotSpeed,
      radius: 5,
      color: ship.primary,
      from: 'player',
      damage,
    });
  });

  ship.fireCooldown = ship.rapidTimer > 0 ? 0.12 : 0.22;
  playShootSound();
}

function spawnPowerUp(x, y, type = 'rapid') {
  powerUps.push({ x, y, radius: 12, type, vy: 120 });
}

function dropPowerUp(x, y) {
  const roll = Math.random();
  if (roll < 0.2) {
    spawnPowerUp(x, y, 'rapid');
  } else if (roll < 0.4) {
    spawnPowerUp(x, y, 'shield');
  } else if (roll < 0.6) {
    spawnPowerUp(x, y, 'spread');
  } else if (roll < 0.75) {
    spawnPowerUp(x, y, 'repair');
  }
}

function powerUpShip(type) {
  if (type === 'rapid') {
    ship.rapidTimer = 8;
  } else if (type === 'shield') {
    ship.shieldTimer = 8;
  } else if (type === 'spread') {
    ship.spreadTimer = 8;
  } else if (type === 'repair') {
    gameState.lives = Math.min(BASE_LIVES, gameState.lives + 1);
  }
  playPowerupSound();
}

function handleInput(dt) {
  let moveX = 0;
  let moveY = 0;

  if (input.left) moveX -= 1;
  if (input.right) moveX += 1;
  if (input.up) moveY -= 1;
  if (input.down) moveY += 1;

  if (activePointerX !== null) {
    const dx = activePointerX - ship.x;
    moveX += Math.sign(dx) * 0.7;
  }

  ship.x += moveX * ship.speed * dt;
  ship.y += moveY * ship.speed * dt;

  ship.x = Math.max(ship.radius + 10, Math.min(canvas.width - ship.radius - 10, ship.x));
  ship.y = Math.max(ship.radius + 30, Math.min(canvas.height - ship.radius - 12, ship.y));
}

function updateStars(dt) {
  for (const star of stars) {
    star.y += star.speed * dt * 60;
    if (star.y > canvas.height) {
      star.y = -4;
      star.x = Math.random() * canvas.width;
    }
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    if (projectile.from === 'player') {
      let hit = false;

      if (boss) {
        const dx = projectile.x - boss.x;
        const dy = projectile.y - boss.y;
        if (Math.abs(dx) < boss.width / 2 + projectile.radius && Math.abs(dy) < boss.height / 2 + projectile.radius) {
          boss.health -= projectile.damage;
          hit = true;
          playHitSound();
          createBurst(projectile.x, projectile.y, '#ffd166', 8);
          if (boss.health <= 0) {
            const bossX = boss.x;
            const bossY = boss.y;
            gameState.score += 250;
            createBurst(bossX, bossY, '#7ee7ff', 40);
            boss = null;
            if (Math.random() < 0.8) {
              dropPowerUp(bossX, bossY);
            }
          }
        }
      }

      if (!hit) {
        for (let j = meteors.length - 1; j >= 0; j -= 1) {
          const meteor = meteors[j];
          const dist = Math.hypot(projectile.x - meteor.x, projectile.y - meteor.y);
          if (dist < meteor.radius + projectile.radius) {
            meteor.health -= projectile.damage;
            projectile.x = -9999;
            hit = true;
            createBurst(projectile.x, projectile.y, '#7ee7ff', 6);
            if (meteor.health <= 0) {
              meteors.splice(j, 1);
              gameState.score += meteor.value;
              createBurst(meteor.x, meteor.y, '#ffb86b', 18);
              if (Math.random() < 0.2) {
                dropPowerUp(meteor.x, meteor.y);
              }
            }
            break;
          }
        }
      }

      if (hit || projectile.y < -20 || projectile.y > canvas.height + 20 || projectile.x < -20 || projectile.x > canvas.width + 20) {
        projectiles.splice(i, 1);
      }
    } else {
      const distToShip = Math.hypot(projectile.x - ship.x, projectile.y - ship.y);
      if (distToShip < ship.radius + projectile.radius) {
        if (ship.shieldTimer > 0) {
          ship.shieldTimer = Math.max(0, ship.shieldTimer - 2);
          createBurst(projectile.x, projectile.y, '#8dffb1', 8);
        } else {
          ship.invulnerable = 1.2;
          gameState.lives -= 1;
          createBurst(ship.x, ship.y, '#ff6b78', 22);
          if (gameState.lives <= 0) {
            gameOver();
            return;
          }
        }
        projectiles.splice(i, 1);
        continue;
      }

      if (projectile.y > canvas.height + 20 || projectile.x < -30 || projectile.x > canvas.width + 30) {
        projectiles.splice(i, 1);
      }
    }
  }
}

function updateMeteors(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnWave();
  }

  for (let i = meteors.length - 1; i >= 0; i -= 1) {
    const meteor = meteors[i];
    meteor.y += meteor.speed * dt;
    meteor.x += meteor.drift * dt;
    meteor.rotation += meteor.spin * dt;

    if (meteor.kind === 'satellite') {
      meteor.fireTimer -= dt;
      if (meteor.fireTimer <= 0) {
        spawnEnemyBolt(meteor.x, meteor.y, ship.x, ship.y, 170 + gameState.difficulty * 10);
        meteor.fireTimer = 2.8;
      }
    }

    const dx = ship.x - meteor.x;
    const dy = ship.y - meteor.y;
    const distance = Math.hypot(dx, dy);

    if (distance < ship.radius + meteor.radius) {
      meteors.splice(i, 1);
      if (ship.invulnerable <= 0) {
        ship.invulnerable = 1.2;
        if (ship.shieldTimer > 0) {
          ship.shieldTimer = 0;
          createBurst(ship.x, ship.y, '#8dffb1', 16);
        } else {
          gameState.lives -= 1;
          createBurst(ship.x, ship.y, '#ff6b78', 22);
          if (gameState.lives <= 0) {
            gameOver();
            return;
          }
        }
      }
      continue;
    }

    if (meteor.y > canvas.height + meteor.radius) {
      meteors.splice(i, 1);
      gameState.score += meteor.value;
    }
  }
}

function updateBoss(dt) {
  if (!boss) {
    return;
  }

  boss.x += boss.speed * boss.direction * dt;
  if (boss.x > canvas.width - 120 || boss.x < 120) {
    boss.direction *= -1;
  }

  boss.fireTimer -= dt;
  if (boss.fireTimer <= 0) {
    const angle = Math.atan2(ship.y - boss.y, ship.x - boss.x);
    const speed = 230;
    projectiles.push({
      x: boss.x,
      y: boss.y + boss.height / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 6,
      color: '#ff6b78',
      from: 'enemy',
      damage: 1,
    });
    boss.fireTimer = Math.max(0.7, 1.8 - gameState.difficulty * 0.1);
  }

  if (Math.hypot(ship.x - boss.x, ship.y - boss.y) < ship.radius + boss.radius) {
    if (ship.shieldTimer > 0) {
      ship.shieldTimer = 0;
      createBurst(ship.x, ship.y, '#8dffb1', 18);
    } else {
      ship.invulnerable = 1.2;
      gameState.lives -= 1;
      createBurst(ship.x, ship.y, '#ff6b78', 22);
      if (gameState.lives <= 0) {
        gameOver();
        return;
      }
    }
  }
}

function updatePowerUps(dt) {
  for (let i = powerUps.length - 1; i >= 0; i -= 1) {
    const powerUp = powerUps[i];
    powerUp.y += powerUp.vy * dt;

    const dist = Math.hypot(powerUp.x - ship.x, powerUp.y - ship.y);
    if (dist < ship.radius + powerUp.radius + 4) {
      powerUpShip(powerUp.type);
      powerUps.splice(i, 1);
      continue;
    }

    if (powerUp.y > canvas.height + 20) {
      powerUps.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function update(dt) {
  if (!running || paused) {
    return;
  }

  ship.fireCooldown = Math.max(0, ship.fireCooldown - dt);
  ship.rapidTimer = Math.max(0, ship.rapidTimer - dt);
  ship.spreadTimer = Math.max(0, ship.spreadTimer - dt);
  ship.shieldTimer = Math.max(0, ship.shieldTimer - dt);
  ship.invulnerable = Math.max(0, ship.invulnerable - dt);

  gameState.time += dt;
  gameState.score += dt * 14;
  gameState.difficulty = 1 + Math.floor(gameState.score / 150);

  handleInput(dt);
  updateStars(dt);
  updateMeteors(dt);
  updateBoss(dt);
  updateProjectiles(dt);
  updatePowerUps(dt);
  updateParticles(dt);
  maybeSpawnBoss();

  if (gameState.score > gameState.best) {
    gameState.best = gameState.score;
    localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(gameState.best)));
  }

  updateHud();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#081224');
  gradient.addColorStop(1, '#090d1d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(126, 231, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(canvas.width * 0.8, 110, 70, 0, Math.PI * 2);
  ctx.fill();

  for (const star of stars) {
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShip() {
  ctx.save();
  ctx.translate(ship.x, ship.y);

  if (ship.invulnerable > 0 && Math.floor(ship.invulnerable * 12) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }

  if (ship.shieldTimer > 0) {
    ctx.strokeStyle = '#8dffb1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius + 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = ship.primary;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(12, 20);
  ctx.lineTo(0, 14);
  ctx.lineTo(-12, 20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ship.accent;
  ctx.fillRect(-3, 18, 6, 12);

  ctx.fillStyle = ship.trail;
  ctx.beginPath();
  ctx.moveTo(-5, 20);
  ctx.lineTo(0, 30);
  ctx.lineTo(5, 20);
  ctx.fill();

  ctx.restore();
}

function drawMeteor(meteor) {
  ctx.save();
  ctx.translate(meteor.x, meteor.y);
  ctx.rotate(meteor.rotation);

  if (meteor.kind === 'satellite') {
    ctx.fillStyle = '#c8d9ff';
    ctx.beginPath();
    ctx.arc(0, 0, meteor.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#8dd6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, meteor.radius + 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-meteor.radius - 12, 0);
    ctx.lineTo(meteor.radius + 12, 0);
    ctx.moveTo(0, -meteor.radius - 12);
    ctx.lineTo(0, meteor.radius + 12);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#8d98a3';
    ctx.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const angle = (Math.PI * 2 / 7) * i;
      const radius = meteor.radius * (0.85 + ((i % 2) * 0.3));
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#b9c3ca';
    ctx.beginPath();
    ctx.arc(-4, -4, meteor.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBoss() {
  if (!boss) {
    return;
  }

  ctx.save();
  ctx.translate(boss.x, boss.y);

  ctx.fillStyle = '#ff6b78';
  ctx.fillRect(-boss.width / 2, -boss.height / 2, boss.width, boss.height);

  ctx.fillStyle = '#ffd166';
  ctx.fillRect(-boss.width / 2 + 12, -boss.height / 2 + 16, boss.width - 24, 12);

  const healthRatio = boss.health / boss.maxHealth;
  ctx.fillStyle = '#7ee7ff';
  ctx.fillRect(-boss.width / 2 + 12, -boss.height / 2 + 16, (boss.width - 24) * healthRatio, 12);

  ctx.restore();
}

function drawProjectiles() {
  for (const projectile of projectiles) {
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPowerUps() {
  for (const powerUp of powerUps) {
    const color = powerUp.type === 'rapid' ? '#7ee7ff' : powerUp.type === 'shield' ? '#8dffb1' : powerUp.type === 'spread' ? '#ffd166' : '#ff9ae4';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(powerUp.x, powerUp.y, powerUp.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#03131d';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(powerUp.type[0].toUpperCase(), powerUp.x, powerUp.y + 1);
  }
}

function drawParticles() {
  for (const particle of particles) {
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function render() {
  drawBackground();

  for (const meteor of meteors) {
    drawMeteor(meteor);
  }

  drawBoss();
  drawProjectiles();
  drawPowerUps();
  drawParticles();
  drawShip();
}

function loop(timestamp) {
  if (!lastTime) {
    lastTime = timestamp;
  }
  const dt = Math.min((timestamp - lastTime) / 1000, 0.03);
  lastTime = timestamp;

  update(dt);
  render();

  if (running && !paused) {
    animationId = requestAnimationFrame(loop);
  }
}

function handleKeyChange(event, isPressed) {
  const { key } = event;
  switch (key.toLowerCase()) {
    case 'arrowleft':
    case 'a':
      input.left = isPressed;
      break;
    case 'arrowright':
    case 'd':
      input.right = isPressed;
      break;
    case 'arrowup':
    case 'w':
      input.up = isPressed;
      break;
    case 'arrowdown':
    case 's':
      input.down = isPressed;
      break;
    case 'f':
    case 'j':
    case 'k':
      if (isPressed) {
        fireWeapon();
      }
      break;
    case 'p':
      if (isPressed) {
        if (running && !paused) {
          togglePause();
        } else if (paused) {
          resumeFromPause();
        }
      }
      break;
    case ' ':
      if (isPressed && !running) {
        startGame();
      }
      break;
    default:
      break;
  }
}

window.addEventListener('keydown', (event) => {
  handleKeyChange(event, true);
});

window.addEventListener('keyup', (event) => {
  handleKeyChange(event, false);
});

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  activePointerX = x;
});

canvas.addEventListener('mouseleave', () => {
  activePointerX = null;
});

canvas.addEventListener('mousedown', () => {
  if (running && !paused) {
    fireWeapon();
  }
});

startButton.addEventListener('click', () => {
  if (paused) {
    resumeFromPause();
    return;
  }
  startGame();
});

pauseButton.addEventListener('click', () => {
  if (!running) {
    return;
  }

  if (paused) {
    resumeFromPause();
    return;
  }

  togglePause();
});

characterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    applyCharacterSelection(button.dataset.character);
  });
});

difficultyButtons.forEach((button) => {
  button.addEventListener('click', () => {
    applyDifficultySelection(button.dataset.mode);
  });
});

applyCharacterSelection(selectedCharacter);
applyDifficultySelection('normal');
renderLeaderboard();
createStars();
updateHud();
render();
if (justStarted) {
  toggleReadyScreen();
}
