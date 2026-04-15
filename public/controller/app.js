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
let padGas = 0; // 0 = Coast, 1 = Gas, -1 = Brake

// Load Driver Name from LocalStorage
const savedName = localStorage.getItem('edxi_driver_name');
if (savedName) {
  driverNameInput.value = savedName;
}

// Check for direct-join URL
const urlParams = new URLSearchParams(window.location.search);
let codeParam = urlParams.get('code');

// Fallback just in case Railway trims query parameters or it is placed in the hash
if (!codeParam) {
    const urlMatches = window.location.href.match(/code=([A-Za-z0-9]{4})/i);
    if (urlMatches) {
        codeParam = urlMatches[1];
    }
}

if (codeParam) {
  currentRoomCode = codeParam.toUpperCase();
  roomCodeWrapper.style.display = 'none';
  
  // We no longer auto-join on Android. We force ALL devices to tap the join button manually.
  // This ensures the "Driver Name" input field remains fully accessible before connecting,
  // while also satisfying iOS's strict requirement for a physical tap to enable gyroscope data.
  joinBtn.innerText = `JOIN ${currentRoomCode}`;
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

// INPUT CAPTURE (Gyro to Steer, Touch to Brake)

let baseTilt = null;
let isCalibrated = false;
let currentTilt = 0;

// Call this when the player presses "Start" or taps the screen for the first time
function calibrateGyro(tiltVal) {
    baseTilt = tiltVal;
    isCalibrated = true;
    const errorMsg = document.getElementById('error-msg');
    if (errorMsg) errorMsg.innerText = 'CALIBRATED';
}

// Re-calibrate whenever they hold both pedals to reset their center
function handleReCenter() {
    baseTilt = currentTilt;
}

window.addEventListener('deviceorientation', (e) => {
    let rawBeta = e.beta || 90;

    // Compensate for phone being flipped the other way in landscape
    const orientType = (screen.orientation || {}).type || '';
    if (orientType === 'landscape-secondary') {
        rawBeta = -rawBeta;
    }

    currentTilt = rawBeta;
    
    if (!isCalibrated) return; // Wait until they explicitly tap a pedal

    // Subtract resting position
    let rawSteer = currentTilt - baseTilt;

    // Fix wrap-around if device crosses the 180/-180 boundary
    if (rawSteer > 180) rawSteer -= 360;
    if (rawSteer < -180) rawSteer += 360;

    // Hard clamp to prevent flips
    if (rawSteer > 90) rawSteer = 90;
    if (rawSteer < -90) rawSteer = -90;

    // Send the raw degree difference to the TV
    padSteer = rawSteer;

    // Animate Steering Wheel visually
    const wheel = document.getElementById('steering-wheel');
    if (wheel) {
        let visualRot = Math.max(-90, Math.min(90, rawSteer * 1.5));
        wheel.style.transform = `rotate(${visualRot}deg)`;
    }
});

let isGasPressed = false;
let isBrakePressed = false;

function updateController() {
  if (!isConnected) return;

  if (isBrakePressed) {
    padGas = -1;
  } else if (isGasPressed) {
    padGas = 1;
  } else {
    padGas = 0; // Coast
  }

  if (isBrakePressed && isGasPressed) {
    handleReCenter(); // Recenter steering if holding both pedals
  }
}

function handleGasStart(e) { 
  if (!isConnected) return;
  e.preventDefault(); 
  if (!isCalibrated) calibrateGyro(currentTilt); 
  isGasPressed = true; 
  if(gasPedal) gasPedal.classList.add('active');
  updateController(); 
}
function handleGasEnd(e) { 
  if(!isConnected) return; 
  e.preventDefault(); 
  isGasPressed = false; 
  if(gasPedal) gasPedal.classList.remove('active');
  updateController(); 
}

function handleBrakeStart(e) { 
  if (!isConnected) return;
  e.preventDefault(); 
  if (!isCalibrated) calibrateGyro(currentTilt); 
  isBrakePressed = true; 
  if(brakePedal) brakePedal.classList.add('active');
  updateController(); 
}
function handleBrakeEnd(e) { 
  if(!isConnected) return; 
  e.preventDefault(); 
  isBrakePressed = false; 
  if(brakePedal) brakePedal.classList.remove('active');
  updateController(); 
}

if (gasPedal) {
  gasPedal.addEventListener('touchstart', handleGasStart, { passive: false });
  gasPedal.addEventListener('touchend', handleGasEnd, { passive: false });
  gasPedal.addEventListener('touchcancel', handleGasEnd, { passive: false });
}

if (brakePedal) {
  brakePedal.addEventListener('touchstart', handleBrakeStart, { passive: false });
  brakePedal.addEventListener('touchend', handleBrakeEnd, { passive: false });
  brakePedal.addEventListener('touchcancel', handleBrakeEnd, { passive: false });
}

// Fallback keyboard support for quick desktop testing
document.addEventListener('keydown', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') padSteer = -40; // Max Lock
  if (e.key === 'ArrowRight' || e.key === 'd') padSteer = 40;
  if (e.key === 'ArrowUp' || e.key === 'w') isGasPressed = true;
  if (e.key === 'ArrowDown' || e.key === 's') isBrakePressed = true;
  updateController();
});

document.addEventListener('keyup', (e) => {
  if (!isConnected) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') padSteer = 0;
  if (e.key === 'ArrowRight' || e.key === 'd') padSteer = 0;
  if (e.key === 'ArrowUp' || e.key === 'w') isGasPressed = false;
  if (e.key === 'ArrowDown' || e.key === 's') isBrakePressed = false;
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
