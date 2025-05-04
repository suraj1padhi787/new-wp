
module.exports = function setupOnlineTracking(io) {
  const onlineUsers = new Map();

  io.on('connection', (socket) => {
    socket.on('register', ({ username }) => {
      try {
        if (username) {
          onlineUsers.set(username, socket.id);
          io.emit('userOnline', username);
          console.log(`✅ ${username} is now online`);
        } else {
          console.warn('Register event received without username');
        }
      } catch (error) {
        console.error('Error in register event:', error);
      }
    });

    socket.on('checkOnline', (username) => {
      try {
        if (onlineUsers.has(username)) {
          socket.emit('userIsOnline', username);
        } else {
          const lastSeen = onlineUsers.get(`${username}_lastSeen`) || 'recently';
          socket.emit('userIsOffline', { username, lastSeen });
        }
      } catch (error) {
        console.error('Error in checkOnline event:', error);
      }
    });

    socket.on('checkOnlineStatus', (username) => {
      try {
        if (onlineUsers.has(username)) {
          socket.emit('userIsOnline', username);
        } else {
          const lastSeen = onlineUsers.get(`${username}_lastSeen`) || 'recently';
          socket.emit('userIsOffline', { username, lastSeen });
        }
      } catch (error) {
        console.error('Error in checkOnlineStatus event:', error);
      }
    });

    socket.on('manualDisconnect', () => {
      disconnectUser(socket);
    });

    socket.on('disconnect', () => {
      disconnectUser(socket);
    });

    function disconnectUser(socket) {
      try {
        for (let [username, socketId] of onlineUsers.entries()) {
          if (socketId === socket.id) {
            onlineUsers.delete(username);
            const lastSeen = new Date().toLocaleString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            });
            onlineUsers.set(`${username}_lastSeen`, lastSeen);
            io.emit('userOffline', { username, lastSeen });
            console.log(`❌ ${username} disconnected`);
            break;
          }
        }
      } catch (error) {
        console.error('Error in disconnect event:', error);
      }
    }
  });
};
