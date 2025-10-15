import mongoose from 'mongoose';

const milestoneSchema = new mongoose.Schema({
  relationship: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Relationship',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Milestone title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  category: {
    type: String,
    enum: ['time_based', 'activity_based', 'trust_based', 'communication', 'commitment', 'achievement', 'celebration', 'custom'],
    required: true
  },
  type: {
    type: String,
    enum: ['automatic', 'manual', 'collaborative'],
    default: 'manual'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'archived'],
    default: 'pending'
  },
  targetDate: {
    type: Date
  },
  completedDate: {
    type: Date
  },
  criteria: {
    timeRequired: Number, // in days
    activitiesRequired: Number,
    trustLevelRequired: Number,
    customCriteria: [{
      name: String,
      description: String,
      completed: { type: Boolean, default: false },
      completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      completedAt: Date
    }]
  },
  rewards: {
    points: { type: Number, default: 0 },
    badge: String,
    certificate: { type: Boolean, default: false },
    customRewards: [String]
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    contribution: String,
    completedAt: Date
  }],
  evidence: [{
    type: {
      type: String,
      enum: ['photo', 'video', 'document', 'note', 'link']
    },
    url: String,
    description: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isTemplate: {
    type: Boolean,
    default: false
  },
  templateCategory: String,
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    default: 'medium'
  },
  tags: [String]
}, {
  timestamps: true
});

// Indexes
milestoneSchema.index({ relationship: 1 });
milestoneSchema.index({ status: 1 });
milestoneSchema.index({ category: 1 });
milestoneSchema.index({ targetDate: 1 });

// Virtual for progress percentage
milestoneSchema.virtual('progressPercentage').get(function() {
  if (this.status === 'completed') return 100;
  if (this.status === 'failed') return 0;
  
  const totalCriteria = this.criteria.customCriteria.length;
  if (totalCriteria === 0) return 0;
  
  const completedCriteria = this.criteria.customCriteria.filter(c => c.completed).length;
  return Math.round((completedCriteria / totalCriteria) * 100);
});

// Method to check if milestone is overdue
milestoneSchema.methods.isOverdue = function() {
  return this.targetDate && new Date() > this.targetDate && this.status !== 'completed';
};

// Method to complete milestone
milestoneSchema.methods.complete = function(userId) {
  this.status = 'completed';
  this.completedDate = new Date();
  
  // Add user to participants if not already there
  const existingParticipant = this.participants.find(p => 
    p.user.toString() === userId.toString()
  );
  
  if (!existingParticipant) {
    this.participants.push({
      user: userId,
      completedAt: new Date()
    });
  }
};

milestoneSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Milestone', milestoneSchema);