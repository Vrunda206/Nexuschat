const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const Message = require('../models/Message');
const User    = require('../models/User');
const router  = express.Router();

// ── MULTER SETUP ──────────────────────────────────────────
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

// ── HELPER: Detect file category ─────────────────────────
function detectCategory(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg','.jpeg','.png','.gif','.webp','.svg'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.mp4','.mov','.avi','.mkv','.webm'].includes(ext)) return 'video';
  if (['.doc','.docx','.txt','.ppt','.pptx','.xls','.xlsx','.csv','.md'].includes(ext)) return 'document';
  if (['.zip','.rar','.tar','.gz'].includes(ext)) return 'archive';
  if (['.js','.ts','.py','.java','.cpp','.c','.go','.rs','.html','.css','.json'].includes(ext)) return 'code';
  return 'other';
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── FILE UPLOAD ───────────────────────────────────────────
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const category = detectCategory(req.file.originalname);
  const fileUrl  = `/uploads/${req.file.filename}`;

  // Increment user stats
  await User.findByIdAndUpdate(req.user.userId, { $inc: { 'stats.filesShared': 1 } });

  res.json({
    url: fileUrl,
    name: req.file.originalname,
    size: req.file.size,
    category
  });
});

// ── SMART FILE ORGANIZER: Get files by category ───────────
router.get('/files/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const { category } = req.query;

    const query = { room, type: 'file' };
    if (category && category !== 'all') query['file.category'] = category;

    const files = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHAT SUMMARY ENDPOINT ─────────────────────────────────
router.get('/summary/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const msgs = await Message.find({ room, type: { $nin: ['system'] } })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    if (msgs.length < 3) return res.json({ summary: 'Not enough messages to summarize yet.' });

    // Simple extractive summary: pick first sentence of the 5 most recent unique-author messages
    const seen = new Set();
    const highlights = [];
    for (const m of msgs.reverse()) {
      if (!seen.has(m.senderName) && m.content) {
        seen.add(m.senderName);
        highlights.push(`${m.senderName}: "${m.content.slice(0, 100)}"`);
        if (highlights.length >= 5) break;
      }
    }

    const summary = `📋 Recent activity in #${room}: ${highlights.join(' • ')}`;
    res.json({ summary, count: msgs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LEADERBOARD ───────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username avatar stats')
      .sort({ 'stats.messagesSent': -1 })
      .limit(10)
      .lean();

    const board = users.map(u => ({
      username: u.username,
      avatar:   u.avatar,
      score:    (u.stats.messagesSent || 0) * 1
              + (u.stats.filesShared || 0) * 3
              + (u.stats.helpfulAnswers || 0) * 10,
      stats:    u.stats
    }));
    board.sort((a, b) => b.score - a.score);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
