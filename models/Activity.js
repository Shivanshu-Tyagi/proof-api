import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  relationship: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Relationship',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Activity title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
    default: ''
  },
  type: {
    type: String,
    enum: ['conversation', 'date', 'gift', 'achievement', 'conflict', 'resolution', 'milestone', 'memory', 'goal', 'other'],
    required: true
  },
  category: {
    type: String,
    enum: ['communication', 'quality_time', 'physical_touch', 'acts_of_service', 'gifts', 'words_of_affirmation', 'shared_activities', 'personal_growth'],
    default: 'shared_activities'
  },
  mood: {
    type: String,
    enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative'],
    default: 'neutral'
  },
  privacy: {
    type: String,
    enum: ['public', 'relationship', 'private'],
    default: 'relationship'
  },
  location: {
    name: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    address: String
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['participant', 'observer', 'facilitator'],
      default: 'participant'
    },
    satisfaction: {
      type: Number,
      min: 1,
      max: 5
    },
    notes: String
  }],
  media: [{
    type: {
      type: String,
      enum: ['photo', 'video', 'audio', 'document']
    },
    url: String,
    caption: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  tags: [String],
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['love', 'like', 'laugh', 'wow', 'sad', 'angry'],
      default: 'like'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: {
      type: String,
      required: true,
      maxlength: [500, 'Comment cannot exceed 500 characters']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  relatedMilestone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Milestone'
  },
  impact: {
    trustChange: {
      type: Number,
      min: -10,
      max: 10,
      default: 0
    },
    relationshipStrength: {
      type: Number,
      min: -10,
      max: 10,
      default: 0
    }
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPattern: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly']
    },
    interval: Number, // every X days/weeks/months/years
    endDate: Date
  }
}, {
  timestamps: true
});

// Indexes
activitySchema.index({ relationship: 1 });
activitySchema.index({ createdBy: 1 });
activitySchema.index({ type: 1 });
activitySchema.index({ createdAt: -1 });

// Virtual for activity age
activitySchema.virtual('ageInDays').get(function() {
  return Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Method to add reaction
activitySchema.methods.addReaction = function(userId, reactionType) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(r => 
    r.user.toString() !== userId.toString()
  );
  
  // Add new reaction
  this.reactions.push({
    user: userId,
    type: reactionType
  });
};

// Method to add comment
activitySchema.methods.addComment = function(userId, text) {
  this.comments.push({
    user: userId,
    text: text
  });
};

activitySchema.set('toJSON', { virtuals: true });

export default mongoose.model('Activity', activitySchema);