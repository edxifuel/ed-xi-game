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
let currentSettings = { track: 'neon_ring', racers: 2 };
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
});

function updatePlayerList() {
  playerList.innerHTML = '';
  Object.values(players).forEach((p, idx) => {
    const el = document.createElement('div');
    el.className = 'player-token';
    el.style.borderColor = p.color;
    el.style.color = p.color;
    el.innerHTML = `<div class="color-box" style="background-color: ${p.color};"></div> PLYR ${idx + 1}`;
    playerList.appendChild(el);
  });
}

// PHYSICS & RENDER LOOP
const ENGINE_POWER = 0.5;
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

function updatePhysics() {
  Object.values(players).forEach(p => {
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

    p.vx *= FRICTION;
    p.vy *= FRICTION;
    
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
  });
}

function drawTrack() {
  ctx.lineWidth = 4;
  ctx.shadowBlur = 10;
  
  if (currentSettings.track === 'neon_ring') {
    ctx.strokeStyle = 'rgba(0, 255, 221, 0.4)';
    ctx.shadowColor = '#00FFDD';
    
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.4, canvas.height * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.2, canvas.height * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (currentSettings.track === 'cyber_square') {
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.4)';
    ctx.shadowColor = '#FF0055';
    
    ctx.strokeRect(canvas.width * 0.1, canvas.height * 0.1, canvas.width * 0.8, canvas.height * 0.8);
    ctx.strokeRect(canvas.width * 0.3, canvas.height * 0.3, canvas.width * 0.4, canvas.height * 0.4);
  }
  
  ctx.shadowBlur = 0;
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
