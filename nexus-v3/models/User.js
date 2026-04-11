const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  avatar:    { type: String, default: '' },
  isOnline:  { type: Boolean, default: false },
  lastSeen:  { type: Date, default: Date.now },
  theme:     { type: String, enum: ['dark', 'light'], default: 'dark' },

  // ── LEADERBOARD STATS ────────────────────────────────────
  stats: {
    messagesSent:    { type: Number, default: 0 },
    filesShared:     { type: Number, default: 0 },
    helpfulAnswers:  { type: Number, default: 0 },  // answers marked as best
    questionsAsked:  { type: Number, default: 0 }
  }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);
