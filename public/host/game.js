const socket = io();

// ── Firebase Global Leaderboard Setup ──────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB13irWVrTG6NLqyNMDfDyzXdw5qJBsJEg",
  authDomain: "retro-velocity.firebaseapp.com",
  projectId: "retro-velocity",
  storageBucket: "retro-velocity.firebasestorage.app",
  messagingSenderId: "204991291080",
  appId: "1:204991291080:web:6077413b9094fea6894ffd",
  measurementId: "G-PWBH27WREG"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let topLeaderboard = [];
let leaderboardListener = null;

function watchLeaderboard(trackName) {
  if (!db || !trackName) return;
  if (leaderboardListener) leaderboardListener(); // Unsubscribe previous
  
  leaderboardListener = db.collection('leaderboards').doc(trackName).collection('laps')
    .orderBy('time', 'asc')
    .limit(10)
    .onSnapshot(snapshot => {
       topLeaderboard = [];
       snapshot.forEach(doc => topLeaderboard.push(doc.data()));
    }, err => {
       console.error("Firebase Leaderboard read failed:", err);
    });
}

function submitLapToLeaderboard(playerName, lapTime, trackName) {
  if (!db || !trackName) return;
  // Exclude AI Bots
  if (playerName.startsWith('CPU-')) return;

  const docRef = db.collection('leaderboards').doc(trackName);
  docRef.collection('laps').add({
    name: playerName,
    time: lapTime,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(err => console.error("Firebase write failed:", err));
}

const roomCodeDisplay = document.getElementById('room-code-display');
const playerList = document.getElementById('player-list');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Use window.innerWidth/innerHeight for rock-solid full screen.
// We debounce the resize so scrollbar flickers during lobby don't cause track rebuilds.
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const newW = window.innerWidth;
    const newH = window.innerHeight;
    if (Math.abs(newW - canvas.width) > 30 || Math.abs(newH - canvas.height) > 30) {
      canvas.width  = newW;
      canvas.height = newH;
      cachedSplines = {}; // Force track rebuild
    }
  }, 200);
});

let roomCode = '';
let players = {};
let sessionEndsAt = 0;

let gameState = 'lobby';
let currentSettings = { track: 'vika_short', racers: 2 };
watchLeaderboard(currentSettings.track);
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
    gas: 0,
    targetWaypoint: 0,
    lapsCompleted: 0,
    fastestLap: Infinity,
    lastLapMark: 0
  };
  updatePlayerList();
});

socket.on('playerLeft', (id) => {
  delete players[id];
  updatePlayerList();
});

socket.on('playerInput', (data) => {
  if (players[data.id] && (gameState === 'racing' || gameState === 'qualifying')) {
    players[data.id].steer = data.steer;
    players[data.id].gas = data.gas;
  }
});

socket.on('settingsUpdated', (settings) => {
  // Only update settings during lobby — never mid-race.
  // If currentSettings.track changes mid-race, getWaypoints() rebuilds the
  // spline at different coordinates and causes the two-track overlay bug.
  if (gameState === 'lobby' || gameState === 'waiting_players') {
    const trackChanged = currentSettings.track !== settings.track;
    currentSettings = settings;
    cachedSplines = {}; // force rebuild at correct canvas size
    if (trackChanged) watchLeaderboard(currentSettings.track);
  }
});

socket.on('lobbyStatus', (data) => {
  gameState = 'waiting_players';
  const remaining = data.target - data.current;
  lobbyText = remaining > 0 ? `WAITING FOR ${remaining} RACER(S) TO SCAN IN` : 'READY TO START';
});

socket.on('raceStart', (settings) => {
  currentSettings = settings;
  cachedSplines = {}; // Ensure fresh spline at current canvas dimensions
  gameState = 'qualifying';
  document.getElementById('room-info').style.display = 'none';
  
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
         gas: 0,
         lapsCompleted: 0,
         fastestLap: Infinity,
         lastLapMark: 0
       };
     }
    updatePlayerList();
  }
  
  // Start the 2 minute qualifying timer
  sessionEndsAt = Date.now() + (2 * 60 * 1000); 
  
  // Wipe session stats
  Object.values(players).forEach(p => {
    p.fastestLap = Infinity;
    p.lastLapMark = Date.now();
    p.lapsCompleted = 0;
    p.targetWaypoint = 0;
    p.vx = 0;
    p.vy = 0;
  });
  
  // Place all karts at the start/finish line for qualifying
  alignStartingGrid();
});

