const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  authorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName:  String,
  content:     String,
  upvotes:     [String],   // array of usernames who upvoted
  isBestAnswer:{ type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  room:        { type: String, default: 'general', index: true },
  sender:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  senderName:  String,
  content:     { type: String, default: '' },

  // ── TYPE ─────────────────────────────────────────────────
  // text | system | file | code | question | announcement
  type:        { type: String, default: 'text' },

  // ── FILE ATTACHMENT ──────────────────────────────────────
  file: {
    url:       String,
    name:      String,
    size:      Number,
    // auto-detected category: image | pdf | document | video | other
    category:  { type: String, default: 'other' }
  },

  // ── CODE BLOCK ───────────────────────────────────────────
  code: {
    language:  { type: String, default: 'javascript' },
    snippet:   String
  },

  // ── Q&A ──────────────────────────────────────────────────
  isQuestion:  { type: Boolean, default: false },
  answers:     [answerSchema],

  // ── REACTIONS ────────────────────────────────────────────
  reactions: [{
    emoji: String,
    users: [String]
  }]
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
