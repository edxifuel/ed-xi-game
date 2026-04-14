const socket = io();

const joinScreen = document.getElementById('join-screen');
const gamepadScreen = document.getElementById('gamepad-screen');
const roomCodeInput = document.getElementById('room-code-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');
const playerColorBox = document.getElementById('player-color-box');
const gasIndicator = document.getElementById('gas-indicator');
const connectionStatus = document.getElementById('connection-status');

let currentRoomCode = '';
let myColor = '';
let isConnected = false;

// Controller State
let padSteer = 0;
let padGas = 0;

// Auto-fill code from URL if present
const urlParams = new URLSearchParams(window.location.search);
const codeParam = urlParams.get('code');
if (codeParam) {
  roomCodeInput.value = codeParam.toUpperCase();
}

// JOIN LOGIC
joinBtn.addEventListener('click', async () => {
  const code = roomCodeInput.value.toUpperCase();
  if (code.length !== 4) {
    errorMsg.innerText = 'ENTER 4 LETTER CODE';
    return;
  }

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

  // Once permission is granted, request join via socket
  socket.emit('controllerJoin', code);
  currentRoomCode = code;
});

socket.on('joinSuccess', (color) => {
  isConnected = true;
  myColor = color;
  
  // Transition UI
  joinScreen.classList.remove('active');
  gamepadScreen.classList.add('active');
  
  playerColorBox.style.color = color;
  playerColorBox.style.backgroundColor = color;
  playerColorBox.style.boxShadow = `0 0 15px ${color}`;

  // Start reading sensors
  window.addEventListener('deviceorientation', handleOrientation);
  
  // Start Input Loop
  setInterval(sendInput, 1000 / 20); // 20 FPS updates
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

// INPUT CAPTURE

// Touch for Gas (anywhere on screen)
document.addEventListener('touchstart', (e) => {
  if (!isConnected) return;
  e.preventDefault(); // prevents pull-to-refresh
  padGas = 1;
  gasIndicator.classList.add('active');
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  if (e.touches.length === 0) {
    padGas = 0;
    gasIndicator.classList.remove('active');
  }
}, { passive: false });

// Support mouse click for desktop testing
document.addEventListener('mousedown', (e) => {
  if (!isConnected) return;
  padGas = 1;
  gasIndicator.classList.add('active');
});

document.addEventListener('mouseup', (e) => {
  if (!isConnected) return;
  padGas = 0;
  gasIndicator.classList.remove('active');
});

// Tilt for Steering
function handleOrientation(event) {
  if (!isConnected) return;
  
  let gamma = event.gamma; // In degree in the range [-90,90]
  
  // Handle edge case if device is upside down (beta > 90 or beta < -90)
  // Assume simple portrait/landscape steering wheel logic for now
  
  // Clamp gamma to [-45, 45] for max steering
  if (gamma > 45) gamma = 45;
  if (gamma < -45) gamma = -45;
  
  // Normalize to [-1, 1]
  padSteer = gamma / 45;
}

// Fallback keyboard support for quick desktop testing
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') padSteer = -1;
  if (e.key === 'ArrowRight' || e.key === 'd') padSteer = 1;
  if (e.key === 'ArrowUp' || e.key === 'w') {
    padGas = 1;
    gasIndicator.classList.add('active');
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ArrowRight' || e.key === 'd') padSteer = 0;
  if (e.key === 'ArrowUp' || e.key === 'w') {
    padGas = 0;
    gasIndicator.classList.remove('active');
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