function alignStartingGrid(sortedKeys) {
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
  
  const playerKeys = sortedKeys || Object.keys(players);
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
// Increased speeds by an additional 15% for baseline feel.
const ENGINE_POWER = 0.0200;
const FRICTION = 0.988;
const TURN_SPEED = 0.080;

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
  const cw = canvas.width;
  const ch = canvas.height;

  // Cache: keyed on canvas size AND track name so a track switch always rebuilds
  const cacheKey = `${currentSettings.track}_${cw}_${ch}`;
  if (cachedSplines[cacheKey]) {
     return cachedSplines[cacheKey];
  }

  // Prevent track from stretching excessively on ultrawide/ultratall screens
  const padding = 80;
  const aspect = cw / ch;
  
  let safeW = cw - padding * 2;
  let safeH = ch - padding * 2;
  
  if (aspect > 1.9) {
    safeW = safeH * 1.9;
  } else if (aspect < 1.3) {
    safeH = safeW / 1.3;
  }
  
  const drawOffsetX = (cw - safeW) / 2;
  const drawOffsetY = (ch - safeH) / 2;

  const w = safeW;
  const h = safeH;
  const cx = w / 2;
  const cy = h / 2;

  let rawPoints = [];
  
  if (currentSettings.track === 'vika_short') {
    rawPoints = [
      {x: w * 0.533, y: h * 0.933},
      {x: w * 0.408, y: h * 0.933},
      {x: w * 0.376, y: h * 0.929},
      {x: w * 0.350, y: h * 0.923},
      {x: w * 0.330, y: h * 0.912},
      {x: w * 0.326, y: h * 0.885},
      {x: w * 0.338, y: h * 0.871},
      {x: w * 0.360, y: h * 0.859},
      {x: w * 0.388, y: h * 0.858},
      {x: w * 0.410, y: h * 0.843},
      {x: w * 0.428, y: h * 0.834},
      {x: w * 0.446, y: h * 0.818},
      {x: w * 0.453, y: h * 0.786},
      {x: w * 0.451, y: h * 0.760},
      {x: w * 0.453, y: h * 0.729},
      {x: w * 0.468, y: h * 0.720},
      {x: w * 0.496, y: h * 0.722},
      {x: w * 0.535, y: h * 0.724},
      {x: w * 0.702, y: h * 0.721},
      {x: w * 0.730, y: h * 0.720},
      {x: w * 0.758, y: h * 0.697},
      {x: w * 0.766, y: h * 0.674},
      {x: w * 0.769, y: h * 0.631},
      {x: w * 0.764, y: h * 0.595},
      {x: w * 0.753, y: h * 0.558},
      {x: w * 0.732, y: h * 0.512},
      {x: w * 0.712, y: h * 0.488},
      {x: w * 0.691, y: h * 0.475},
      {x: w * 0.667, y: h * 0.476},
      {x: w * 0.639, y: h * 0.485},
      {x: w * 0.594, y: h * 0.500},
      {x: w * 0.568, y: h * 0.513},
      {x: w * 0.539, y: h * 0.506},
      {x: w * 0.507, y: h * 0.492},
      {x: w * 0.477, y: h * 0.470},
      {x: w * 0.348, y: h * 0.324},
      {x: w * 0.334, y: h * 0.300},
      {x: w * 0.326, y: h * 0.266},
      {x: w * 0.321, y: h * 0.209},
      {x: w * 0.328, y: h * 0.163},
      {x: w * 0.344, y: h * 0.122},
      {x: w * 0.373, y: h * 0.092},
      {x: w * 0.403, y: h * 0.082},
      {x: w * 0.444, y: h * 0.095},
      {x: w * 0.900, y: h * 0.283},
      {x: w * 0.921, y: h * 0.300},
      {x: w * 0.940, y: h * 0.319},
      {x: w * 0.953, y: h * 0.345},
      {x: w * 0.965, y: h * 0.385},
      {x: w * 0.970, y: h * 0.423},
      {x: w * 0.973, y: h * 0.459},
      {x: w * 0.973, y: h * 0.493},
      {x: w * 0.971, y: h * 0.525},
      {x: w * 0.963, y: h * 0.551},
      {x: w * 0.948, y: h * 0.568},
      {x: w * 0.925, y: h * 0.581},
      {x: w * 0.907, y: h * 0.597},
      {x: w * 0.898, y: h * 0.620},
      {x: w * 0.895, y: h * 0.645},
      {x: w * 0.901, y: h * 0.697},
      {x: w * 0.913, y: h * 0.776},
      {x: w * 0.927, y: h * 0.841},
      {x: w * 0.927, y: h * 0.869},
      {x: w * 0.921, y: h * 0.901},
      {x: w * 0.908, y: h * 0.917},
      {x: w * 0.882, y: h * 0.930},
      {x: w * 0.828, y: h * 0.929}
    ];
  } else if (currentSettings.track === 'vika_long') {
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
      {x: w * 0.563, y: h * 0.960},
      {x: w * 0.179, y: h * 0.960},
      {x: w * 0.098, y: h * 0.959},
      {x: w * 0.068, y: h * 0.956},
      {x: w * 0.039, y: h * 0.942},
      {x: w * 0.019, y: h * 0.898},
      {x: w * 0.018, y: h * 0.848},
      {x: w * 0.037, y: h * 0.802},
      {x: w * 0.068, y: h * 0.757},
      {x: w * 0.086, y: h * 0.720},
      {x: w * 0.088, y: h * 0.656},
      {x: w * 0.075, y: h * 0.606},
      {x: w * 0.059, y: h * 0.553},
      {x: w * 0.052, y: h * 0.489},
      {x: w * 0.080, y: h * 0.434},
      {x: w * 0.106, y: h * 0.411},
      {x: w * 0.142, y: h * 0.407},
      {x: w * 0.178, y: h * 0.432},
      {x: w * 0.211, y: h * 0.495},
      {x: w * 0.238, y: h * 0.532},
      {x: w * 0.288, y: h * 0.577},
      {x: w * 0.328, y: h * 0.595},
      {x: w * 0.371, y: h * 0.602},
      {x: w * 0.409, y: h * 0.604},
      {x: w * 0.441, y: h * 0.620},
      {x: w * 0.459, y: h * 0.656},
      {x: w * 0.468, y: h * 0.726},
      {x: w * 0.474, y: h * 0.765},
      {x: w * 0.490, y: h * 0.812},
      {x: w * 0.526, y: h * 0.838},
      {x: w * 0.572, y: h * 0.844},
      {x: w * 0.621, y: h * 0.834},
      {x: w * 0.669, y: h * 0.812},
      {x: w * 0.693, y: h * 0.788},
      {x: w * 0.701, y: h * 0.738},
      {x: w * 0.696, y: h * 0.703},
      {x: w * 0.663, y: h * 0.660},
      {x: w * 0.620, y: h * 0.652},
      {x: w * 0.585, y: h * 0.646},
      {x: w * 0.563, y: h * 0.629},
      {x: w * 0.544, y: h * 0.587},
      {x: w * 0.536, y: h * 0.546},
      {x: w * 0.515, y: h * 0.511},
      {x: w * 0.466, y: h * 0.485},
      {x: w * 0.415, y: h * 0.462},
      {x: w * 0.372, y: h * 0.438},
      {x: w * 0.326, y: h * 0.387},
      {x: w * 0.283, y: h * 0.325},
      {x: w * 0.198, y: h * 0.200},
      {x: w * 0.185, y: h * 0.127},
      {x: w * 0.193, y: h * 0.086},
      {x: w * 0.208, y: h * 0.051},
      {x: w * 0.233, y: h * 0.032},
      {x: w * 0.266, y: h * 0.028},
      {x: w * 0.297, y: h * 0.049},
      {x: w * 0.325, y: h * 0.093},
      {x: w * 0.354, y: h * 0.169},
      {x: w * 0.400, y: h * 0.256},
      {x: w * 0.442, y: h * 0.309},
      {x: w * 0.504, y: h * 0.368},
      {x: w * 0.536, y: h * 0.387},
      {x: w * 0.571, y: h * 0.383},
      {x: w * 0.596, y: h * 0.352},
      {x: w * 0.614, y: h * 0.310},
      {x: w * 0.629, y: h * 0.266},
      {x: w * 0.647, y: h * 0.225},
      {x: w * 0.661, y: h * 0.219},
      {x: w * 0.681, y: h * 0.220},
      {x: w * 0.701, y: h * 0.232},
      {x: w * 0.716, y: h * 0.256},
      {x: w * 0.723, y: h * 0.291},
      {x: w * 0.729, y: h * 0.343},
      {x: w * 0.746, y: h * 0.477},
      {x: w * 0.762, y: h * 0.643},
      {x: w * 0.770, y: h * 0.695},
      {x: w * 0.776, y: h * 0.732},
      {x: w * 0.789, y: h * 0.758},
      {x: w * 0.812, y: h * 0.785},
      {x: w * 0.831, y: h * 0.791},
      {x: w * 0.847, y: h * 0.784},
      {x: w * 0.865, y: h * 0.757},
      {x: w * 0.868, y: h * 0.712},
      {x: w * 0.864, y: h * 0.652},
      {x: w * 0.850, y: h * 0.598},
      {x: w * 0.812, y: h * 0.392},
      {x: w * 0.803, y: h * 0.342},
      {x: w * 0.801, y: h * 0.307},
      {x: w * 0.806, y: h * 0.251},
      {x: w * 0.836, y: h * 0.230},
      {x: w * 0.867, y: h * 0.232},
      {x: w * 0.961, y: h * 0.251},
      {x: w * 0.988, y: h * 0.264},
      {x: w * 0.996, y: h * 0.291},
      {x: w * 0.999, y: h * 0.334},
      {x: w * 0.993, y: h * 0.400},
      {x: w * 0.987, y: h * 0.498},
      {x: w * 0.952, y: h * 0.829},
      {x: w * 0.949, y: h * 0.869},
      {x: w * 0.934, y: h * 0.910},
      {x: w * 0.916, y: h * 0.947},
      {x: w * 0.869, y: h * 0.966},
      {x: w * 0.797, y: h * 0.966}
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
      {x: w * 0.419, y: h * 0.608},
      {x: w * 0.178, y: h * 0.605},
      {x: w * 0.150, y: h * 0.597},
      {x: w * 0.120, y: h * 0.582},
      {x: w * 0.099, y: h * 0.552},
      {x: w * 0.082, y: h * 0.521},
      {x: w * 0.066, y: h * 0.482},
      {x: w * 0.057, y: h * 0.440},
      {x: w * 0.055, y: h * 0.400},
      {x: w * 0.067, y: h * 0.369},
      {x: w * 0.086, y: h * 0.355},
      {x: w * 0.113, y: h * 0.346},
      {x: w * 0.131, y: h * 0.331},
      {x: w * 0.142, y: h * 0.293},
      {x: w * 0.151, y: h * 0.250},
      {x: w * 0.165, y: h * 0.205},
      {x: w * 0.173, y: h * 0.168},
      {x: w * 0.186, y: h * 0.132},
      {x: w * 0.201, y: h * 0.112},
      {x: w * 0.236, y: h * 0.107},
      {x: w * 0.288, y: h * 0.113},
      {x: w * 0.332, y: h * 0.124},
      {x: w * 0.539, y: h * 0.164},
      {x: w * 0.573, y: h * 0.174},
      {x: w * 0.590, y: h * 0.192},
      {x: w * 0.605, y: h * 0.215},
      {x: w * 0.614, y: h * 0.251},
      {x: w * 0.618, y: h * 0.284},
      {x: w * 0.612, y: h * 0.322},
      {x: w * 0.603, y: h * 0.347},
      {x: w * 0.578, y: h * 0.363},
      {x: w * 0.546, y: h * 0.365},
      {x: w * 0.514, y: h * 0.355},
      {x: w * 0.470, y: h * 0.338},
      {x: w * 0.396, y: h * 0.302},
      {x: w * 0.325, y: h * 0.265},
      {x: w * 0.281, y: h * 0.246},
      {x: w * 0.245, y: h * 0.265},
      {x: w * 0.225, y: h * 0.300},
      {x: w * 0.214, y: h * 0.353},
      {x: w * 0.208, y: h * 0.397},
      {x: w * 0.206, y: h * 0.429},
      {x: w * 0.213, y: h * 0.462},
      {x: w * 0.228, y: h * 0.477},
      {x: w * 0.254, y: h * 0.483},
      {x: w * 0.279, y: h * 0.470},
      {x: w * 0.298, y: h * 0.438},
      {x: w * 0.321, y: h * 0.415},
      {x: w * 0.344, y: h * 0.423},
      {x: w * 0.379, y: h * 0.460},
      {x: w * 0.409, y: h * 0.479},
      {x: w * 0.477, y: h * 0.485},
      {x: w * 0.606, y: h * 0.481},
      {x: w * 0.628, y: h * 0.475},
      {x: w * 0.656, y: h * 0.452},
      {x: w * 0.672, y: h * 0.424},
      {x: w * 0.688, y: h * 0.359},
      {x: w * 0.695, y: h * 0.310},
      {x: w * 0.698, y: h * 0.280},
      {x: w * 0.703, y: h * 0.245},
      {x: w * 0.718, y: h * 0.230},
      {x: w * 0.745, y: h * 0.226},
      {x: w * 0.783, y: h * 0.238},
      {x: w * 0.808, y: h * 0.256},
      {x: w * 0.836, y: h * 0.291},
      {x: w * 0.869, y: h * 0.346},
      {x: w * 0.891, y: h * 0.371},
      {x: w * 0.910, y: h * 0.414},
      {x: w * 0.925, y: h * 0.464},
      {x: w * 0.940, y: h * 0.536},
      {x: w * 0.953, y: h * 0.611},
      {x: w * 0.965, y: h * 0.670},
      {x: w * 0.975, y: h * 0.732},
      {x: w * 0.978, y: h * 0.773},
      {x: w * 0.981, y: h * 0.828},
      {x: w * 0.976, y: h * 0.862},
      {x: w * 0.961, y: h * 0.892},
      {x: w * 0.935, y: h * 0.911},
      {x: w * 0.895, y: h * 0.922},
      {x: w * 0.747, y: h * 0.914},
      {x: w * 0.704, y: h * 0.898},
      {x: w * 0.682, y: h * 0.861},
      {x: w * 0.672, y: h * 0.817},
      {x: w * 0.670, y: h * 0.784},
      {x: w * 0.676, y: h * 0.743},
      {x: w * 0.688, y: h * 0.715},
      {x: w * 0.710, y: h * 0.688},
      {x: w * 0.735, y: h * 0.681},
      {x: w * 0.758, y: h * 0.687},
      {x: w * 0.778, y: h * 0.711},
      {x: w * 0.791, y: h * 0.739},
      {x: w * 0.808, y: h * 0.764},
      {x: w * 0.823, y: h * 0.778},
      {x: w * 0.849, y: h * 0.777},
      {x: w * 0.866, y: h * 0.762},
      {x: w * 0.876, y: h * 0.733},
      {x: w * 0.878, y: h * 0.676},
      {x: w * 0.869, y: h * 0.621},
      {x: w * 0.860, y: h * 0.576},
      {x: w * 0.848, y: h * 0.517},
      {x: w * 0.836, y: h * 0.463},
      {x: w * 0.821, y: h * 0.432},
      {x: w * 0.806, y: h * 0.408},
      {x: w * 0.788, y: h * 0.390},
      {x: w * 0.761, y: h * 0.381},
      {x: w * 0.735, y: h * 0.408},
      {x: w * 0.729, y: h * 0.452},
      {x: w * 0.728, y: h * 0.496},
      {x: w * 0.723, y: h * 0.545},
      {x: w * 0.708, y: h * 0.587},
      {x: w * 0.687, y: h * 0.609},
      {x: w * 0.651, y: h * 0.618},
      {x: w * 0.617, y: h * 0.625},
      {x: w * 0.552, y: h * 0.623}
    ];
  } else if (currentSettings.track === 'sima') {
    rawPoints = [
      {x: w * 0.344, y: h * 0.825},
      {x: w * 0.402, y: h * 0.756},
      {x: w * 0.433, y: h * 0.727},
      {x: w * 0.454, y: h * 0.714},
      {x: w * 0.487, y: h * 0.702},
      {x: w * 0.518, y: h * 0.707},
      {x: w * 0.541, y: h * 0.736},
      {x: w * 0.565, y: h * 0.787},
      {x: w * 0.578, y: h * 0.842},
      {x: w * 0.594, y: h * 0.899},
      {x: w * 0.617, y: h * 0.936},
      {x: w * 0.650, y: h * 0.943},
      {x: w * 0.684, y: h * 0.914},
      {x: w * 0.758, y: h * 0.836},
      {x: w * 0.961, y: h * 0.589},
      {x: w * 0.978, y: h * 0.550},
      {x: w * 0.980, y: h * 0.508},
      {x: w * 0.971, y: h * 0.469},
      {x: w * 0.959, y: h * 0.448},
      {x: w * 0.937, y: h * 0.425},
      {x: w * 0.921, y: h * 0.398},
      {x: w * 0.907, y: h * 0.335},
      {x: w * 0.894, y: h * 0.294},
      {x: w * 0.874, y: h * 0.245},
      {x: w * 0.848, y: h * 0.223},
      {x: w * 0.822, y: h * 0.222},
      {x: w * 0.799, y: h * 0.250},
      {x: w * 0.784, y: h * 0.296},
      {x: w * 0.791, y: h * 0.352},
      {x: w * 0.809, y: h * 0.398},
      {x: w * 0.825, y: h * 0.449},
      {x: w * 0.837, y: h * 0.492},
      {x: w * 0.841, y: h * 0.541},
      {x: w * 0.830, y: h * 0.588},
      {x: w * 0.803, y: h * 0.635},
      {x: w * 0.748, y: h * 0.693},
      {x: w * 0.698, y: h * 0.748},
      {x: w * 0.672, y: h * 0.761},
      {x: w * 0.650, y: h * 0.745},
      {x: w * 0.634, y: h * 0.706},
      {x: w * 0.629, y: h * 0.659},
      {x: w * 0.638, y: h * 0.605},
      {x: w * 0.674, y: h * 0.560},
      {x: w * 0.716, y: h * 0.515},
      {x: w * 0.735, y: h * 0.487},
      {x: w * 0.752, y: h * 0.429},
      {x: w * 0.745, y: h * 0.376},
      {x: w * 0.719, y: h * 0.341},
      {x: w * 0.680, y: h * 0.338},
      {x: w * 0.646, y: h * 0.368},
      {x: w * 0.615, y: h * 0.407},
      {x: w * 0.589, y: h * 0.438},
      {x: w * 0.550, y: h * 0.468},
      {x: w * 0.503, y: h * 0.504},
      {x: w * 0.464, y: h * 0.531},
      {x: w * 0.421, y: h * 0.538},
      {x: w * 0.386, y: h * 0.531},
      {x: w * 0.358, y: h * 0.487},
      {x: w * 0.358, y: h * 0.423},
      {x: w * 0.355, y: h * 0.367},
      {x: w * 0.340, y: h * 0.307},
      {x: w * 0.253, y: h * 0.069},
      {x: w * 0.229, y: h * 0.039},
      {x: w * 0.192, y: h * 0.020},
      {x: w * 0.158, y: h * 0.024},
      {x: w * 0.119, y: h * 0.047},
      {x: w * 0.093, y: h * 0.081},
      {x: w * 0.075, y: h * 0.136},
      {x: w * 0.075, y: h * 0.186},
      {x: w * 0.086, y: h * 0.237},
      {x: w * 0.106, y: h * 0.266},
      {x: w * 0.136, y: h * 0.311},
      {x: w * 0.179, y: h * 0.336},
      {x: w * 0.206, y: h * 0.359},
      {x: w * 0.230, y: h * 0.412},
      {x: w * 0.259, y: h * 0.494},
      {x: w * 0.277, y: h * 0.560},
      {x: w * 0.277, y: h * 0.609},
      {x: w * 0.268, y: h * 0.694},
      {x: w * 0.262, y: h * 0.729},
      {x: w * 0.240, y: h * 0.757},
      {x: w * 0.210, y: h * 0.765},
      {x: w * 0.189, y: h * 0.746},
      {x: w * 0.175, y: h * 0.705},
      {x: w * 0.155, y: h * 0.618},
      {x: w * 0.129, y: h * 0.547},
      {x: w * 0.110, y: h * 0.505},
      {x: w * 0.080, y: h * 0.498},
      {x: w * 0.055, y: h * 0.513},
      {x: w * 0.033, y: h * 0.561},
      {x: w * 0.029, y: h * 0.611},
      {x: w * 0.038, y: h * 0.668},
      {x: w * 0.112, y: h * 0.922},
      {x: w * 0.132, y: h * 0.964},
      {x: w * 0.150, y: h * 0.973},
      {x: w * 0.177, y: h * 0.969},
      {x: w * 0.211, y: h * 0.954},
      {x: w * 0.261, y: h * 0.905}
    ];
  } else if (currentSettings.track === 'quesnel') {
    rawPoints = [
      {x: w * 0.513, y: h * 0.856},
      {x: w * 0.636, y: h * 0.866},
      {x: w * 0.757, y: h * 0.869},
      {x: w * 0.826, y: h * 0.870},
      {x: w * 0.868, y: h * 0.850},
      {x: w * 0.899, y: h * 0.816},
      {x: w * 0.928, y: h * 0.752},
      {x: w * 0.947, y: h * 0.677},
      {x: w * 0.944, y: h * 0.611},
      {x: w * 0.922, y: h * 0.521},
      {x: w * 0.872, y: h * 0.395},
      {x: w * 0.818, y: h * 0.240},
      {x: w * 0.778, y: h * 0.148},
      {x: w * 0.741, y: h * 0.105},
      {x: w * 0.680, y: h * 0.104},
      {x: w * 0.628, y: h * 0.125},
      {x: w * 0.557, y: h * 0.164},
      {x: w * 0.482, y: h * 0.196},
      {x: w * 0.432, y: h * 0.223},
      {x: w * 0.393, y: h * 0.229},
      {x: w * 0.364, y: h * 0.212},
      {x: w * 0.325, y: h * 0.157},
      {x: w * 0.302, y: h * 0.109},
      {x: w * 0.265, y: h * 0.070},
      {x: w * 0.229, y: h * 0.055},
      {x: w * 0.180, y: h * 0.051},
      {x: w * 0.140, y: h * 0.066},
      {x: w * 0.101, y: h * 0.103},
      {x: w * 0.076, y: h * 0.154},
      {x: w * 0.059, y: h * 0.214},
      {x: w * 0.070, y: h * 0.265},
      {x: w * 0.104, y: h * 0.313},
      {x: w * 0.147, y: h * 0.336},
      {x: w * 0.186, y: h * 0.357},
      {x: w * 0.245, y: h * 0.379},
      {x: w * 0.281, y: h * 0.413},
      {x: w * 0.307, y: h * 0.460},
      {x: w * 0.329, y: h * 0.482},
      {x: w * 0.364, y: h * 0.488},
      {x: w * 0.402, y: h * 0.464},
      {x: w * 0.446, y: h * 0.433},
      {x: w * 0.493, y: h * 0.410},
      {x: w * 0.531, y: h * 0.389},
      {x: w * 0.570, y: h * 0.369},
      {x: w * 0.609, y: h * 0.363},
      {x: w * 0.648, y: h * 0.373},
      {x: w * 0.684, y: h * 0.390},
      {x: w * 0.720, y: h * 0.429},
      {x: w * 0.750, y: h * 0.470},
      {x: w * 0.793, y: h * 0.532},
      {x: w * 0.800, y: h * 0.580},
      {x: w * 0.800, y: h * 0.622},
      {x: w * 0.785, y: h * 0.658},
      {x: w * 0.775, y: h * 0.683},
      {x: w * 0.741, y: h * 0.699},
      {x: w * 0.702, y: h * 0.699},
      {x: w * 0.672, y: h * 0.675},
      {x: w * 0.644, y: h * 0.638},
      {x: w * 0.620, y: h * 0.606},
      {x: w * 0.584, y: h * 0.584},
      {x: w * 0.543, y: h * 0.582},
      {x: w * 0.496, y: h * 0.605},
      {x: w * 0.463, y: h * 0.636},
      {x: w * 0.429, y: h * 0.667},
      {x: w * 0.371, y: h * 0.681},
      {x: w * 0.322, y: h * 0.672},
      {x: w * 0.290, y: h * 0.658},
      {x: w * 0.242, y: h * 0.621},
      {x: w * 0.212, y: h * 0.575},
      {x: w * 0.183, y: h * 0.526},
      {x: w * 0.150, y: h * 0.503},
      {x: w * 0.112, y: h * 0.513},
      {x: w * 0.082, y: h * 0.545},
      {x: w * 0.073, y: h * 0.588},
      {x: w * 0.081, y: h * 0.642},
      {x: w * 0.113, y: h * 0.699},
      {x: w * 0.141, y: h * 0.784},
      {x: w * 0.179, y: h * 0.823},
      {x: w * 0.227, y: h * 0.850},
      {x: w * 0.294, y: h * 0.863},
      {x: w * 0.340, y: h * 0.865}
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

  // Apply centering and padding offsets so kerbing never runs off screen
  rawPoints.forEach(p => {
    p.x += drawOffsetX;
    p.y += drawOffsetY;
  });

  // Neon ring is already an octagon and circular enough, but we can spline it.
  // Cyber square is a literal square, so we shouldn't spline it.
  if (currentSettings.track === 'cyber_square') {
    cachedSplines[cacheKey] = rawPoints;
  } else {
    cachedSplines[cacheKey] = generateSpline(rawPoints, 12);
  }
  
  return cachedSplines[cacheKey];
}

function getClosestPointOnSegment(p, v, w) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return { x: v.x, y: v.y, distSq: (p.x - v.x) ** 2 + (p.y - v.y) ** 2 };
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = v.x + t * (w.x - v.x);
  const cy = v.y + t * (w.y - v.y);
  return { x: cx, y: cy, distSq: (p.x - cx) ** 2 + (p.y - cy) ** 2 };
}

