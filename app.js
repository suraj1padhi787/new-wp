
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketio = require('socket.io');
const morgan = require('morgan');
const db = require('./db');
const setupOnlineTracking = require('./online');
const webPush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = socketio(server);
setupOnlineTracking(io);

// VAPID keys
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};

// Setup web-push with VAPID keys
webPush.setVapidDetails(
  'mailto:example@yourdomain.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Store push subscriptions (in-memory for now, use a database in production)
const subscriptions = new Map();

// Create directories if they don't exist
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'public', 'uploads', 'stickers');
if (!fs.existsSync(uploadsDir)) {
  console.log('Creating uploads directory:', uploadsDir);
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const dbDir = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');
if (!fs.existsSync(path.dirname(dbDir))) {
  fs.mkdirSync(path.dirname(dbDir), { recursive: true });
}

// Static and Middlewares
app.use(morgan('combined')); // Request logging
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));
app.use(fileUpload());
app.set('view engine', 'ejs');
app.use('/uploads', (req, res, next) => {
  console.log('Serving static file:', req.url);
  express.static(path.join(__dirname, 'public/uploads'))(req, res, next);
});
app.use('/sounds', express.static(path.join(__dirname, 'public/sounds')));

// Healthcheck endpoint for Railway
app.get('/health', (req, res) => res.status(200).send('OK'));

// Endpoint to get VAPID public key
app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

// Endpoint to save push subscription
app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  const username = req.session.user?.username;
  if (username) {
    subscriptions.set(username, subscription);
    console.log(`Subscription saved for ${username}`);
    res.status(201).json({});
  } else {
    res.status(401).json({ error: 'User not logged in' });
  }
});

// Fetch all stickers
app.get('/stickers', (req, res) => {
  try {
    const stickers = db.fetchAllStickers();
    console.log('Returning stickers:', stickers);
    res.json(stickers.map(sticker => ({
      _id: sticker.id,
      url: sticker.url,
      uploader: sticker.uploader,
      type: sticker.url.endsWith('.mp4') ? 'video' : 'image'
    })));
  } catch (error) {
    console.error('Error fetching stickers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stickers' });
  }
});

// Add sticker
app.post('/add-sticker', (req, res) => {
  if (!req.files || !req.files.sticker) {
    console.log('No file uploaded in /add-sticker');
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const file = req.files.sticker;
  const uploader = req.body.uploader;
  const type = file.name.endsWith('.mp4') ? 'video' : 'image';
  const uploadPath = path.join(uploadsDir, `sticker_${Date.now()}_${file.name}`);

  file.mv(uploadPath, err => {
    if (err) {
      console.error('Upload sticker error:', err);
      return res.status(500).json({ success: false, message: 'Error uploading sticker' });
    }

    try {
      const stickerId = db.insertSticker(uploadPath.replace(process.env.UPLOADS_PATH || path.join(__dirname, 'public'), ''), uploader, type);
      console.log(`Sticker added with ID: ${stickerId}, Path: ${uploadPath}`);
      res.json({ success: true, stickerId });
    } catch (error) {
      console.error('Error inserting sticker into DB:', error);
      res.status(500).json({ success: false, message: 'Error saving sticker to database' });
    }
  });
});

// Delete sticker
app.delete('/delete-sticker/:id', (req, res) => {
  const stickerId = req.params.id;
  db.deleteStickerById(stickerId);
  res.json({ success: true });
});

// User database
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUser(user) {
  const users = loadUsers();
  users.push(user);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Routes
app.get('/', (req, res) => res.redirect('/signup'));

app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;
    saveUser({ username, email, password, dp: '/uploads/default.png' });
    res.redirect('/login');
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).send('Error signing up. <a href="/signup">Try Again</a>');
  }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      req.session.user = user;
      res.redirect('/chat');
    } else {
      res.send('Invalid credentials. <a href="/login">Try Again</a>');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send('Error logging in. <a href="/login">Try Again</a>');
  }
});

app.get('/chat', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('chat', { 
    username: req.session.user.username,
    user: req.session.user
  });
});

app.get('/chat/:receiver', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const receiver = req.params.receiver;
  const users = loadUsers();
  const found = users.find(u => u.username === receiver);

  res.render('chat_user', { 
    sender: req.session.user.username,
    receiver,
    receiverDp: found?.dp || '/images/dummy.jpg',
    user: req.session.user
  });
});

app.get('/searchUser', (req, res) => {
  try {
    const { username } = req.query;
    const users = loadUsers();
    const matched = users.filter(user => user.username.toLowerCase() === username.toLowerCase());
    res.json(matched.map(u => ({
      username: u.username,
      dp: u.dp || '/images/dummy.jpg'
    })));
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json([]);
  }
});

app.get('/upload-dp', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('uploadDp', { user: req.session.user });
});

app.post('/uploadDp', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  try {
    const file = req.files.dp;
    const username = req.session.user.username;
    const uploadPath = path.join(uploadsDir, `${username}_${Date.now()}.jpg`);

    file.mv(uploadPath, err => {
      if (err) {
        console.error('Upload DP error:', err);
        return res.status(500).send('Error uploading file.');
      }
      const users = loadUsers();
      const userIndex = users.findIndex(u => u.username === username);
      if (userIndex !== -1) {
        users[userIndex].dp = uploadPath.replace(process.env.UPLOADS_PATH || path.join(__dirname, 'public'), '');
        fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
        req.session.user.dp = users[userIndex].dp;
      }
      res.redirect('/chat');
    });
  } catch (error) {
    console.error('Upload DP error:', error);
    res.status(500).send('Error uploading file.');
  }
});

