import mongoose from 'mongoose';

// A suggestion, problem report or other feedback. Everyone signed in can read it and add a "me too".
const feedbackSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['problem', 'idea', 'other'], required: true },
  title: { type: String, required: true, trim: true, minlength: 4, maxlength: 100 },
  body: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
  anonymous: { type: Boolean, default: false }, // hides the author's first name from other people
  status: { type: String, enum: ['open', 'planned', 'in_progress', 'done', 'declined'], default: 'open' },
  response: { type: String, trim: true, maxlength: 500, default: '' }, // a short public reply from the owner
  supporters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  supportCount: { type: Number, default: 0 } // always equals supporters.length; kept to sort by it
}, { timestamps: true });

feedbackSchema.index({ supportCount: -1, createdAt: -1 });
feedbackSchema.index({ createdAt: -1 });

export default mongoose.model('Feedback', feedbackSchema);