function getTrackInfo(x, y, waypoints) {
  let minInfo = { distSq: Infinity, x: 0, y: 0 };
  for(let i=0; i<waypoints.length; i++) {
    const v = waypoints[i];
    const w = waypoints[(i+1) % waypoints.length];
    const info = getClosestPointOnSegment({x, y}, v, w);
    if (info.distSq < minInfo.distSq) minInfo = info;
  }
  return { distance: Math.sqrt(minInfo.distSq), closestX: minInfo.x, closestY: minInfo.y };
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

  // ── Calculate Race Positions (Rubber-banding) ─────────────────────────────
  Object.values(players).forEach(p => {
      let wp = waypoints[p.targetWaypoint];
      let dx = wp.x - p.x;
      let dy = wp.y - p.y;
      p.distToWp = Math.hypot(dx, dy);
      p.raceScore = ((p.lapsCompleted || 0) * 1000000) + (p.targetWaypoint * 10000) - p.distToWp;
  });

  const sortedIds = Object.keys(players).sort((a, b) => players[b].raceScore - players[a].raceScore);
  const totalRacers = sortedIds.length;
  sortedIds.forEach((pid, index) => {
     players[pid].raceRank = index + 1; // 1st, 2nd, 3rd...
  });

  Object.entries(players).forEach(([pid, p]) => {
    
    // Universal Lap Tracker (Humans and Bots)
    let wp = waypoints[p.targetWaypoint];
    let dx = wp.x - p.x;
    let dy = wp.y - p.y;
    let dist = Math.hypot(dx, dy);
    
    if (dist < 120) {
      const nextWp = (p.targetWaypoint + 1) % waypoints.length;
      if (nextWp === 0 && p.targetWaypoint > waypoints.length * 0.7) {
        const lapTime = Date.now() - p.lastLapMark;
        if (lapTime < p.fastestLap) {
            p.fastestLap = lapTime;
            submitLapToLeaderboard(p.name, lapTime, currentSettings.track);
        }
        p.lapsCompleted++;
        p.lastLapMark = Date.now();
      }
      p.targetWaypoint = nextWp;
      // Re-fetch distance stats for AI steering towards new waypoint
      wp = waypoints[p.targetWaypoint];
      dx = wp.x - p.x;
      dy = wp.y - p.y;
      dist = Math.hypot(dx, dy);
    }

    // AI Processor
    if (p.isBot) {
      let targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - p.angle;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      if (diff > 0.15) p.steer = 1;
      else if (diff < -0.15) p.steer = -1;
      else p.steer = 0;

      // Rubber banding — but let drafting bots run free so the boost is felt
      const botSpeed = Math.hypot(p.vx, p.vy);
      const rubberBandCap = p.isDrafting ? avgSpeed + 0.8 : avgSpeed + 0.3;
      if (botSpeed > rubberBandCap) {
        p.gas = 0;
      } else {
        p.gas = 1;
      }
    }

    // Speed is needed by both steering and lateral grip — compute once here
    const currentSpeed = Math.hypot(p.vx, p.vy);

    // Grass steering lock: use previous-frame grass flag (stored on player)
    // because position is clamped back to boundary at the END of the physics loop,
    // so a current-frame distance check always reads "not on grass".
    // A 10-frame cooldown keeps steering restricted while the kart recovers from the wall.
    if (typeof p.grassTimer === 'undefined') p.grassTimer = 0;
    const onGrassRestricted = p.grassTimer > 0;
    if (p.grassTimer > 0) p.grassTimer--; // count down every frame

    if (!p.isBot) {
        // ── 1. GYRO SANITIZER ─────────────────────────────────────────────────────
        // Assume p.steer is the calibrated raw degree from the phone

        // Normalize it: 40 degrees of physical tilt = 100% steering lock
        let normalizedSteer = p.steer / 40.0;
        normalizedSteer = Math.max(-1.0, Math.min(1.0, normalizedSteer)); // Clamp it

        // The Deadzone: Ignore tiny natural hand tremors
        if (Math.abs(normalizedSteer) < 0.15) {
            normalizedSteer = 0;
        }

        // Low-Pass Filter: Barely enough to kill hardware jitter, but zero perceptible lag (was 0.80 / 0.20)
        if (typeof p.smoothedSteer === 'undefined') p.smoothedSteer = 0;
        p.smoothedSteer = (p.smoothedSteer * 0.40) + (normalizedSteer * 0.60);


        // ── 2. STEERING PHYSICS ───────────────────────────────────────────────────
        
        // Hard lock: Must be rolling to turn the wheels
        if (currentSpeed > 0.2) { 
            const lowSpeedFactor = Math.min(currentSpeed / 3.0, 1.0); 
            
            // Midpoint dampening dialed down to 0.30 to allow a bit more steering at high speed
            const highSpeedFactor = 1 / (1 + currentSpeed * 0.30);

            // Linear Input: 1:1 with the phone's physical tilt. 
            // Removed the squared curve which forced players to yank the wheel too hard, causing over-corrections.
            const linearSteer = p.smoothedSteer;

            const rawDelta = linearSteer * TURN_SPEED * lowSpeedFactor * highSpeedFactor;
            
            // Restore smooth max bounds
            const MAX_DELTA = onGrassRestricted ? 0.015 : 0.055;  
            
            p.angle += Math.max(-MAX_DELTA, Math.min(MAX_DELTA, rawDelta));
        }
    } else {
        p.smoothedSteer = p.steer;
        const BOT_MAX_DELTA = onGrassRestricted ? 0.015 : 0.07;
        const botDelta = p.smoothedSteer * TURN_SPEED;
        p.angle += Math.max(-BOT_MAX_DELTA, Math.min(BOT_MAX_DELTA, botDelta));
    }

    // ── Drafting Physics ──────────────────────────────────────────────────────
    // Two-pass detection so tier cascades work regardless of player process order:
    // Pass 1: find which kart (if any) is directly in front of us — fresh each frame.
    // Pass 2 (outside forEach) propagates the chain up to 4 tiers deep.
    const DRAFT_RANGE = 200;          // pixels — ~2 kart lengths
    const DRAFT_ANGLE_TOL = 0.50;     // ~28 degrees
    const DRAFT_HEADING_TOL = 0.70;   // ~40 degrees

    let directLeader = null; // The one kart immediately ahead of us
    let bestDist = Infinity;

    Object.entries(players).forEach(([otherId, other]) => {
      if (otherId === pid) return;
      if (Math.hypot(other.vx, other.vy) < 0.8) return; // leader must be moving

      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const distSq = dx*dx + dy*dy;
      if (distSq > DRAFT_RANGE * DRAFT_RANGE || distSq < 400) return;

      // Angle from US to OTHER — must be roughly our forward direction
      const angleToOther = Math.atan2(dy, dx);
      let angleDiff = angleToOther - p.angle;
      while (angleDiff <= -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
      if (Math.abs(angleDiff) > DRAFT_ANGLE_TOL) return;

      // Both karts must be heading roughly the same direction
      let headingDiff = other.angle - p.angle;
      while (headingDiff <= -Math.PI) headingDiff += Math.PI * 2;
      while (headingDiff >  Math.PI) headingDiff -= Math.PI * 2;
      if (Math.abs(headingDiff) > DRAFT_HEADING_TOL) return;

      // Pick the closest qualifying kart
      if (distSq < bestDist) {
        bestDist = distSq;
        directLeader = other;
      }
    });

    // Walk the chain: leader -> leader's leader -> ... (max 4 deep)
    let pDraftTier = 0;
    if (directLeader) {
      pDraftTier = 1;
      let cursor = directLeader;
      for (let chain = 0; chain < 3; chain++) {
        if (!cursor._draftLeader) break;
        pDraftTier++;
        cursor = cursor._draftLeader;
      }
    }

    p._draftLeader = directLeader; // store for next-frame chain walking
    p.draftTier   = pDraftTier;
    p.isDrafting  = pDraftTier > 0;

    let engineBonus = 0;
    if (p.draftTier > 0) {
      // Tier 1 = 18%, Tier 2 = 23%, Tier 3 = 28%, Tier 4 = 33%
      const DRAFT_MIN = 0.8;
      const DRAFT_MAX = 1.3;
      const draftSpeedFactor = currentSpeed < DRAFT_MIN ? 0
        : Math.min((currentSpeed - DRAFT_MIN) / (DRAFT_MAX - DRAFT_MIN), 1.0);
      const boostAmount = 0.13 + (0.05 * p.draftTier);
      const cappedBoost = Math.min(boostAmount, 0.33);
      engineBonus = cappedBoost * draftSpeedFactor;
      p.draftBoostPct = Math.round(engineBonus * 100);
    } else {
      p.draftBoostPct = 0;
    }

    // Catch-up Rubber-banding
    if (totalRacers > 1 && p.raceRank > 1) {
        const rankRatio = (p.raceRank - 1) / (totalRacers - 1);
        const rubberbandBonus = rankRatio * 0.35; // Scales up to 35% for Last Place
        
        // Take whichever multiplier is higher. This stops them from stacking exponentially!
        if (rubberbandBonus > engineBonus) engineBonus = rubberbandBonus;
    }

    let currentPower = ENGINE_POWER * (1 + engineBonus);

    if (p.gas === 1) {
      p.vx += Math.cos(p.angle) * currentPower;
      p.vy += Math.sin(p.angle) * currentPower;
    } else if (p.gas === -1) {
      // Braking / Reverse (Strong fixed deceleration)
      p.vx -= Math.cos(p.angle) * 0.06;
      p.vy -= Math.sin(p.angle) * 0.06;
    }

    // Mathematical Map Boundaries (Grass Simulation)
    let currentFriction = FRICTION;
    const trackInfo = getTrackInfo(p.x, p.y, waypoints);
    // Track boundary — single hard wall at the grass edge.
    // Asphalt half-width = 48px (lineWidth 96). Kerbs extend to 56px.
    // Grass hard wall = 68px. No kerb friction zone — kerbs are purely visual.
    const HARD_WALL = 68;

    let onGrass = false;
    if (trackInfo.distance > HARD_WALL) {
      onGrass = true;
      p.grassTimer = 10; // Restrict steering for 10 frames after wall contact
      // Clamp position back to grass edge
      const dx = p.x - trackInfo.closestX;
      const dy = p.y - trackInfo.closestY;
      const nx = dx / trackInfo.distance;
      const ny = dy / trackInfo.distance;

      p.x = trackInfo.closestX + nx * HARD_WALL;
      p.y = trackInfo.closestY + ny * HARD_WALL;

      // Strip outward velocity component so kart slides along wall cleanly,
      // but still allows driving back inward toward the track!
      const velDotNormal = p.vx * nx + p.vy * ny;
      if (velDotNormal > 0) {
        p.vx -= velDotNormal * nx;
        p.vy -= velDotNormal * ny;
      }

      // Speed penalty only when actually in the grass
      currentFriction = 0.90;
    }

    // ── 3. LATERAL GRIP (The "Snap Straight") ─────────────────────────────────
    const cosA = Math.cos(p.angle);
    const sinA = Math.sin(p.angle);

    const forwardVel  =  p.vx * cosA + p.vy * sinA;
    const lateralVel  = -p.vx * sinA + p.vy * cosA;

    const steerMagnitude = Math.abs(p.smoothedSteer || 0);

    // Smooth speed-based drifting factor
    let driftFactor = Math.min(currentSpeed / 4.0, 1.0); 
    
    // Core Fix: Drafting massively increases speed, which mathematically makes the kart ice-skate.
    // We glue the tires to the road when drafting so the player retains rock-solid control.
    if (p.isDrafting) driftFactor *= 0.2;
    
    const baseGrip = 0.91 + (0.03 * driftFactor); // Ranges 0.91 (solid) to 0.94 (drifty)

    // Steering hard slightly loosens the rear to rotate through corners,
    // but without the extreme 0.97 slip or the violent 0.90 snap-back.
    let lateralFriction = baseGrip + (0.02 * steerMagnitude);
    
    // Disable Snap Straight on grass to prevent violent wall-bounces
    if (onGrass) lateralFriction = 0.95;

    const newForward = forwardVel * currentFriction;
    const newLateral = lateralVel * lateralFriction;

    p.vx = cosA * newForward - sinA * newLateral;
    p.vy = sinA * newForward + cosA * newLateral;
    // ── End Lateral Grip ───────────────────────────────────────────────────────
    
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < -30) p.x = canvas.width + 30;
    if (p.x > canvas.width + 30) p.x = -30;
    if (p.y < -30) p.y = canvas.height + 30;
    if (p.y > canvas.height + 30) p.y = -30;
  });

  // ── Kart-to-Kart Collision ────────────────────────────────────────────────
  // Circle collision, radius 18px per kart. Pushes apart and exchanges
  // velocity so karts can't drive through each other.
  const kartList = Object.values(players);
  const KART_RADIUS = 18;
  for (let i = 0; i < kartList.length; i++) {
    for (let j = i + 1; j < kartList.length; j++) {
      const a = kartList[i];
      const b = kartList[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = KART_RADIUS * 2;
      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        // Push both karts apart equally
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        // NOTE: We do NOT exchange pure velocities (bouncy bump impulse) anymore.
        // Altering vx/vy artificially creates a fake "slide" mathematically which 
        // the lateral-grip engine violently tries to snap-correct. Positional overlap pushing is enough!
      }
    }
  }
}

