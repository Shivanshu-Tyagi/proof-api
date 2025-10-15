import mongoose from 'mongoose';

const relationshipHistorySchema = new mongoose.Schema({
  relationshipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Relationship',
    required: true
  },
  eventType: {
    type: String,
    enum: [
      'created',
      'accepted',
      'declined',
      'updated',
      'breakup_requested',
      'breakup_confirmed',
      'ended',
      'rekindled',
      'history_access_requested',
      'history_access_granted',
      'history_access_denied',
      'user_history_privacy_changed'
    ],
    required: true
  },
  eventDate: {
    type: Date,
    default: Date.now
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }, // The other user involved in the event, if applicable
  details: {
    type: mongoose.Schema.Types.Mixed // Flexible field to store event-specific data
  }
}, {
  timestamps: true
});

relationshipHistorySchema.index({ relationshipId: 1, eventDate: -1 });
relationshipHistorySchema.index({ actor: 1, eventDate: -1 });

export default mongoose.model('RelationshipHistory', relationshipHistorySchema);

