const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room: {
    type: String,
    required: true,
    default: 'general'
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderName: {
    type: String,
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['text', 'file', 'image', 'system'],
    default: 'text'
  },
  file: {
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String
  },
  reactions: [{
    emoji: String,
    users: [String]
  }],
  isEdited: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