function drawCars() {
  Object.values(players).forEach(p => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // ── Glow aura ─────────────────────────────────────────────────────────────
    ctx.shadowBlur = 18;
    ctx.shadowColor = p.color;

    // ── Wheels ────────────────────────────────────────────────────────────────
    // Formula layout: wide rear track, narrow front track
    ctx.fillStyle = '#222';
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.5;
    const wheels = [
      { x:  14, y:  -7 }, // front-right (narrower)
      { x:  14, y:   7 }, // front-left  (narrower)
      { x: -13, y: -12 }, // rear-right  (wider)
      { x: -13, y:  12 }, // rear-left   (wider)
    ];
    // Front wheels are thinner, rear wheels are fatter
    wheels.forEach((w, i) => {
      const isRear = i >= 2;
      ctx.beginPath();
      ctx.roundRect(w.x - (isRear ? 6 : 4), w.y - (isRear ? 4 : 3), isRear ? 12 : 8, isRear ? 8 : 6, 1);
      ctx.fill();
      ctx.stroke();
    });

    // ── Formula Body (tapered — wide at rear, narrow at nose) ─────────────────
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    // Draw a trapezoid: rear is wide, front is narrow
    ctx.moveTo(-16, -10); // rear-left
    ctx.lineTo(-16,  10); // rear-right
    ctx.lineTo( 16,   6); // front-right (narrower)
    ctx.lineTo( 16,  -6); // front-left  (narrower)
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Body outline
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, -10);
    ctx.lineTo(-16,  10);
    ctx.lineTo( 16,   6);
    ctx.lineTo( 16,  -6);
    ctx.closePath();
    ctx.stroke();

    // Wide kart front bumper
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(14, -12, 5, 24, 2);
    ctx.fill();

    // Rear wing bar
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(-18, -11, 4, 22, 1);
    ctx.fill();

    // ── Cockpit / Helmet ─────────────────────────────────────────────────────
    ctx.fillStyle = '#111';
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(2, 0, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // ── Brake Lights ─────────────────────────────────────────────────────────
    if (p.gas === -1) {
      ctx.fillStyle = '#ff2222';
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(-17, -7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-17,  7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 18;
      ctx.shadowColor = p.color;
    }

    // ── Drafting Visuals ──────────────────────────────────────────────────────
    if (p.isDrafting && p.gas === 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let sl=0; sl<3; sl++) {
        const lx = 14 + Math.random() * 8;
        const ly = -8 + sl * 8 + (Math.random() - 0.5) * 4;
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - 20 - Math.random() * 15, ly);
      }
      ctx.stroke();
    }

    // ── Exhaust Thrust ────────────────────────────────────────────────────────
    if (p.gas === 1) {
      ctx.strokeStyle = p.isDrafting ? '#00ffff' : '#ff7700';
      ctx.shadowColor = p.isDrafting ? '#00ffff' : '#ff7700';
      ctx.shadowBlur = 15;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-16, -5);
      ctx.lineTo(-16 - 7 - Math.random() * 9, -5 + (Math.random() - 0.5) * 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-16,  5);
      ctx.lineTo(-16 - 7 - Math.random() * 9,  5 + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }

    ctx.restore();

    // Non-rotating driver nametag above kart
    ctx.fillStyle = p.color;
    ctx.font = '10px "Press Start 2P", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 5;
    ctx.shadowColor = p.color;
    ctx.fillText(p.name, p.x, p.y - 28);

    // Draft boost multiplier is handled computationally without visual text explicitly
    ctx.shadowBlur = 0;
  });
}

