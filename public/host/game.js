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
});

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
const ENGINE_POWER = 0.16;
const FRICTION = 0.95;
const TURN_SPEED = 0.08;

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

function getWaypoints() {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  
  if (currentSettings.track === 'cariboo') {
    return [
      {x: w * 0.3,  y: h * 0.85},
      {x: w * 0.75, y: h * 0.85},
      {x: w * 0.9,  y: h * 0.75},
      {x: w * 0.95, y: h * 0.45},
      {x: w * 0.85, y: h * 0.15},
      {x: w * 0.6,  y: h * 0.1},
      {x: w * 0.25, y: h * 0.1},
      {x: w * 0.1,  y: h * 0.2},
      {x: w * 0.2,  y: h * 0.35},
      {x: w * 0.5,  y: h * 0.4},
      {x: w * 0.7,  y: h * 0.45},
      {x: w * 0.8,  y: h * 0.55},
      {x: w * 0.65, y: h * 0.65},
      {x: w * 0.3,  y: h * 0.65},
      {x: w * 0.15, y: h * 0.65},
      {x: w * 0.1,  y: h * 0.75},
      {x: w * 0.2,  y: h * 0.85}
    ];
  } else if (currentSettings.track === 'west_coast') {
    return [
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
    return [
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
    return [
      {x: w * 0.2, y: h * 0.2},
      {x: w * 0.8, y: h * 0.2},
      {x: w * 0.8, y: h * 0.8},
      {x: w * 0.2, y: h * 0.8}
    ];
  }
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
      currentFriction = 0.85; // 50% max speed penalty on grass
    }

    p.vx *= currentFriction;
    p.vy *= currentFriction;
    
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
