const socket = io();

const roomCodeDisplay = document.getElementById('room-code-display');
const playerList = document.getElementById('player-list');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

let roomCode = '';
let players = {};

let gameState = 'lobby';
let currentSettings = { track: 'cariboo', racers: 2 };
let lobbyText = "VIP IS SELECTING TRACK RULES";

socket.emit('hostCreate');

socket.on('roomCreated', (code) => {
  roomCode = code;
  roomCodeDisplay.innerText = code;
  
  // Generate QR Code containing the link to the controller
  const joinUrl = `${window.location.origin}/controller/index.html?code=${code}`;
  new QRCode(document.getElementById("qr-code"), {
    text: joinUrl,
    width: 128,
    height: 128,
    colorDark : "#000000",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.L
  });
});

socket.on('playerJoined', (data) => {
  // Spawn player near center
  players[data.id] = {
    color: data.color,
    name: data.name || 'RACER',
    x: canvas.width / 2 + (Math.random() * 100 - 50),
    y: canvas.height / 2 + (Math.random() * 100 - 50),
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    steer: 0,
    gas: 0
  };
  updatePlayerList();
});

socket.on('playerLeft', (id) => {
  delete players[id];
  updatePlayerList();
});

socket.on('playerInput', (data) => {
  if (players[data.id] && gameState === 'racing') {
    players[data.id].steer = data.steer;
    players[data.id].gas = data.gas;
  }
});

socket.on('settingsUpdated', (settings) => {
  currentSettings = settings;
});

socket.on('lobbyStatus', (data) => {
  gameState = 'waiting_players';
  const remaining = data.target - data.current;
  lobbyText = remaining > 0 ? `WAITING FOR ${remaining} RACER(S) TO SCAN IN` : 'READY TO START';
});

socket.on('raceStart', (settings) => {
  currentSettings = settings;
  gameState = 'racing';
  document.getElementById('room-info').style.display = 'none'; // Lock in! Hide QR code.
  
  const currentCount = Object.keys(players).length;
  const targetCount = parseInt(settings.racers);
  if (currentCount < targetCount) {
    const aiColors = ['#FF00FF', '#00FF00', '#FFA500', '#FFFFFF', '#FF0055'];
    for(let i = 0; i < (targetCount - currentCount); i++) {
       const botId = 'BOT_' + i;
       players[botId] = {
         color: aiColors[i % aiColors.length],
         name: 'CPU-' + (i+1),
         isBot: true,
         targetWaypoint: 0,
         x: canvas.width / 2 + (Math.random() * 100 - 50),
         y: canvas.height / 2 + (Math.random() * 100 - 50),
         vx: 0,
         vy: 0,
         angle: -Math.PI / 2,
         steer: 0,
         gas: 0
       };
     }
    updatePlayerList();
  }
  
  // Align all karts at start/finish line before race begins
  alignStartingGrid();
});

function alignStartingGrid() {
  const pts = getWaypoints();
  if (pts.length < 2) return;
  const p0 = pts[0];
  const p1 = pts[5]; // Use a point slightly ahead for a better direction vector
  
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy);
  
  const fx = dx / dist;
  const fy = dy / dist;
  
  const nx = -fy;
  const ny = fx;
  
  const startAngle = Math.atan2(dy, dx);
  
  const playerKeys = Object.keys(players);
  for(let i = 0; i < playerKeys.length; i++) {
    const p = players[playerKeys[i]];
    
    const row = Math.floor(i / 2);
    const side = (i % 2 === 0) ? -1 : 1;
    
    // Position offset backwards from start line
    p.x = p0.x - (fx * (row * 40)) + (nx * (side * 20));
    p.y = p0.y - (fy * (row * 40)) + (ny * (side * 20));
    p.angle = startAngle;
    p.vx = 0;
    p.vy = 0;
  }
}