function drawTrack() {
  // Use the smooth Catmull-Rom splined points for all stroke rendering —
  // this MUST match what getTrackInfo() uses for physics, otherwise the
  // visual track and physics boundary are misaligned in corners.
  const points = getWaypoints();
  if (!points || points.length === 0) return;

  // Completely isolate track canvas state from kart/HUD rendering.
  // Without this, dirty globalAlpha, shadowBlur, lineWidth from kart drawing
  // bleeds into track stroke calls and causes visual corruption with 2+ karts.
  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // ── Track Path Generation ──────────────────────────────────────────────────
  // One single path used for all 7 stacked stroke layers below
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();

  // ── Layer 1: Grass Base (Shadow Removed for Performance) ──────────────────
  ctx.strokeStyle = '#2d5a27';
  ctx.lineWidth = 140; // slightly wider as track boundary
  ctx.stroke();

  // ── Layer 2: Painted White Track Edges ────────────────────────────────────
  // Drawn just slightly wider than the asphalt to create a crisp 2px solid border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 100;
  ctx.stroke();

  // ── Layer 3: Asphalt Base ─────────────────────────────────────────────────
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 96;
  ctx.stroke();


  // ── Layer 5: Checkered Start/Finish line ─────────────────────────────────
  const p0 = points[0];
  const p1 = points[1];
  const sfDx = p1.x - p0.x, sfDy = p1.y - p0.y;
  const sfDist = Math.hypot(sfDx, sfDy);
  const sfNx = -sfDy / sfDist, sfNy = sfDx / sfDist; // perpendicular
  const sfFx =  sfDx / sfDist, sfFy = sfDy / sfDist; // forward

  const BOX = 10; // checker square size
  const BOXES = 8; // boxes across the track width
  const half = (BOXES / 2) * BOX;

  ctx.shadowBlur = 0;
  for (let col = 0; col < BOXES; col++) {
    for (let row = 0; row < 2; row++) {
      const isWhite = (col + row) % 2 === 0;
      const offN = (col - BOXES / 2) * BOX + BOX / 2;
      const offF = (row - 1) * BOX + BOX / 2;
      const cx = p0.x + sfNx * offN + sfFx * offF;
      const cy = p0.y + sfNy * offN + sfFy * offF;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(sfDy, sfDx));
      ctx.fillStyle = isWhite ? '#ffffff' : '#111111';
      ctx.fillRect(-BOX / 2, -BOX / 2, BOX, BOX);
      ctx.restore();
    }
  }
  ctx.restore(); // End of drawTrack canvas state isolation
}

