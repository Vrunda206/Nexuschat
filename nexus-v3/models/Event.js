const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  room:          { type: String, required: true },
  title:         { type: String, required: true },
  description:   { type: String, default: '' },
  date:          { type: Date, required: true },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: String,
  // Users who RSVP'd
  attendees: [{
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String
  }]
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
