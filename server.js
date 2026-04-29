const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {}; // Store room state if needed

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const PLAYER_COLORS = [
  '#FF0055', '#00FFDD', '#FFFF00', '#FF00FF', 
  '#00FF00', '#FFA500', '#0000FF', '#FFFFFF'
];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('hostCreate', () => {
    const roomCode = generateRoomCode();
    socket.join(roomCode);
    
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      status: 'lobby',
      vipId: null,
      settings: {
        track: 'vika_short',
        racers: 2
      }
    };

    socket.emit('roomCreated', roomCode);
    console.log(`Host created room ${roomCode}`);
  });

  socket.on('controllerJoin', (payload) => {
    const roomCode = (typeof payload === 'string' ? payload : payload.code).toUpperCase();
    const driverName = (typeof payload === 'string' ? 'RACER' : payload.name);

    if (rooms[roomCode]) {
      const room = rooms[roomCode];
      
      const playerCount = Object.keys(room.players).length;
      if (playerCount >= 8) {
        socket.emit('joinError', 'Room is full (max 8 players)');
        return;
      }

      const isVip = (playerCount === 0);
      if (isVip) room.vipId = socket.id;

      socket.join(roomCode);
      const color = PLAYER_COLORS[playerCount];
      
      room.players[socket.id] = { color: color, isVip: isVip, name: driverName };
      
      socket.emit('joinSuccess', { color: color, isVip: isVip });
      
      // Notify host that a player joined
      io.to(room.hostId).emit('playerJoined', {
        id: socket.id,
        color: color,
        isVip: isVip,
        name: driverName
      });

      // Update TV Lobby status if waiting for players
      if (room.status === 'waiting_players') {
        io.to(room.hostId).emit('lobbyStatus', {
           target: room.settings.racers, 
           current: Object.keys(room.players).length 
        });
      }

      // Start the race if rules are met
      if (room.status === 'waiting_players' && Object.keys(room.players).length === room.settings.racers) {
        room.status = 'racing';
        io.to(roomCode).emit('raceStart', room.settings);
      } else if (room.status === 'racing' || room.status === 'qualifying') {
        // If a player disconnected and silently reconnected, jump them straight back in!
        socket.emit('raceStart', room.settings);
      }

      console.log(`Controller joined room ${roomCode} as ${color}`);
    } else {
      socket.emit('joinError', 'Invalid Room Code');
    }
  });

  socket.on('inputUpdate', (data) => {
    // data is expected to be a string like "roomCode,steer,gas"
    const parts = data.split(',');
    if (parts.length === 3) {
      const roomCode = parts[0];
      const steer = parseFloat(parts[1]);
      const gas = parseFloat(parts[2]);
      
      if (rooms[roomCode]) {
        // Send directly to host
        io.to(rooms[roomCode].hostId).emit('playerInput', {
          id: socket.id,
          steer: steer,
          gas: gas
        });
      }
    }
  });

  socket.on('hostTelemetry', (speedsDist) => {
    Object.keys(speedsDist).forEach(playerId => {
      io.to(playerId).emit('telemetry', speedsDist[playerId]);
    });
  });

  socket.on('updateSettings', (data) => {
    const room = rooms[data.roomCode];
    if (room && room.vipId === socket.id && room.status === 'lobby') {
      room.settings.track = data.track;
      room.settings.racers = parseInt(data.racers, 10);
      io.to(room.hostId).emit('settingsUpdated', room.settings);
    }
  });

  socket.on('confirmSettings', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.vipId === socket.id && room.status === 'lobby') {
      room.status = 'waiting_players';
      
      io.to(room.hostId).emit('lobbyStatus', {
         target: room.settings.racers, 
         current: Object.keys(room.players).length 
      });
      
      // Attempt auto-start if quota is already met
      if (Object.keys(room.players).length === room.settings.racers) {
        room.status = 'racing';
        io.to(roomCode).emit('raceStart', room.settings);
      } else {
        io.to(roomCode).emit('waitingForPlayers', room.settings);
      }
    }
  });

  socket.on('forceStart', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.vipId === socket.id && room.status === 'waiting_players') {
      room.status = 'racing';
      io.to(roomCode).emit('raceStart', room.settings);
    }
  });

  socket.on('disconnect', () => {
    // Check if this was a player in any room
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (room.hostId === socket.id) {
        // Host disconnected
        io.to(roomCode).emit('hostDisconnected');
        delete rooms[roomCode];
      } else if (room.players[socket.id]) {
        // Player disconnected
        delete room.players[socket.id];
        
        // Ensure VIP migration is not needed right now (for simplicity, if VIP leaves, room crashes or we just let it be)
        if (room.vipId === socket.id) room.vipId = null;

        io.to(room.hostId).emit('playerLeft', socket.id);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`🏁 RETRO VELOCITY SERVER ONLINE 🏁`);
  console.log(`=========================================`);
  console.log(`Local Access:  http://localhost:${PORT}`);
  
  // Find local network IP to display for mobile QR code testing
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Network (QR):  http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`=========================================\n`);
});