function formatTime(ms) {
  if (ms <= 0) return '0:00';
  const totalSecs = Math.ceil(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatLapTime(ms) {
  if (!isFinite(ms) || ms === Infinity) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ms3 = ms % 1000;
  return `${m}:${s.toString().padStart(2, '0')}.${ms3.toString().padStart(3, '0')}`;
}

function drawBroadcastHUD() {
  const now = Date.now();
  const remaining = Math.max(0, sessionEndsAt - now);
  const isQual = gameState === 'qualifying';

  // --- Timer Banner ---
  const label = isQual ? 'QUALIFYING' : 'RACE';
  const timerColor = isQual ? '#00ffdd' : '#FF0055';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowBlur = 15;
  ctx.shadowColor = timerColor;
  ctx.fillStyle = timerColor;
  ctx.font = '22px "Press Start 2P", monospace';
  ctx.fillText(label, canvas.width / 2, 36);
  ctx.font = '48px "Press Start 2P", monospace';
  ctx.fillText(formatTime(remaining), canvas.width / 2, 85);
  ctx.restore();

  // --- Live Leaderboard ---
  const sorted = Object.entries(players)
    .sort(([, a], [, b]) => {
      if (a.fastestLap === Infinity && b.fastestLap === Infinity) return 0;
      if (a.fastestLap === Infinity) return 1;
      if (b.fastestLap === Infinity) return -1;
      return a.fastestLap - b.fastestLap;
    });

  const boxW = 260, boxH = 30;
  const lx = 20, ly = 20;
  sorted.forEach(([, p], i) => {
    const bx = lx;
    const by = ly + i * (boxH + 6);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 6);
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`P${i+1} ${p.name.slice(0,8)}`, bx + 8, by + 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(formatLapTime(p.fastestLap), bx + boxW - 8, by + 20);
    ctx.restore();
  });
}

function doGridTransition() {
  // Sort all players fastest-to-slowest for the grid
  const sortedArr = Object.entries(players).sort(([, a], [, b]) => {
    if (a.fastestLap === Infinity && b.fastestLap === Infinity) return 0;
    if (a.fastestLap === Infinity) return 1;
    if (b.fastestLap === Infinity) return -1;
    return a.fastestLap - b.fastestLap;
  });
  const sortedKeys = sortedArr.map(([k]) => k);
  // Freeze velocities
  Object.values(players).forEach(p => { p.vx = 0; p.vy = 0; p.gas = 0; p.steer = 0; });
  alignStartingGrid(sortedKeys);
  // Reset lap timers for the race
  Object.values(players).forEach(p => {
    p.fastestLap = Infinity;
    p.lapsCompleted = 0;
    p.lastLapMark = Date.now();
    p.targetWaypoint = 0;
  });
}

function drawGridWaitScreen() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '30px "Press Start 2P", monospace';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#FF0055';
  ctx.fillStyle = '#FF0055';
  ctx.fillText('QUALIFYING COMPLETE!', canvas.width / 2, canvas.height / 2 - 40);
  ctx.font = '20px "Press Start 2P", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('GRID LOCKED • RACE STARTING SOON', canvas.width / 2, canvas.height / 2 + 10);
  ctx.restore();
}

