const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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
      players: {}
    };

    socket.emit('roomCreated', roomCode);
    console.log(`Host created room ${roomCode}`);
  });

  socket.on('controllerJoin', (roomCode) => {
    roomCode = roomCode.toUpperCase();
    if (rooms[roomCode]) {
      const room = rooms[roomCode];
      
      const playerCount = Object.keys(room.players).length;
      if (playerCount >= 8) {
        socket.emit('joinError', 'Room is full (max 8 players)');
        return;
      }

      socket.join(roomCode);
      const color = PLAYER_COLORS[playerCount];
      
      room.players[socket.id] = { color: color };
      
      socket.emit('joinSuccess', color);
      
      // Notify host that a player joined
      io.to(room.hostId).emit('playerJoined', {
        id: socket.id,
        color: color
      });

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
        io.to(room.hostId).emit('playerLeft', socket.id);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