function updatePlayerList() {
  playerList.innerHTML = '';
  Object.values(players).forEach((p, idx) => {
    const el = document.createElement('div');
    el.className = 'player-token';
    el.style.borderColor = p.color;
    el.style.color = p.color;
    el.innerHTML = `<div class="color-box" style="background-color: ${p.color};"></div> ${p.name}`;
    playerList.appendChild(el);
  });
}

// PHYSICS & RENDER LOOP
const ENGINE_POWER = 0.08;
const FRICTION = 0.95;
const TURN_SPEED = 0.04;

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 0, 85, 0.15)';
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  const gridSize = 60;
  
  ctx.beginPath();
  for(let x = 0; x <= canvas.width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for(let y = 0; y <= canvas.height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function generateSpline(points, resolution = 10) {
  if (points.length < 3) return points;
  const spline = [];
  
  // Close the loop mathematically for perfect continuous curves
  const pts = [...points];
  pts.unshift(points[points.length - 1]);
  pts.push(points[0]);
  pts.push(points[1]);

  for (let i = 1; i < pts.length - 2; i++) {
    for (let j = 0; j < resolution; j++) {
      const t = j / resolution;
      spline.push({
        x: catmullRom(pts[i - 1].x, pts[i].x, pts[i + 1].x, pts[i + 2].x, t),
        y: catmullRom(pts[i - 1].y, pts[i].y, pts[i + 1].y, pts[i + 2].y, t)
      });
    }
  }
  return spline;
}

let cachedSplines = {};
let lastCanvasSize = { w: 0, h: 0 };

function getWaypoints() {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;

  // Cache resolution to prevent calculating Math 60 frames a second
  if (lastCanvasSize.w === w && lastCanvasSize.h === h && cachedSplines[currentSettings.track]) {
     return cachedSplines[currentSettings.track];
  }
  
  lastCanvasSize = { w, h };
  let rawPoints = [];
  
  if (currentSettings.track === 'cariboo') {
    rawPoints = [
      {x: w * 0.645, y: h * 0.821},
      {x: w * 0.683, y: h * 0.825},
      {x: w * 0.727, y: h * 0.828},
      {x: w * 0.769, y: h * 0.828},
      {x: w * 0.802, y: h * 0.826},
      {x: w * 0.842, y: h * 0.806},
      {x: w * 0.873, y: h * 0.771},
      {x: w * 0.894, y: h * 0.735},
      {x: w * 0.906, y: h * 0.685},
      {x: w * 0.913, y: h * 0.621},
      {x: w * 0.902, y: h * 0.568},
      {x: w * 0.878, y: h * 0.485},
      {x: w * 0.859, y: h * 0.415},
      {x: w * 0.796, y: h * 0.238},
      {x: w * 0.771, y: h * 0.185},
      {x: w * 0.748, y: h * 0.154},
      {x: w * 0.723, y: h * 0.136},
      {x: w * 0.687, y: h * 0.131},
      {x: w * 0.643, y: h * 0.142},
      {x: w * 0.594, y: h * 0.173},
      {x: w * 0.542, y: h * 0.197},
      {x: w * 0.487, y: h * 0.222},
      {x: w * 0.443, y: h * 0.250},
      {x: w * 0.407, y: h * 0.257},
      {x: w * 0.372, y: h * 0.253},
      {x: w * 0.347, y: h * 0.218},
      {x: w * 0.318, y: h * 0.156},
      {x: w * 0.290, y: h * 0.119},
      {x: w * 0.259, y: h * 0.089},
      {x: w * 0.227, y: h * 0.070},
      {x: w * 0.182, y: h * 0.070},
      {x: w * 0.146, y: h * 0.088},
      {x: w * 0.116, y: h * 0.115},
      {x: w * 0.103, y: h * 0.148},
      {x: w * 0.091, y: h * 0.178},
      {x: w * 0.090, y: h * 0.223},
      {x: w * 0.116, y: h * 0.260},
      {x: w * 0.153, y: h * 0.292},
      {x: w * 0.178, y: h * 0.307},
      {x: w * 0.214, y: h * 0.335},
      {x: w * 0.251, y: h * 0.365},
      {x: w * 0.281, y: h * 0.404},
      {x: w * 0.306, y: h * 0.443},
      {x: w * 0.327, y: h * 0.461},
      {x: w * 0.357, y: h * 0.472},
      {x: w * 0.387, y: h * 0.461},
      {x: w * 0.432, y: h * 0.439},
      {x: w * 0.495, y: h * 0.412},
      {x: w * 0.543, y: h * 0.386},
      {x: w * 0.590, y: h * 0.374},
      {x: w * 0.611, y: h * 0.373},
      {x: w * 0.648, y: h * 0.383},
      {x: w * 0.674, y: h * 0.399},
      {x: w * 0.700, y: h * 0.419},
      {x: w * 0.733, y: h * 0.454},
      {x: w * 0.763, y: h * 0.503},
      {x: w * 0.774, y: h * 0.550},
      {x: w * 0.788, y: h * 0.584},
      {x: w * 0.791, y: h * 0.624},
      {x: w * 0.775, y: h * 0.658},
      {x: w * 0.757, y: h * 0.678},
      {x: w * 0.727, y: h * 0.690},
      {x: w * 0.696, y: h * 0.688},
      {x: w * 0.670, y: h * 0.663},
      {x: w * 0.652, y: h * 0.629},
      {x: w * 0.630, y: h * 0.591},
      {x: w * 0.602, y: h * 0.553},
      {x: w * 0.568, y: h * 0.542},
      {x: w * 0.530, y: h * 0.552},
      {x: w * 0.493, y: h * 0.591},
      {x: w * 0.454, y: h * 0.624},
      {x: w * 0.412, y: h * 0.649},
      {x: w * 0.365, y: h * 0.664},
      {x: w * 0.312, y: h * 0.666},
      {x: w * 0.290, y: h * 0.655},
      {x: w * 0.259, y: h * 0.622},
      {x: w * 0.237, y: h * 0.574},
      {x: w * 0.206, y: h * 0.518},
      {x: w * 0.179, y: h * 0.478},
      {x: w * 0.132, y: h * 0.464},
      {x: w * 0.155, y: h * 0.467},
      {x: w * 0.115, y: h * 0.480},
      {x: w * 0.105, y: h * 0.497},
      {x: w * 0.104, y: h * 0.523},
      {x: w * 0.115, y: h * 0.562},
      {x: w * 0.135, y: h * 0.626},
      {x: w * 0.171, y: h * 0.687},
      {x: w * 0.199, y: h * 0.724},
      {x: w * 0.219, y: h * 0.763},
      {x: w * 0.233, y: h * 0.783},
      {x: w * 0.259, y: h * 0.796},
      {x: w * 0.303, y: h * 0.806},
      {x: w * 0.341, y: h * 0.816},
      {x: w * 0.398, y: h * 0.820},
      {x: w * 0.514, y: h * 0.822}
    ];
  } else if (currentSettings.track === 'west_coast') {
    rawPoints = [
      {x: w * 0.8, y: h * 0.85},
      {x: w * 0.2, y: h * 0.85},
      {x: w * 0.1, y: h * 0.75},
      {x: w * 0.1, y: h * 0.55},
      {x: w * 0.25, y: h * 0.45},
      {x: w * 0.2, y: h * 0.3},
      {x: w * 0.25, y: h * 0.15},
      {x: w * 0.45, y: h * 0.1},
      {x: w * 0.6, y: h * 0.15},
      {x: w * 0.5, y: h * 0.25},
      {x: w * 0.35, y: h * 0.35},
      {x: w * 0.35, y: h * 0.5},
      {x: w * 0.5, y: h * 0.65},
      {x: w * 0.7, y: h * 0.55},
      {x: w * 0.7, y: h * 0.35},
      {x: w * 0.85, y: h * 0.15},
      {x: w * 0.95, y: h * 0.25},
      {x: w * 0.95, y: h * 0.65},
      {x: w * 0.85, y: h * 0.8}
    ];
  } else if (currentSettings.track === 'neon_ring') {
    const rx = w * 0.3;
    const ry = h * 0.3;
    rawPoints = [
      {x: cx, y: cy - ry},
      {x: cx + rx * 0.7, y: cy - ry * 0.7}, 
      {x: cx + rx, y: cy},
      {x: cx + rx * 0.7, y: cy + ry * 0.7},
      {x: cx, y: cy + ry},
      {x: cx - rx * 0.7, y: cy + ry * 0.7},
      {x: cx - rx, y: cy},
      {x: cx - rx * 0.7, y: cy - ry * 0.7}
    ];
  } else {
    // cyber square uses 20% / 80% boundaries
    rawPoints = [
      {x: w * 0.2, y: h * 0.2},
      {x: w * 0.8, y: h * 0.2},
      {x: w * 0.8, y: h * 0.8},
      {x: w * 0.2, y: h * 0.8}
    ];
  }

  // Neon ring is already an octagon and circular enough, but we can spline it.
  // Cyber square is a literal square, so we shouldn't spline it.
  if (currentSettings.track === 'cyber_square') {
    cachedSplines[currentSettings.track] = rawPoints;
  } else {
    cachedSplines[currentSettings.track] = generateSpline(rawPoints, 12);
  }
  
  return cachedSplines[currentSettings.track];
}

function distToSegmentSquared(p, v, w) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

function getDistToTrack(x, y, waypoints) {
  let minDistSq = Infinity;
  for(let i=0; i<waypoints.length; i++) {
    const v = waypoints[i];
    const w = waypoints[(i+1) % waypoints.length];
    const distSq = distToSegmentSquared({x, y}, v, w);
    if (distSq < minDistSq) minDistSq = distSq;
  }
  return Math.sqrt(minDistSq);
}

function updatePhysics() {
  let totalHumanSpeed = 0;
  let humanCount = 0;
  
  Object.values(players).forEach(p => {
    if (!p.isBot) {
      humanCount++;
      totalHumanSpeed += Math.hypot(p.vx, p.vy);
    }
  });
  
  // Floor human speed average slightly to prevent bots dead-stopping
  const avgSpeed = humanCount > 0 ? Math.max(totalHumanSpeed / humanCount, 1.0) : 1.5; 
  const waypoints = getWaypoints();

  Object.values(players).forEach(p => {
    
    // AI Processor
    if (p.isBot) {
      const wp = waypoints[p.targetWaypoint];
      const dx = wp.x - p.x;
      const dy = wp.y - p.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist < 120) {
        p.targetWaypoint = (p.targetWaypoint + 1) % waypoints.length;
      }
      
      let targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - p.angle;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      if (diff > 0.15) p.steer = 1;
      else if (diff < -0.15) p.steer = -1;
      else p.steer = 0;

      // Rubber banding
      const botSpeed = Math.hypot(p.vx, p.vy);
      if (botSpeed > avgSpeed + 0.3) {
        p.gas = 0;
      } else {
        p.gas = 1;
      }
    }

    const speed = Math.hypot(p.vx, p.vy);
    const speedFactor = Math.min(speed / 2, 1); 

    p.angle += p.steer * TURN_SPEED * speedFactor;

    if (p.gas === 1) {
      p.vx += Math.cos(p.angle) * ENGINE_POWER;
      p.vy += Math.sin(p.angle) * ENGINE_POWER;
    } else if (p.gas === -1) {
      // Braking / Reverse (slightly weaker than gas)
      p.vx -= Math.cos(p.angle) * (ENGINE_POWER * 0.7);
      p.vy -= Math.sin(p.angle) * (ENGINE_POWER * 0.7);
    }

    // Mathematical Map Boundaries (Grass Simulation)
    let currentFriction = FRICTION;
    const distFromCenter = getDistToTrack(p.x, p.y, waypoints);
    if (distFromCenter > 40) {
      currentFriction = 0.85; // Off-road grip penalty
    }

    // ── Vector Decomposition Physics ──────────────────────────────────────────
    // Resolve vx/vy into the car's local coordinate frame (forward / lateral)
    const cosA = Math.cos(p.angle);
    const sinA = Math.sin(p.angle);

    // Dot-product projections onto heading axis and perpendicular (lateral) axis
    const forwardVel  =  p.vx * cosA + p.vy * sinA;   // +ve = moving forward
    const lateralVel  = -p.vx * sinA + p.vy * cosA;   // +ve = sliding right

    // Speed-dependent grip: faster → more drift allowed (less lateral grip)
    const currentSpeed = Math.hypot(p.vx, p.vy);
    const driftFactor = Math.min(currentSpeed / 4, 1);   // 0 at rest → 1 at full speed
    const LATERAL_GRIP_BASE = 0.78;               // Strong base grip
    const LATERAL_GRIP_DRIFT = 0.92;              // Loose grip at high speed
    const lateralFriction = LATERAL_GRIP_BASE + (LATERAL_GRIP_DRIFT - LATERAL_GRIP_BASE) * driftFactor;

    // Apply separate friction to each axis (longitudinal rolls freely, lateral grips)
    const newForward = forwardVel * currentFriction;
    const newLateral = lateralVel * lateralFriction;

    // Recompose back into world-space vx/vy
    p.vx = cosA * newForward - sinA * newLateral;
    p.vy = sinA * newForward + cosA * newLateral;
    // ── End Vector Decomposition ───────────────────────────────────────────────
    
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < -30) p.x = canvas.width + 30;
    if (p.x > canvas.width + 30) p.x = -30;
    if (p.y < -30) p.y = canvas.height + 30;
    if (p.y > canvas.height + 30) p.y = -30;
  });
}