function drawPostRaceScreen() {
  ctx.save();
  ctx.textAlign = 'center';
  const sorted = Object.entries(players)
    .sort(([, a], [, b]) => {
      if (a.fastestLap === Infinity && b.fastestLap === Infinity) return 0;
      if (a.fastestLap === Infinity) return 1;
      if (b.fastestLap === Infinity) return -1;
      return a.fastestLap - b.fastestLap;
    });

  ctx.font = '30px "Press Start 2P", monospace';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#FFFF00';
  ctx.fillStyle = '#FFFF00';
  ctx.fillText('RACE OVER!', canvas.width / 2, 70);
  ctx.shadowBlur = 0;

  sorted.forEach(([, p], i) => {
    const y = 130 + i * 45;
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.fillStyle = p.color;
    ctx.textAlign = 'left';
    ctx.fillText(`P${i+1} ${p.name}`, canvas.width / 2 - 200, y);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`BEST: ${formatLapTime(p.fastestLap)}`, canvas.width / 2 + 200, y);
  });
  ctx.restore();
}

let gridTransitionDone = false;

function loop() {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawTrack();

  const now = Date.now();

  if (gameState === 'qualifying') {
    updatePhysics();
    drawBroadcastHUD();

    if (now >= sessionEndsAt) {
      gameState = 'grid_walk';
      gridTransitionDone = false;
      doGridTransition();
      // After 5 seconds, begin the race
      setTimeout(() => {
        gameState = 'racing';
        sessionEndsAt = Date.now() + (4 * 60 * 1000);
      }, 5000);
    }

  } else if (gameState === 'grid_walk') {
    drawGridWaitScreen();

  } else if (gameState === 'racing') {
    updatePhysics();
    drawBroadcastHUD();

    // Broadcast Speed Telemetry
    const speedsDist = {};
    Object.keys(players).forEach(id => {
      if (!players[id].isBot) {
        let v = Math.hypot(players[id].vx, players[id].vy);
        speedsDist[id] = Math.round(v * 52);
      }
    });
    if (Object.keys(speedsDist).length > 0) {
      socket.emit('hostTelemetry', speedsDist);
    }

    if (now >= sessionEndsAt) {
      gameState = 'post_race';
    }

  } else if (gameState === 'post_race') {
    drawPostRaceScreen();

  } else {
    // Lobby / Waiting
    ctx.fillStyle = '#fff';
    ctx.font = '24px "Press Start 2P", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.fillText(lobbyText, canvas.width/2, canvas.height - 40);
    ctx.shadowBlur = 0;

    // Draw Global Leaderboard for the track
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff0055';
    ctx.font = '20px "Press Start 2P", Courier, monospace';
    ctx.fillText('GLOBAL TOP 10', 40, 60);
    ctx.font = '12px "Press Start 2P", Courier, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`TRACK: ${currentSettings.track.toUpperCase()}`, 40, 90);
    
    if (topLeaderboard.length > 0) {
      topLeaderboard.forEach((lap, idx) => {
        const rowY = 130 + idx * 30;
        ctx.fillStyle = idx === 0 ? '#00ffff' : '#aaa'; // Highlight #1
        ctx.fillText(`${(idx + 1).toString().padStart(2, '0')}. ${lap.name}`, 40, rowY);
        ctx.fillText(formatLapTime(lap.time), 220, rowY);
      });
    } else {
      ctx.fillStyle = '#666';
      ctx.fillText('NO RACE RECORDS YET', 40, 130);
    }
  }

  drawCars();

    

  requestAnimationFrame(loop);
}


loop();
