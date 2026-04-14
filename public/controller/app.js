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
let padGas = 0;

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
  
  window.addEventListener('deviceorientation', handleOrientation);
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

// INPUT CAPTURE

// Gas Pedal
gasPedal.addEventListener('touchstart', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  padGas = 1;
  gasPedal.classList.add('active');
}, { passive: false });

gasPedal.addEventListener('touchend', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  padGas = 0;
  gasPedal.classList.remove('active');
}, { passive: false });

gasPedal.addEventListener('mousedown', (e) => {
  if (!isConnected) return;
  padGas = 1;
  gasPedal.classList.add('active');
});

gasPedal.addEventListener('mouseup', (e) => {
  padGas = 0;
  gasPedal.classList.remove('active');
});

// Brake Pedal
brakePedal.addEventListener('touchstart', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  padGas = -1;
  brakePedal.classList.add('active');
}, { passive: false });

brakePedal.addEventListener('touchend', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  padGas = 0;
  brakePedal.classList.remove('active');
}, { passive: false });

brakePedal.addEventListener('mousedown', (e) => {
  if (!isConnected) return;
  padGas = -1;
  brakePedal.classList.add('active');
});

brakePedal.addEventListener('mouseup', (e) => {
  padGas = 0;
  brakePedal.classList.remove('active');
});

// Tilt for Steering
let steerOffset = 0;       // calibration zero-point (set on first touch)
let calibrated = false;
let smoothedSteer = 0;     // low-pass filtered steer value

function handleOrientation(event) {
  if (!isConnected) return;

  // gamma = left/right tilt of the phone = correct axis for steering in landscape
  // It ranges -90 (full left) to +90 (full right).
  // landscape-secondary (upside-down landscape) flips the sign.
  let rawGamma = event.gamma ?? 0;

  const orientType = (screen.orientation || {}).type || '';
  if (orientType === 'landscape-secondary') {
    rawGamma = -rawGamma;
  }

  // Auto-calibrate on first reading so the kart goes straight at the player's
  // natural resting hold angle.
  if (!calibrated) {
    steerOffset = rawGamma;
    calibrated = true;
  }

  const tilt = rawGamma - steerOffset;

  // Dead zone: ignore tiny wobble within ±4 degrees
  const DEAD_ZONE = 4;
  const STEER_RANGE = 35; // degrees of tilt for full lock

  let raw = 0;
  if (Math.abs(tilt) > DEAD_ZONE) {
    raw = (tilt - Math.sign(tilt) * DEAD_ZONE) / STEER_RANGE;
    raw = Math.max(-1, Math.min(1, raw)); // clamp to [-1, 1]
  }

  // Low-pass filter: smooths jitter without adding lag
  smoothedSteer = smoothedSteer * 0.6 + raw * 0.4;
  padSteer = smoothedSteer;

  // Animate Steering Wheel
  const wheel = document.getElementById('steering-wheel');
  if (wheel) {
    wheel.style.transform = `rotate(${padSteer * 120}deg)`;
  }
}

// Re-calibrate when the player taps the screen to set neutral
document.addEventListener('touchstart', () => {
  calibrated = false;
}, { once: false, passive: true });

// Fallback keyboard support for quick desktop testing
document.addEventListener('keydown', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') padSteer = -1;
  if (e.key === 'ArrowRight' || e.key === 'd') padSteer = 1;
  if (e.key === 'ArrowUp' || e.key === 'w') {
    padGas = 1;
    gasPedal.classList.add('active');
  }
  if (e.key === 'ArrowDown' || e.key === 's') {
    padGas = -1;
    brakePedal.classList.add('active');
  }
});

document.addEventListener('keyup', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ArrowRight' || e.key === 'd') padSteer = 0;
  if (e.key === 'ArrowUp' || e.key === 'w') {
    padGas = 0;
    gasPedal.classList.remove('active');
  }
  if (e.key === 'ArrowDown' || e.key === 's') {
    padGas = 0;
    brakePedal.classList.remove('active');
  }
});

function sendInput() {
  if (!isConnected) return;
  // Send extremely crisp standard payload
  // Format: "ROOM,steer,gas"
  // Steer truncated to 2 decimals
  const payload = `${currentRoomCode},${padSteer.toFixed(2)},${padGas}`;
  socket.emit('inputUpdate', payload);
}
