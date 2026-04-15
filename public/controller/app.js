const socket = io();

const joinScreen = document.getElementById('join-screen');
const gamepadScreen = document.getElementById('gamepad-screen');
const roomCodeInput = document.getElementById('room-code-input');
const roomCodeWrapper = document.getElementById('room-code-wrapper');
const driverNameInput = document.getElementById('driver-name-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');
const playerColorBox = document.getElementById('player-color-box');
const connectionStatus = document.getElementById('connection-status');
const gasPedal = document.getElementById('gas-pedal');
const brakePedal = document.getElementById('brake-pedal');
const vipScreen = document.getElementById('vip-screen');
const waitScreen = document.getElementById('wait-screen');
const trackSelect = document.getElementById('track-select');
const racerSelect = document.getElementById('racer-select');
const confirmBtn = document.getElementById('confirm-btn');

let currentRoomCode = '';
let myColor = '';
let isConnected = false;

// Controller State
let padSteer = 0;
let padGas = 1; // Auto-gas by default

// Load Driver Name from LocalStorage
const savedName = localStorage.getItem('edxi_driver_name');
if (savedName) {
  driverNameInput.value = savedName;
}

// Check for direct-join URL
const urlParams = new URLSearchParams(window.location.search);
const codeParam = urlParams.get('code');
if (codeParam) {
  currentRoomCode = codeParam.toUpperCase();
  roomCodeWrapper.style.display = 'none';
}

// JOIN LOGIC
joinBtn.addEventListener('click', async () => {
  let code = currentRoomCode;
  
  if (!code) {
    code = roomCodeInput.value.toUpperCase();
    if (code.length !== 4) {
      errorMsg.innerText = 'ENTER 4 LETTER CODE';
      return;
    }
  }

  const driverName = driverNameInput.value.trim().toUpperCase() || 'RACER';
  localStorage.setItem('edxi_driver_name', driverName);

  // Request Device Orientation Permissions (iOS 13+ requirement)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState !== 'granted') {
        errorMsg.innerText = 'SENSOR ACCESS DENIED';
        return;
      }
    } catch (e) {
      console.error(e);
      // Might not be in secure context (HTTPS/localhost required)
    }
  }

  // Send the payload to join
  socket.emit('controllerJoin', { code: code, name: driverName });
  currentRoomCode = code;
});

socket.on('joinSuccess', (data) => {
  isConnected = true;
  myColor = data.color;
  
  // Transition UI
  joinScreen.classList.remove('active');
  playerColorBox.style.color = myColor;
  playerColorBox.style.backgroundColor = myColor;
  playerColorBox.style.boxShadow = `0 0 15px ${myColor}`;

  if (data.isVip) {
    vipScreen.classList.add('active');
    
    trackSelect.addEventListener('change', sendSettingsUpdate);
    racerSelect.addEventListener('change', sendSettingsUpdate);
    
    confirmBtn.addEventListener('click', () => {
      socket.emit('confirmSettings', currentRoomCode);
      vipScreen.classList.remove('active');
      waitScreen.classList.add('active');
      
      const forceStartBtn = document.getElementById('force-start-btn');
      if (forceStartBtn) {
        forceStartBtn.style.display = 'inline-block';
        forceStartBtn.addEventListener('click', () => {
          socket.emit('forceStart', currentRoomCode);
        });
      }
    });
  } else {
    waitScreen.classList.add('active');
  }
});

function sendSettingsUpdate() {
  socket.emit('updateSettings', {
    roomCode: currentRoomCode,
    track: trackSelect.value,
    racers: racerSelect.value
  });
}

socket.on('waitingForPlayers', (settings) => {
  if (waitScreen.classList.contains('active')) {
    const waitMsg = document.getElementById('wait-msg');
    if (waitMsg) {
      waitMsg.innerHTML = `<h2>WAITING...</h2><p style="color: #aaa; text-align: center; margin-top: 20px;">WAITING FOR ${settings.racers} RACERS...</p>`;
    }
  }
});

socket.on('raceStart', (settings) => {
  vipScreen.classList.remove('active');
  waitScreen.classList.remove('active');
  gamepadScreen.classList.add('active');
  
  setInterval(sendInput, 1000 / 20); 
});

socket.on('joinError', (msg) => {
  errorMsg.innerText = msg;
});

socket.on('hostDisconnected', () => {
  isConnected = false;
  connectionStatus.innerText = 'HOST LOST';
  connectionStatus.style.color = 'red';
  setTimeout(() => {
    window.location.reload();
  }, 2000);
});

socket.on('telemetry', (speed) => {
  const speedEl = document.getElementById('speed-val');
  if (speedEl) {
    speedEl.innerText = speed.toString().padStart(3, '0');
  }
});

// INPUT CAPTURE (Touch to Steer)

let touchesLeft = 0;
let touchesRight = 0;

const leftZone = document.getElementById('left-zone');
const rightZone = document.getElementById('right-zone');

function updateController() {
  if (!isConnected) return;

  if (touchesLeft > 0 && touchesRight > 0) {
    // Both sides touched = Brake
    padSteer = 0;
    padGas = -1;
  } else if (touchesLeft > 0) {
    // Steer Left
    padSteer = -1;
    padGas = 1; // Auto-gas
  } else if (touchesRight > 0) {
    // Steer Right
    padSteer = 1;
    padGas = 1; // Auto-gas
  } else {
    // Neither touched = Straight ahead, auto-gas
    padSteer = 0;
    padGas = 1;
  }

  // Animate Steering Wheel
  const wheel = document.getElementById('steering-wheel');
  if (wheel) {
    wheel.style.transform = `rotate(${padSteer * 90}deg)`;
  }
}

function handleTouchStart(e, isLeft) {
  if (!isConnected) return;
  e.preventDefault();
  if (isLeft) touchesLeft++;
  else touchesRight++;
  updateController();
}

function handleTouchEnd(e, isLeft) {
  if (!isConnected) return;
  e.preventDefault();
  if (isLeft) touchesLeft = Math.max(0, touchesLeft - 1);
  else touchesRight = Math.max(0, touchesRight - 1);
  updateController();
}

leftZone.addEventListener('touchstart', (e) => handleTouchStart(e, true), { passive: false });
leftZone.addEventListener('touchend', (e) => handleTouchEnd(e, true), { passive: false });
leftZone.addEventListener('touchcancel', (e) => handleTouchEnd(e, true), { passive: false });

rightZone.addEventListener('touchstart', (e) => handleTouchStart(e, false), { passive: false });
rightZone.addEventListener('touchend', (e) => handleTouchEnd(e, false), { passive: false });
rightZone.addEventListener('touchcancel', (e) => handleTouchEnd(e, false), { passive: false });

// Fallback keyboard support for quick desktop testing
document.addEventListener('keydown', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') touchesLeft = 1;
  if (e.key === 'ArrowRight' || e.key === 'd') touchesRight = 1;
  if (e.key === 'ArrowDown' || e.key === 's') { touchesLeft = 1; touchesRight = 1; }
  updateController();
});

document.addEventListener('keyup', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') touchesLeft = 0;
  if (e.key === 'ArrowRight' || e.key === 'd') touchesRight = 0;
  if (e.key === 'ArrowDown' || e.key === 's') { touchesLeft = 0; touchesRight = 0; }
  updateController();
});

function sendInput() {
  if (!isConnected) return;
  // Send extremely crisp standard payload
  // Format: "ROOM,steer,gas"
  // Steer truncated to 2 decimals
  const payload = `${currentRoomCode},${padSteer.toFixed(2)},${padGas}`;
  socket.emit('inputUpdate', payload);
}
