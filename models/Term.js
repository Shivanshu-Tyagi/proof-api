import mongoose from 'mongoose';

const termSchema = new mongoose.Schema({
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
    required: [true, 'Term title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Term description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: String,
    enum: ['communication', 'boundaries', 'expectations', 'goals', 'activities', 'conflict_resolution', 'commitment', 'other'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['proposed', 'agreed', 'rejected', 'modified', 'archived'],
    default: 'proposed'
  },
  agreedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    agreedAt: {
      type: Date,
      default: Date.now
    },
    signature: String
  }],
  expiresAt: {
    type: Date
  },
  reminders: [{
    date: Date,
    message: String,
    sent: { type: Boolean, default: false }
  }],
  violations: [{
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    description: String,
    severity: {
      type: String,
      enum: ['minor', 'moderate', 'major', 'severe'],
      default: 'minor'
    },
    reportedAt: {
      type: Date,
      default: Date.now
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolution: String
  }],
  metadata: {
    isTemplate: { type: Boolean, default: false },
    templateCategory: String,
    customFields: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
termSchema.index({ relationship: 1 });
termSchema.index({ status: 1 });
termSchema.index({ category: 1 });

// Virtual for agreement status
termSchema.virtual('isFullyAgreed').get(function() {
  // Get the relationship to check how many people should agree
  return this.agreedBy.length >= 2; // Assuming 2 people in relationship
});

// Method to check if user has agreed
termSchema.methods.hasUserAgreed = function(userId) {
  return this.agreedBy.some(agreement => 
    agreement.user.toString() === userId.toString()
  );
};

termSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Term', termSchema);