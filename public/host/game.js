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
  
  if (currentSettings.track === 'vika_long') {
    rawPoints = [
      {x: w * 0.532, y: h * 0.933},
      {x: w * 0.397, y: h * 0.933},
      {x: w * 0.361, y: h * 0.929},
      {x: w * 0.331, y: h * 0.916},
      {x: w * 0.295, y: h * 0.893},
      {x: w * 0.268, y: h * 0.858},
      {x: w * 0.065, y: h * 0.525},
      {x: w * 0.045, y: h * 0.475},
      {x: w * 0.034, y: h * 0.443},
      {x: w * 0.035, y: h * 0.409},
      {x: w * 0.050, y: h * 0.386},
      {x: w * 0.064, y: h * 0.377},
      {x: w * 0.084, y: h * 0.377},
      {x: w * 0.107, y: h * 0.389},
      {x: w * 0.211, y: h * 0.466},
      {x: w * 0.239, y: h * 0.488},
      {x: w * 0.263, y: h * 0.494},
      {x: w * 0.283, y: h * 0.494},
      {x: w * 0.303, y: h * 0.500},
      {x: w * 0.321, y: h * 0.508},
      {x: w * 0.338, y: h * 0.536},
      {x: w * 0.355, y: h * 0.572},
      {x: w * 0.365, y: h * 0.617},
      {x: w * 0.374, y: h * 0.662},
      {x: w * 0.385, y: h * 0.687},
      {x: w * 0.404, y: h * 0.711},
      {x: w * 0.443, y: h * 0.730},
      {x: w * 0.485, y: h * 0.733},
      {x: w * 0.705, y: h * 0.732},
      {x: w * 0.733, y: h * 0.721},
      {x: w * 0.750, y: h * 0.697},
      {x: w * 0.762, y: h * 0.650},
      {x: w * 0.763, y: h * 0.603},
      {x: w * 0.755, y: h * 0.567},
      {x: w * 0.730, y: h * 0.515},
      {x: w * 0.708, y: h * 0.483},
      {x: w * 0.688, y: h * 0.475},
      {x: w * 0.664, y: h * 0.474},
      {x: w * 0.613, y: h * 0.495},
      {x: w * 0.576, y: h * 0.510},
      {x: w * 0.547, y: h * 0.507},
      {x: w * 0.517, y: h * 0.498},
      {x: w * 0.486, y: h * 0.479},
      {x: w * 0.346, y: h * 0.324},
      {x: w * 0.330, y: h * 0.280},
      {x: w * 0.324, y: h * 0.240},
      {x: w * 0.324, y: h * 0.187},
      {x: w * 0.333, y: h * 0.142},
      {x: w * 0.353, y: h * 0.109},
      {x: w * 0.385, y: h * 0.084},
      {x: w * 0.426, y: h * 0.085},
      {x: w * 0.464, y: h * 0.101},
      {x: w * 0.901, y: h * 0.282},
      {x: w * 0.925, y: h * 0.301},
      {x: w * 0.942, y: h * 0.324},
      {x: w * 0.953, y: h * 0.348},
      {x: w * 0.962, y: h * 0.367},
      {x: w * 0.968, y: h * 0.395},
      {x: w * 0.969, y: h * 0.434},
      {x: w * 0.970, y: h * 0.515},
      {x: w * 0.967, y: h * 0.547},
      {x: w * 0.958, y: h * 0.561},
      {x: w * 0.941, y: h * 0.571},
      {x: w * 0.918, y: h * 0.583},
      {x: w * 0.905, y: h * 0.603},
      {x: w * 0.898, y: h * 0.632},
      {x: w * 0.898, y: h * 0.673},
      {x: w * 0.906, y: h * 0.725},
      {x: w * 0.918, y: h * 0.784},
      {x: w * 0.925, y: h * 0.838},
      {x: w * 0.925, y: h * 0.881},
      {x: w * 0.914, y: h * 0.917},
      {x: w * 0.888, y: h * 0.929},
      {x: w * 0.845, y: h * 0.928}
    ];
  } else if (currentSettings.track === 'kartplex') {
    rawPoints = [
      {x: w * 0.554, y: h * 0.932},
      {x: w * 0.091, y: h * 0.933},
      {x: w * 0.074, y: h * 0.930},
      {x: w * 0.052, y: h * 0.916},
      {x: w * 0.039, y: h * 0.898},
      {x: w * 0.035, y: h * 0.868},
      {x: w * 0.038, y: h * 0.832},
      {x: w * 0.054, y: h * 0.808},
      {x: w * 0.086, y: h * 0.769},
      {x: w * 0.105, y: h * 0.729},
      {x: w * 0.111, y: h * 0.677},
      {x: w * 0.109, y: h * 0.634},
      {x: w * 0.096, y: h * 0.602},
      {x: w * 0.080, y: h * 0.556},
      {x: w * 0.069, y: h * 0.529},
      {x: w * 0.069, y: h * 0.498},
      {x: w * 0.080, y: h * 0.470},
      {x: w * 0.098, y: h * 0.448},
      {x: w * 0.126, y: h * 0.438},
      {x: w * 0.156, y: h * 0.442},
      {x: w * 0.170, y: h * 0.458},
      {x: w * 0.185, y: h * 0.492},
      {x: w * 0.205, y: h * 0.520},
      {x: w * 0.228, y: h * 0.549},
      {x: w * 0.259, y: h * 0.572},
      {x: w * 0.287, y: h * 0.579},
      {x: w * 0.322, y: h * 0.588},
      {x: w * 0.362, y: h * 0.592},
      {x: w * 0.391, y: h * 0.593},
      {x: w * 0.427, y: h * 0.593},
      {x: w * 0.448, y: h * 0.595},
      {x: w * 0.467, y: h * 0.615},
      {x: w * 0.475, y: h * 0.638},
      {x: w * 0.481, y: h * 0.675},
      {x: w * 0.482, y: h * 0.706},
      {x: w * 0.487, y: h * 0.746},
      {x: w * 0.493, y: h * 0.778},
      {x: w * 0.501, y: h * 0.798},
      {x: w * 0.521, y: h * 0.811},
      {x: w * 0.552, y: h * 0.820},
      {x: w * 0.581, y: h * 0.820},
      {x: w * 0.612, y: h * 0.812},
      {x: w * 0.641, y: h * 0.802},
      {x: w * 0.658, y: h * 0.791},
      {x: w * 0.676, y: h * 0.777},
      {x: w * 0.685, y: h * 0.747},
      {x: w * 0.678, y: h * 0.709},
      {x: w * 0.658, y: h * 0.685},
      {x: w * 0.629, y: h * 0.676},
      {x: w * 0.600, y: h * 0.668},
      {x: w * 0.575, y: h * 0.663},
      {x: w * 0.554, y: h * 0.647},
      {x: w * 0.530, y: h * 0.599},
      {x: w * 0.524, y: h * 0.562},
      {x: w * 0.510, y: h * 0.524},
      {x: w * 0.500, y: h * 0.503},
      {x: w * 0.479, y: h * 0.483},
      {x: w * 0.443, y: h * 0.462},
      {x: w * 0.404, y: h * 0.445},
      {x: w * 0.543, y: h * 0.626},
      {x: w * 0.425, y: h * 0.452},
      {x: w * 0.377, y: h * 0.420},
      {x: w * 0.359, y: h * 0.403},
      {x: w * 0.342, y: h * 0.376},
      {x: w * 0.307, y: h * 0.333},
      {x: w * 0.225, y: h * 0.216},
      {x: w * 0.202, y: h * 0.174},
      {x: w * 0.199, y: h * 0.139},
      {x: w * 0.201, y: h * 0.103},
      {x: w * 0.214, y: h * 0.076},
      {x: w * 0.230, y: h * 0.061},
      {x: w * 0.250, y: h * 0.052},
      {x: w * 0.278, y: h * 0.054},
      {x: w * 0.299, y: h * 0.085},
      {x: w * 0.313, y: h * 0.124},
      {x: w * 0.330, y: h * 0.156},
      {x: w * 0.353, y: h * 0.208},
      {x: w * 0.380, y: h * 0.242},
      {x: w * 0.418, y: h * 0.292},
      {x: w * 0.466, y: h * 0.337},
      {x: w * 0.510, y: h * 0.376},
      {x: w * 0.534, y: h * 0.383},
      {x: w * 0.560, y: h * 0.374},
      {x: w * 0.590, y: h * 0.352},
      {x: w * 0.611, y: h * 0.316},
      {x: w * 0.636, y: h * 0.256},
      {x: w * 0.656, y: h * 0.233},
      {x: w * 0.679, y: h * 0.235},
      {x: w * 0.700, y: h * 0.247},
      {x: w * 0.711, y: h * 0.269},
      {x: w * 0.720, y: h * 0.315},
      {x: w * 0.730, y: h * 0.387},
      {x: w * 0.758, y: h * 0.691},
      {x: w * 0.771, y: h * 0.743},
      {x: w * 0.787, y: h * 0.777},
      {x: w * 0.802, y: h * 0.793},
      {x: w * 0.820, y: h * 0.798},
      {x: w * 0.834, y: h * 0.782},
      {x: w * 0.847, y: h * 0.752},
      {x: w * 0.853, y: h * 0.703},
      {x: w * 0.857, y: h * 0.647},
      {x: w * 0.856, y: h * 0.615},
      {x: w * 0.844, y: h * 0.568},
      {x: w * 0.833, y: h * 0.524},
      {x: w * 0.823, y: h * 0.463},
      {x: w * 0.813, y: h * 0.406},
      {x: w * 0.808, y: h * 0.367},
      {x: w * 0.807, y: h * 0.329},
      {x: w * 0.813, y: h * 0.315},
      {x: w * 0.823, y: h * 0.306},
      {x: w * 0.848, y: h * 0.297},
      {x: w * 0.884, y: h * 0.306},
      {x: w * 0.919, y: h * 0.309},
      {x: w * 0.937, y: h * 0.319},
      {x: w * 0.961, y: h * 0.329},
      {x: w * 0.971, y: h * 0.350},
      {x: w * 0.975, y: h * 0.383},
      {x: w * 0.967, y: h * 0.461},
      {x: w * 0.925, y: h * 0.837},
      {x: w * 0.919, y: h * 0.868},
      {x: w * 0.913, y: h * 0.898},
      {x: w * 0.898, y: h * 0.916},
      {x: w * 0.889, y: h * 0.928},
      {x: w * 0.862, y: h * 0.943},
      {x: w * 0.817, y: h * 0.943}
    ];
  } else if (currentSettings.track === 'cariboo') {
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
      {x: w * 0.413, y: h * 0.582},
      {x: w * 0.396, y: h * 0.581},
      {x: w * 0.376, y: h * 0.581},
      {x: w * 0.178, y: h * 0.578},
      {x: w * 0.150, y: h * 0.569},
      {x: w * 0.126, y: h * 0.546},
      {x: w * 0.098, y: h * 0.516},
      {x: w * 0.080, y: h * 0.486},
      {x: w * 0.070, y: h * 0.460},
      {x: w * 0.069, y: h * 0.421},
      {x: w * 0.082, y: h * 0.392},
      {x: w * 0.107, y: h * 0.372},
      {x: w * 0.135, y: h * 0.342},
      {x: w * 0.160, y: h * 0.280},
      {x: w * 0.169, y: h * 0.223},
      {x: w * 0.185, y: h * 0.179},
      {x: w * 0.198, y: h * 0.147},
      {x: w * 0.212, y: h * 0.130},
      {x: w * 0.225, y: h * 0.124},
      {x: w * 0.243, y: h * 0.124},
      {x: w * 0.282, y: h * 0.134},
      {x: w * 0.423, y: h * 0.159},
      {x: w * 0.545, y: h * 0.190},
      {x: w * 0.572, y: h * 0.205},
      {x: w * 0.587, y: h * 0.222},
      {x: w * 0.597, y: h * 0.253},
      {x: w * 0.597, y: h * 0.291},
      {x: w * 0.591, y: h * 0.320},
      {x: w * 0.571, y: h * 0.341},
      {x: w * 0.549, y: h * 0.347},
      {x: w * 0.517, y: h * 0.341},
      {x: w * 0.475, y: h * 0.332},
      {x: w * 0.438, y: h * 0.321},
      {x: w * 0.400, y: h * 0.302},
      {x: w * 0.373, y: h * 0.282},
      {x: w * 0.333, y: h * 0.264},
      {x: w * 0.306, y: h * 0.252},
      {x: w * 0.288, y: h * 0.250},
      {x: w * 0.271, y: h * 0.259},
      {x: w * 0.253, y: h * 0.274},
      {x: w * 0.237, y: h * 0.300},
      {x: w * 0.228, y: h * 0.336},
      {x: w * 0.223, y: h * 0.369},
      {x: w * 0.221, y: h * 0.405},
      {x: w * 0.223, y: h * 0.427},
      {x: w * 0.232, y: h * 0.443},
      {x: w * 0.242, y: h * 0.451},
      {x: w * 0.258, y: h * 0.454},
      {x: w * 0.278, y: h * 0.435},
      {x: w * 0.295, y: h * 0.409},
      {x: w * 0.314, y: h * 0.391},
      {x: w * 0.328, y: h * 0.387},
      {x: w * 0.345, y: h * 0.395},
      {x: w * 0.365, y: h * 0.415},
      {x: w * 0.384, y: h * 0.434},
      {x: w * 0.403, y: h * 0.456},
      {x: w * 0.429, y: h * 0.456},
      {x: w * 0.472, y: h * 0.462},
      {x: w * 0.525, y: h * 0.464},
      {x: w * 0.579, y: h * 0.466},
      {x: w * 0.616, y: h * 0.463},
      {x: w * 0.639, y: h * 0.449},
      {x: w * 0.660, y: h * 0.407},
      {x: w * 0.674, y: h * 0.361},
      {x: w * 0.684, y: h * 0.314},
      {x: w * 0.690, y: h * 0.267},
      {x: w * 0.697, y: h * 0.235},
      {x: w * 0.712, y: h * 0.206},
      {x: w * 0.732, y: h * 0.202},
      {x: w * 0.762, y: h * 0.218},
      {x: w * 0.802, y: h * 0.268},
      {x: w * 0.857, y: h * 0.341},
      {x: w * 0.884, y: h * 0.401},
      {x: w * 0.897, y: h * 0.442},
      {x: w * 0.909, y: h * 0.492},
      {x: w * 0.920, y: h * 0.557},
      {x: w * 0.935, y: h * 0.649},
      {x: w * 0.947, y: h * 0.740},
      {x: w * 0.955, y: h * 0.785},
      {x: w * 0.960, y: h * 0.827},
      {x: w * 0.957, y: h * 0.858},
      {x: w * 0.942, y: h * 0.880},
      {x: w * 0.922, y: h * 0.900},
      {x: w * 0.880, y: h * 0.899},
      {x: w * 0.832, y: h * 0.895},
      {x: w * 0.783, y: h * 0.898},
      {x: w * 0.741, y: h * 0.893},
      {x: w * 0.710, y: h * 0.886},
      {x: w * 0.683, y: h * 0.855},
      {x: w * 0.675, y: h * 0.812},
      {x: w * 0.679, y: h * 0.773},
      {x: w * 0.692, y: h * 0.736},
      {x: w * 0.712, y: h * 0.710},
      {x: w * 0.740, y: h * 0.701},
      {x: w * 0.762, y: h * 0.708},
      {x: w * 0.780, y: h * 0.734},
      {x: w * 0.794, y: h * 0.755},
      {x: w * 0.812, y: h * 0.772},
      {x: w * 0.833, y: h * 0.775},
      {x: w * 0.851, y: h * 0.769},
      {x: w * 0.869, y: h * 0.747},
      {x: w * 0.876, y: h * 0.705},
      {x: w * 0.872, y: h * 0.663},
      {x: w * 0.862, y: h * 0.608},
      {x: w * 0.850, y: h * 0.534},
      {x: w * 0.837, y: h * 0.490},
      {x: w * 0.823, y: h * 0.448},
      {x: w * 0.805, y: h * 0.425},
      {x: w * 0.783, y: h * 0.407},
      {x: w * 0.761, y: h * 0.400},
      {x: w * 0.743, y: h * 0.415},
      {x: w * 0.729, y: h * 0.462},
      {x: w * 0.724, y: h * 0.512},
      {x: w * 0.717, y: h * 0.549},
      {x: w * 0.706, y: h * 0.575},
      {x: w * 0.684, y: h * 0.587}
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
