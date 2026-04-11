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
const Room       = require('./models/Room');
const Event      = require('./models/Event');
const authRoutes = require('./routes/auth');
const msgRoutes  = require('./routes/messages');
const roomRoutes = require('./routes/rooms');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ── DB STATUS ──────────────────────────────────────────────────
let dbConnected = false;
app.get('/api/db-status', (req, res) => {
  const state = mongoose.connection.readyState;
  // 0=disconnected,1=connected,2=connecting,3=disconnecting
  res.json({
    connected: state === 1,
    state,
    stateLabel: ['disconnected','connected','connecting','disconnecting'][state] || 'unknown',
    adminUrl: state === 1 ? `http://localhost:${process.env.PORT || 3000}/admin` : null
  });
});

// ── DB CONNECT ENDPOINT (called from admin connect screen) ─────
app.post('/api/db-connect', async (req, res) => {
  try {
    const { uri } = req.body;
    const mongoUri = uri || process.env.MONGO_URI || 'mongodb://localhost:27017/nexuschat';
    if (mongoose.connection.readyState === 1) {
      return res.json({ success: true, adminUrl: `http://localhost:${process.env.PORT || 3000}/admin` });
    }
    await mongoose.connect(mongoUri);
    await seedDefaultRooms();
    res.json({ success: true, adminUrl: `http://localhost:${process.env.PORT || 3000}/admin` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nexuschat')
  .then(async () => {
    console.log('✅ MongoDB connected');
    dbConnected = true;
    await seedDefaultRooms();
  })
  .catch(err => console.error('❌ MongoDB error:', err.message));

async function seedDefaultRooms() {
  const defaults = [
    { name: 'general',       displayName: 'General',       icon: '💬', category: 'general',       description: 'General chat for everyone' },
    { name: 'study',         displayName: 'Study Room',    icon: '📚', category: 'study',         description: 'Focused study discussions' },
    { name: 'coding-help',   displayName: 'Coding Help',   icon: '💻', category: 'coding',        description: 'Ask & answer coding questions' },
    { name: 'gaming',        displayName: 'Gaming',        icon: '🎮', category: 'gaming',        description: 'Gaming talk and team-ups' },
    { name: 'announcements', displayName: 'Announcements', icon: '📢', category: 'announcements', description: 'College & club announcements' }
  ];
  for (const r of defaults) {
    await Room.findOneAndUpdate({ name: r.name }, { ...r, isDefault: true }, { upsert: true, new: true });
  }
}

app.use('/api/auth',     authRoutes);
app.use('/api/messages', msgRoutes);
app.use('/api/rooms',    roomRoutes);

// ── ADMIN API ──────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [totalUsers, totalMessages, totalRooms, onlineUsers, totalFiles] = await Promise.all([
      User.countDocuments(),
      Message.countDocuments({ type: { $ne: 'system' } }),
      Room.countDocuments(),
      User.countDocuments({ isOnline: true }),
      Message.countDocuments({ type: 'file' })
    ]);
    // messages per day for last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const msgByDay = await Message.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo }, type: { $ne: 'system' } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    res.json({ totalUsers, totalMessages, totalRooms, onlineUsers, totalFiles, msgByDay });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try { await User.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/messages', async (req, res) => {
  try {
    const msgs = await Message.find({ type: { $ne: 'system' } }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(msgs);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── SOCKET.IO ──────────────────────────────────────────────────
const onlineUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch { next(new Error('Invalid token')); }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  await User.findByIdAndUpdate(user._id, { isOnline: true });

  socket.on('join_room', async ({ room = 'general' }) => {
    const prev = onlineUsers.get(socket.id);
    if (prev?.room) socket.leave(prev.room);
    socket.join(room);
    onlineUsers.set(socket.id, { userId: user._id, username: user.username, avatar: user.avatar, room });
    const history = await Message.find({ room }).sort({ createdAt: -1 }).limit(60).lean();
    socket.emit('chat_history', history.reverse());
    const sysMsg = await Message.create({ room, sender: user._id, senderName: 'System', content: `${user.username} joined #${room}`, type: 'system' });
    io.to(room).emit('receive_message', sysMsg);
    broadcastOnlineUsers(room);
    const events = await Event.find({ room, date: { $gte: new Date() } }).sort({ date: 1 }).limit(5).lean();
    socket.emit('room_events', events);
    // Send current leaderboard to the joining user
    broadcastLeaderboard();
  });

  socket.on('send_message', async ({ room = 'general', content, type = 'text', file }) => {
    try {
      if (!content && !file) return;
      const msgData = { room, sender: user._id, senderName: user.username, content: content || '', type };
      if (file) msgData.file = file;
      const msg = await Message.create(msgData);
      const update = { $inc: { 'stats.messagesSent': 1 } };
      if (file) update.$inc['stats.filesShared'] = 1;
      await User.findByIdAndUpdate(user._id, update);
      io.to(room).emit('receive_message', { ...msg.toObject(), senderAvatar: user.avatar });
      socket.to(room).emit('user_stopped_typing', { username: user.username });
      // Broadcast updated leaderboard to ALL clients after each message
      broadcastLeaderboard();
    } catch (err) { socket.emit('error', { message: 'Failed' }); }
  });

  socket.on('send_code', async ({ room = 'general', snippet, language = 'javascript' }) => {
    try {
      if (!snippet?.trim()) return;
      const msg = await Message.create({ room, sender: user._id, senderName: user.username, content: snippet, type: 'code', code: { language, snippet } });
      await User.findByIdAndUpdate(user._id, { $inc: { 'stats.messagesSent': 1 } });
      io.to(room).emit('receive_message', { ...msg.toObject(), senderAvatar: user.avatar });
      broadcastLeaderboard();
    } catch {}
  });

  socket.on('mark_question', async ({ messageId, room }) => {
    try {
      const msg = await Message.findByIdAndUpdate(messageId, { isQuestion: true, type: 'question' }, { new: true });
      await User.findByIdAndUpdate(user._id, { $inc: { 'stats.questionsAsked': 1 } });
      io.to(room).emit('message_updated', msg);
    } catch {}
  });

  socket.on('submit_answer', async ({ messageId, content, room }) => {
    try {
      if (!content?.trim()) return;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      msg.answers.push({ authorId: user._id, authorName: user.username, content });
      await msg.save();
      io.to(room).emit('message_updated', msg);
    } catch {}
  });

  socket.on('upvote_answer', async ({ messageId, answerId, room }) => {
    try {
      const msg = await Message.findById(messageId);
      const answer = msg?.answers?.id(answerId);
      if (!answer) return;
      if (answer.upvotes.includes(user.username)) answer.upvotes = answer.upvotes.filter(u => u !== user.username);
      else answer.upvotes.push(user.username);
      await msg.save();
      io.to(room).emit('message_updated', msg);
    } catch {}
  });

  socket.on('mark_best_answer', async ({ messageId, answerId, room }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg || msg.sender.toString() !== user._id.toString()) return;
      msg.answers.forEach(a => { a.isBestAnswer = a._id.toString() === answerId; });
      await msg.save();
      const best = msg.answers.id(answerId);
      if (best?.authorId) await User.findByIdAndUpdate(best.authorId, { $inc: { 'stats.helpfulAnswers': 1 } });
      io.to(room).emit('message_updated', msg);
      broadcastLeaderboard();
    } catch {}
  });

  socket.on('add_reaction', async ({ messageId, emoji, room }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      const reaction = msg.reactions.find(r => r.emoji === emoji);
      if (reaction) {
        if (!reaction.users.includes(user.username)) reaction.users.push(user.username);
        else { reaction.users = reaction.users.filter(u => u !== user.username); if (!reaction.users.length) msg.reactions = msg.reactions.filter(r => r.emoji !== emoji); }
      } else { msg.reactions.push({ emoji, users: [user.username] }); }
      await msg.save();
      io.to(room).emit('reaction_updated', { messageId, reactions: msg.reactions });
    } catch {}
  });

  socket.on('create_event', async ({ room, title, description, date }) => {
    try {
      if (!title || !date) return;
      const event = await Event.create({ room, title, description: description || '', date: new Date(date), createdBy: user._id, createdByName: user.username, attendees: [] });
      const sysMsg = await Message.create({ room, sender: user._id, senderName: 'System', content: `📅 ${user.username} created event: "${title}"`, type: 'system' });
      io.to(room).emit('receive_message', sysMsg);
      io.to(room).emit('event_created', event);
    } catch {}
  });

  socket.on('event_rsvp', async ({ eventId, room }) => {
    try {
      const event = await Event.findById(eventId);
      if (!event) return;
      const already = event.attendees.find(a => a.userId.toString() === user._id.toString());
      if (already) event.attendees = event.attendees.filter(a => a.userId.toString() !== user._id.toString());
      else event.attendees.push({ userId: user._id, username: user.username });
      await event.save();
      io.to(room).emit('event_updated', event);
    } catch {}
  });

  socket.on('typing',      ({ room }) => socket.to(room).emit('user_typing', { username: user.username }));
  socket.on('stop_typing', ({ room }) => socket.to(room).emit('user_stopped_typing', { username: user.username }));

  socket.on('disconnect', async () => {
    const info = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    await User.findByIdAndUpdate(user._id, { isOnline: false, lastSeen: new Date() });
    if (info?.room) {
      const sysMsg = await Message.create({ room: info.room, sender: user._id, senderName: 'System', content: `${user.username} left the room`, type: 'system' });
      io.to(info.room).emit('receive_message', sysMsg);
      broadcastOnlineUsers(info.room);
    }
  });

  function broadcastOnlineUsers(room) {
    const users = [];
    for (const [, info] of onlineUsers) { if (info.room === room) users.push({ username: info.username, avatar: info.avatar }); }
    io.to(room).emit('online_users', users);
  }

  async function broadcastLeaderboard() {
    try {
      const users = await User.find({}).select('username avatar stats').lean();
      const board = users.map(u => ({
        username: u.username,
        score: (u.stats?.messagesSent||0)*1 + (u.stats?.filesShared||0)*3 + (u.stats?.helpfulAnswers||0)*10,
        stats: u.stats || {}
      })).sort((a,b) => b.score - a.score).slice(0, 10);
      // Emit to ALL connected sockets (leaderboard is global)
      io.emit('leaderboard_update', board);
    } catch {}
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 NexusChat → http://localhost:${PORT}`);
  console.log(`🛡️  Admin     → http://localhost:${PORT}/admin\n`);
});
