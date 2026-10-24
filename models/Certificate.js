import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema({
  relatedTo: {
    type: String,
    enum: ['relationship', 'milestone', 'user', 'activity', 'term'],
    required: true
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'relatedTo'  
  },
  title: {
    type: String,
    required: [true, 'Certificate title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  type: {
    type: String,
    enum: ['milestone', 'anniversary', 'achievement', 'trust', 'communication', 'commitment', 'growth', 'special', 'relationship'],
    required: true
  },
  level: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'],
    default: 'bronze'
  },
  recipients: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    awardedAt: {
      type: Date,
      default: Date.now
    },
    personalMessage: String
  }],
  criteria: {
    description: String,
    requirements: [String],
    pointsRequired: Number,
    timeRequired: Number, // in days
    activitiesRequired: Number
  },
  design: {
    template: {
      type: String,
      enum: ['classic', 'modern', 'elegant', 'playful', 'romantic', 'friendship'],
      default: 'classic'
    },
    colors: {
      primary: { type: String, default: '#ec4899' },
      secondary: { type: String, default: '#0ea5e9' },
      accent: { type: String, default: '#f59e0b' }
    },
    icon: String,
    backgroundImage: String,
    imageUrl: String
  },
  metadata: {
    issuedBy: String,
    certificateNumber: {
      type: String,
      unique: true
    },
    validUntil: Date,
    isRevoked: { type: Boolean, default: false },
    revokedAt: Date,
    revokedReason: String
  },
  sharing: {
    isPublic: { type: Boolean, default: false },
    sharedOn: [String], 
    shareCount: { type: Number, default: 0 }
  },
  stats: {
    viewCount: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

certificateSchema.pre('save', function(next) {
  if (!this.metadata.certificateNumber) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.metadata.certificateNumber = `CERT-${timestamp}-${random}`.toUpperCase();
  }
  next();
});

// Indexes
certificateSchema.index({ type: 1 });
certificateSchema.index({ level: 1 });
certificateSchema.index({ relatedId: 1 });

// Virtual for certificate age
certificateSchema.virtual('ageInDays').get(function() {
  return Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Method to check if certificate is valid
certificateSchema.methods.isValid = function() {
  if (this.metadata.isRevoked) return false;
  if (this.metadata.validUntil && new Date() > this.metadata.validUntil) return false;
  return true;
};

// Method to revoke certificate
certificateSchema.methods.revoke = function(reason) {
  this.metadata.isRevoked = true;
  this.metadata.revokedAt = new Date();
  this.metadata.revokedReason = reason;
};

// Method to increment view count
certificateSchema.methods.incrementView = function() {
  this.stats.viewCount += 1;
  return this.save();
};

certificateSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Certificate', certificateSchema);