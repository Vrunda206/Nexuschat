// ╔══════════════════════════════════════════════════════╗
// ║         NexusChat — Smart Collaboration App          ║
// ║   Node.js + Socket.io + MongoDB + AI Suggestions     ║
// ╚══════════════════════════════════════════════════════╝

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');

const User       = require('./models/User');
const Message    = require('./models/Message');
const authRoutes = require('./routes/auth');
const msgRoutes  = require('./routes/messages');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── MIDDLEWARE ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nexuschat')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ── ROUTES ───────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/messages', msgRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ── ADMIN ROUTES & API ─────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/admin/messages', async (req, res) => {
  try {
    const msgs = await Message.find().sort({ createdAt: -1 }).limit(100);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.delete('/api/admin/messages/:id', async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Serve the frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── SOCKET.IO ─────────────────────────────────────────────
// Track online users per room: { socketId → { userId, username, avatar, room } }
const onlineUsers = new Map();

// Socket auth middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return next(new Error('User not found'));

    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`🟢 ${user.username} connected [${socket.id}]`);

  // Mark user online in DB
  await User.findByIdAndUpdate(user._id, { isOnline: true });

  // ── JOIN ROOM ────────────────────────────────────────
  socket.on('join_room', async ({ room = 'general' }) => {
    // Leave previous room
    const prev = onlineUsers.get(socket.id);
    if (prev?.room) socket.leave(prev.room);

    socket.join(room);
    onlineUsers.set(socket.id, { userId: user._id, username: user.username, avatar: user.avatar, room });

    console.log(`   ${user.username} joined #${room}`);

    // Send last 50 messages to the joiner
    const history = await Message.find({ room })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    socket.emit('chat_history', history.reverse());

    // Broadcast system message
    const sysMsg = await Message.create({
      room, sender: user._id, senderName: 'System',
      content: `${user.username} joined the room`, type: 'system'
    });
    io.to(room).emit('receive_message', sysMsg);

    // Broadcast updated online list
    broadcastOnlineUsers(room);
  });

  // ── SEND MESSAGE ─────────────────────────────────────
  socket.on('send_message', async ({ room = 'general', content, type = 'text', file }) => {
    try {
      if (!content && !file) return;

      const msg = await Message.create({
        room,
        sender: user._id,
        senderName: user.username,
        content: content || '',
        type,
        file: file || undefined
      });

      // Emit to everyone in room (including sender)
      io.to(room).emit('receive_message', {
        ...msg.toObject(),
        senderAvatar: user.avatar
      });

      // Typing indicator: clear after message
      socket.to(room).emit('user_stopped_typing', { username: user.username });
    } catch (err) {
      console.error('Message save error:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ── TYPING INDICATORS ────────────────────────────────
  socket.on('typing', ({ room }) => {
    socket.to(room).emit('user_typing', { username: user.username });
  });

  socket.on('stop_typing', ({ room }) => {
    socket.to(room).emit('user_stopped_typing', { username: user.username });
  });

  // ── REACTIONS ────────────────────────────────────────
  socket.on('add_reaction', async ({ messageId, emoji, room }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      const reaction = msg.reactions.find(r => r.emoji === emoji);
      if (reaction) {
        if (!reaction.users.includes(user.username)) {
          reaction.users.push(user.username);
        } else {
          reaction.users = reaction.users.filter(u => u !== user.username);
          if (reaction.users.length === 0) {
            msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
          }
        }
      } else {
        msg.reactions.push({ emoji, users: [user.username] });
      }
      await msg.save();

      io.to(room).emit('reaction_updated', { messageId, reactions: msg.reactions });
    } catch (err) {
      console.error('Reaction error:', err);
    }
  });

  // ── DISCONNECT ───────────────────────────────────────
  socket.on('disconnect', async () => {
    const info = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);

    await User.findByIdAndUpdate(user._id, { isOnline: false, lastSeen: new Date() });
    console.log(`🔴 ${user.username} disconnected`);

    if (info?.room) {
      const sysMsg = await Message.create({
        room: info.room, sender: user._id, senderName: 'System',
        content: `${user.username} left the room`, type: 'system'
      });
      io.to(info.room).emit('receive_message', sysMsg);
      broadcastOnlineUsers(info.room);
    }
  });

  // ── HELPER: Broadcast online users list ─────────────
  function broadcastOnlineUsers(room) {
    const users = [];
    for (const [, info] of onlineUsers) {
      if (info.room === room) {
        users.push({ username: info.username, avatar: info.avatar });
      }
    }
    io.to(room).emit('online_users', users);
  }
});

// ── START SERVER ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 NexusChat running at http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   MongoDB     : ${process.env.MONGO_URI || 'mongodb://localhost:27017/nexuschat'}\n`);
});
