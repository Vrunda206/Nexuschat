const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');

// ── MULTER SETUP (File Uploads) ─────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
                   'application/pdf', 'text/plain',
                   'application/msword',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ── GET CHAT HISTORY ────────────────────────────────────
router.get('/history/:room', authMiddleware, async (req, res) => {
  try {
    const { room } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ room })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      messages: messages.reverse(),
      page,
      hasMore: messages.length === limit
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── FILE UPLOAD ─────────────────────────────────────────
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const isImage = req.file.mimetype.startsWith('image/');
    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl,
        isImage
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── AI SMART REPLY SUGGESTIONS ──────────────────────────
router.post('/ai-suggestions', authMiddleware, async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Return fallback suggestions if no API key
      return res.json({
        suggestions: [
          "That's interesting! Tell me more.",
          "I agree with that.",
          "Thanks for sharing!"
        ]
      });
    }

    // Build context string from recent messages
    const contextStr = context && context.length > 0
      ? context.slice(-5).map(m => `${m.senderName}: ${m.content}`).join('\n')
      : '';

    const prompt = contextStr
      ? `Chat context:\n${contextStr}\n\nLatest message: "${message}"\n\nGenerate 3 short, natural reply suggestions (max 10 words each). Return ONLY a JSON array of strings. No explanation.`
      : `Message: "${message}"\n\nGenerate 3 short, natural reply suggestions (max 10 words each). Return ONLY a JSON array of strings. No explanation.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = data.content?.[0]?.text?.trim();

    let suggestions = [];
    try {
      suggestions = JSON.parse(raw);
    } catch {
      // Fallback parse: split by newlines/commas
      suggestions = raw.split(/[\n,]/).map(s => s.replace(/["\[\]]/g, '').trim()).filter(Boolean).slice(0, 3);
    }

    res.json({ suggestions: suggestions.slice(0, 3) });
  } catch (err) {
    console.error('AI suggestion error:', err);
    res.json({
      suggestions: ["Got it!", "Sounds good!", "I'll check it out."]
    });
  }
});

module.exports = router;