function drawCars() {
  Object.values(players).forEach(p => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    
    ctx.strokeStyle = p.color;
    ctx.shadowBlur = 15;
    ctx.shadowColor = p.color;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.moveTo(20, 0);       
    ctx.lineTo(-15, -12);    
    ctx.lineTo(-10, 0);      
    ctx.lineTo(-15, 12);     
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Gas flames
    if (p.gas === 1) {
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-20 - Math.random() * 15, 0);
      ctx.strokeStyle = '#00FFDD'; 
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00FFDD';
      ctx.stroke();
    }

    // Brake lights
    if (p.gas === -1) {
      ctx.fillStyle = '#FF0055';
      ctx.shadowColor = '#FF0055';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(-14, -10, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-14, 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Draw non-rotating driver nametag above kart
    ctx.fillStyle = p.color;
    ctx.font = '10px "Press Start 2P", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 5;
    ctx.shadowColor = p.color;
    ctx.fillText(p.name, p.x, p.y - 25);
    ctx.shadowBlur = 0;
  });
}

function drawTrack() {
  const points = getWaypoints();
  if (!points || points.length === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Grass Outline
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for(let i=1; i<points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = '#2d5a27'; // Dark green grass
  ctx.lineWidth = 110;
  ctx.stroke();

  // Asphalt Core
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for(let i=1; i<points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = '#333333'; // Asphalt gray
  ctx.lineWidth = 80;
  ctx.stroke();

  // Draw start/finish line spanning asphalt width
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  const dist = Math.hypot(dx, dy);
  const nx = -dy / dist;
  const ny = dx / dist;

  ctx.beginPath();
  ctx.moveTo(points[0].x + nx * 40, points[0].y + ny * 40);
  ctx.lineTo(points[0].x - nx * 40, points[0].y - ny * 40);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();
}

function loop() {
  ctx.fillStyle = 'rgba(5, 5, 16, 0.4)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  drawGrid();
  drawTrack();
  
  if (gameState === 'racing') {
    updatePhysics();
  } else {
    // Draw Lobby Notification
    ctx.fillStyle = '#fff';
    ctx.font = '24px "Press Start 2P", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.fillText(lobbyText, canvas.width/2, canvas.height - 40);
    ctx.shadowBlur = 0;
  }
  
  drawCars();
  requestAnimationFrame(loop);
}

loop();
