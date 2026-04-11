const express = require('express');
const jwt     = require('jsonwebtoken');
const Room    = require('../models/Room');
const Event   = require('../models/Event');
const router  = express.Router();

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

// ── GET ALL ROOMS ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ isDefault: -1, createdAt: 1 }).lean();
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE ROOM ───────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { displayName, description, icon, category } = req.body;
    if (!displayName) return res.status(400).json({ error: 'Room name required' });
    const name = displayName.toLowerCase().replace(/\s+/g, '-');

    const room = await Room.create({
      name, displayName, description, icon: icon || '💬',
      category: category || 'general',
      createdBy: req.user.userId
    });
    res.json(room);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Room name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── EVENTS: GET ───────────────────────────────────────────
router.get('/:room/events', async (req, res) => {
  try {
    // Return ALL events (past + future) so they always show in the panel
    const events = await Event.find({ room: req.params.room })
      .sort({ date: 1 }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EVENTS: CREATE ────────────────────────────────────────
router.post('/:room/events', authMiddleware, async (req, res) => {
  try {
    const { title, description, date } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' });

    const event = await Event.create({
      room: req.params.room,
      title, description,
      date: new Date(date),
      createdBy: req.user.userId,
      createdByName: req.user.username || 'Unknown',
      attendees: []
    });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EVENTS: RSVP ─────────────────────────────────────────
router.post('/:room/events/:eventId/rsvp', authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const already = event.attendees.find(a => a.userId.toString() === req.user.userId);
    if (already) {
      event.attendees = event.attendees.filter(a => a.userId.toString() !== req.user.userId);
    } else {
      event.attendees.push({ userId: req.user.userId, username: req.user.username });
    }
    await event.save();
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
