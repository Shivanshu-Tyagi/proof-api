import mongoose from 'mongoose';

const relationshipSchema = new mongoose.Schema({
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['acquaintance', 'friend', 'close_friend', 'best_friend', 'romantic_interest', 'partner', 'engaged', 'married', 'family', 'mentor', 'mentee'],
    default: 'acquaintance'
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'ended', 'archived', 'requested_breakup', 'declined'],
    default: 'pending'
  },
  breakupRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  latestCertificate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Certificate'
  },
  title: {
    type: String,
    required: [true, 'Relationship title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  acceptedDate: {
    type: Date
  },
  endDate: {
    type: Date
  },
  declinedDate: {
    type: Date
  },
  privacy: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'private'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  customFields: {
    anniversary: Date,
    meetingPlace: String,
    sharedInterests: [String],
    relationshipGoals: [String],
    endReason: String,
    archivedDate: Date
  },
  settings: {
    privacy: {
      type: String,
      enum: ['public', 'friends', 'private'],
      default: 'private'
    },
    notifications: {
      activities: { type: Boolean, default: true },
      milestones: { type: Boolean, default: true },
      terms: { type: Boolean, default: true },
      anniversaries: { type: Boolean, default: true }
    },
    permissions: {
      viewHistory: { type: Boolean, default: false },
      editProfile: { type: Boolean, default: true },
      createActivities: { type: Boolean, default: true },
      createMilestones: { type: Boolean, default: true },
      createTerms: { type: Boolean, default: true }
    },
    transparency: {
      shareLocation: { type: Boolean, default: false },
      shareContacts: { type: Boolean, default: false },
      allowHistoryAccess: { type: Boolean, default: false },
      requireMutualConsent: { type: Boolean, default: true }
    }
  },
  historyAccess: {
    requested: { type: Boolean, default: false },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    requestedAt: Date,
    granted: { type: Boolean, default: false },
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    grantedAt: Date
  },
  stats: {
    trustLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    communicationFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'occasionally', 'rarely'],
      default: 'occasionally'
    },
    lastInteraction: {
      type: Date,
      default: Date.now
    },
    totalActivities: {
      type: Number,
      default: 0
    },
    milestonesAchieved: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Pending request to change the relationship type that requires mutual consent
relationshipSchema.add({
  typeChangeRequest: {
    requested: { type: Boolean, default: false },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: { type: Date },
    newType: {
      type: String,
      enum: ['acquaintance', 'friend', 'close_friend', 'best_friend', 'romantic_interest', 'partner', 'engaged', 'married', 'family', 'mentor', 'mentee']
    },
    message: { type: String, maxlength: 500 }
  }
});

// Track per-user dismissals for declined invites and ended relations
relationshipSchema.add({
  dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

// Indexes for better performance
// Allow re-relationship after breakup by enforcing uniqueness only while relationship is not ended/archived
relationshipSchema.index(
  { initiator: 1, partner: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'active', 'requested_breakup'] } }
  }
);
relationshipSchema.index({ status: 1 });
relationshipSchema.index({ type: 1 });

// Virtual for relationship duration
relationshipSchema.virtual('duration').get(function() {
  const start = this.acceptedDate || this.startDate;
  const end = this.endDate || new Date();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24)); // days
});

// Method to get the other person in the relationship
relationshipSchema.methods.getPartner = function(userId) {
  return this.initiator.toString() === userId.toString() ? this.partner : this.initiator;
};

// Method to check if user is part of this relationship
relationshipSchema.methods.includesUser = function(userId) {
  const objUserId = new mongoose.Types.ObjectId(userId);
  return this.initiator.equals(objUserId) || 
         this.partner.equals(objUserId);
};

relationshipSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Relationship', relationshipSchema);