// SOCKET.IO EVENTS
io.on('connection', socket => {
  console.log('✅ User connected');

  socket.on('register', ({ username }) => {
    socket.join(username);
  });

  socket.on('joinChat', async ({ sender, receiver }) => {
    try {
      socket.join(sender);
      socket.join(receiver);

      await db.markMessagesAsSeen(receiver, sender);
      db.fetchConversation(sender, receiver, (messages) => {
        socket.emit('loadOldMessages', messages);
      });
      io.to(sender).emit('seenUpdate', { sender: receiver, receiver: sender });
    } catch (error) {
      console.error('Join chat error:', error);
    }
  });

  socket.on('chatMessage', async ({ sender, receiver, message, replyTo, replyToType }) => {
    try {
      const messageId = await db.insertMessage(sender, receiver, message, 'text', replyTo, replyToType);
      io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message, type: 'text', time: getCurrentTime(), replyTo, replyToType });
      socket.emit('messageSent', { _id: messageId });

      const subscription = subscriptions.get(receiver);
      if (subscription) {
        const payload = JSON.stringify({
          title: `New Message from ${sender}`,
          body: message,
          sender: sender
        });
        webPush.sendNotification(subscription, payload).catch(err => {
          console.error('Error sending push notification:', err);
        });
      }
    } catch (error) {
      console.error('Chat message error:', error);
    }
  });

  socket.on('sendImage', async ({ sender, receiver, imageData, replyTo, replyToType, type }) => {
    try {
      const messageId = await db.insertMessage(sender, receiver, imageData, type, replyTo, replyToType);
      io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message: imageData, type, time: getCurrentTime(), replyTo, replyToType });
      socket.emit('messageSent', { _id: messageId });

      const subscription = subscriptions.get(receiver);
      if (subscription) {
        const payload = JSON.stringify({
          title: `New ${type === 'video' ? 'Video' : 'Image'} from ${sender}`,
          body: type === 'video' ? 'Sent a video' : 'Sent an image',
          sender: sender
        });
        webPush.sendNotification(subscription, payload).catch(err => {
          console.error('Error sending push notification:', err);
        });
      }
    } catch (error) {
      console.error('Send image/video error:', error);
    }
  });

  socket.on('sendSticker', async ({ sender, receiver, url, type, replyTo, replyToType }) => {
    try {
      const messageId = await db.insertMessage(sender, receiver, url, `sticker-${type}`, replyTo, replyToType);
      io.to(receiver).emit('newMessage', { _id: messageId, sender, receiver, message: url, type: `sticker-${type}`, time: getCurrentTime(), replyTo, replyToType });
      socket.emit('messageSent', { _id: messageId });
    } catch (error) {
      console.error('Send sticker error:', error);
    }
  });

  socket.on('editMessage', async ({ messageId, newContent }) => {
    try {
      await db.updateMessageById(messageId, newContent);
      io.emit('messageEdited', { messageId, newContent });
    } catch (error) {
      console.error('Edit message error:', error);
    }
  });

  socket.on('seen', async ({ sender, receiver }) => {
    try {
      await db.markMessagesAsSeen(receiver, sender);
      io.to(sender).emit('seenUpdate', { sender, receiver });
    } catch (error) {
      console.error('Seen update error:', error);
    }
  });

  socket.on('deleteMessage', async ({ messageId, sender, receiver }) => {
    try {
      const changes = await db.deleteMessageById(messageId);
      if (changes > 0) {
        io.to(sender).to(receiver).emit('messageDeleted', { messageId });
        console.log(`Message ${messageId} deleted successfully`);
      } else {
        console.warn(`No message found with ID ${messageId}`);
      }
    } catch (error) {
      console.error('Delete message error:', error);
    }
  });

  socket.on('deleteSticker', async ({ stickerId, sender, receiver }) => {
    try {
      await db.deleteStickerById(stickerId);
      io.to(sender).to(receiver).emit('stickerDeleted', { stickerId });
      console.log(`Sticker ${stickerId} deleted successfully`);
    } catch (error) {
      console.error('Delete sticker error:', error);
    }
  });

  socket.on('call', ({ sender, receiver, type }) => {
    try {
      io.to(receiver).emit('call', { sender, type });
    } catch (error) {
      console.error('Call event error:', error);
    }
  });

  socket.on('acceptCall', ({ sender, receiver }) => {
    try {
      io.to(receiver).emit('acceptCall', { sender });
    } catch (error) {
      console.error('Accept call event error:', error);
    }
  });

  socket.on('signal', ({ sender, receiver, data }) => {
    try {
      io.to(receiver).emit('signal', { sender, data });
    } catch (error) {
      console.error('Signal event error:', error);
    }
  });

  socket.on('endCall', ({ sender, receiver }) => {
    try {
      io.to(receiver).emit('endCall', { sender });
    } catch (error) {
      console.error('End call event error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected');
  });
});

function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://localhost:${PORT}`));
