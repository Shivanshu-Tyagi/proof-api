import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: [
      'relationship_invite',
      'relationship_accepted',
      'relationship_declined',
      'term_proposed',
      'term_agreed',
      'term_violated',
      'milestone_achieved',
      'milestone_reminder',
      'milestone_created',
      'activity_added',
      'certificate_earned',
      'anniversary_reminder',
      'trust_level_changed',
      'system_update',
      'other',
      'breakup_request',
      'breakup_confirmed',
      'breakup_request_canceled',
      'history_access_request',
      'history_access_granted',
      'history_access_denied'
    ],
    required: true
  },
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'archived'],
    default: 'unread'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['relationship', 'milestone', 'activity', 'system', 'reminder', 'achievement'],
    required: true
  },
  metadata: {
    relationshipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Relationship'
    },
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Milestone'
    },
    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Activity'
    },
    termId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Term'
    },
    certificateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Certificate'
    },
    source: String, // where the notification originated
    batchId: String, // for bulk notifications
    customData: mongoose.Schema.Types.Mixed
  },
  actionRequired: {
    type: Boolean,
    default: false
  },
  actions: [{
    type: {
      type: String,
      enum: ['accept', 'decline', 'view', 'respond', 'acknowledge']
    },
    label: String,
    url: String
  }],
  readAt: Date,
  expiresAt: Date,
  delivery: {
    email: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String
    },
    push: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String
    },
    inApp: {
      delivered: { type: Boolean, default: true },
      deliveredAt: { type: Date, default: Date.now }
    }
  }
}, {
  timestamps: true
});

// Indexes
notificationSchema.index({ recipient: 1, status: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for notification age
notificationSchema.virtual('ageInHours').get(function() {
  return Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60));
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.status = 'read';
  this.readAt = new Date();
  return this.save();
};

// Method to check if notification is expired
notificationSchema.methods.isExpired = function() {
  return this.expiresAt && new Date() > this.expiresAt;
};

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  
  // Here you could add logic to send email/push notifications
  // based on user preferences
  
  return notification;
};

// Static method to get unread count for user
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    recipient: userId,
    status: 'unread'
  });
};

notificationSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Notification', notificationSchema);