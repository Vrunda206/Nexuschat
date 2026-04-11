const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true },
  description: { type: String, default: '' },
  icon:        { type: String, default: '💬' },
  // Category tags: study | coding | gaming | announcements | general | custom
  category:    { type: String, default: 'general' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isDefault:   { type: Boolean, default: false },
  memberCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
