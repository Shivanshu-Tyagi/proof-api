import mongoose from 'mongoose';

// A note one person keeps about a relationship. Never shown to the other person.
const privateNoteSchema = new mongoose.Schema({
  relationship: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: true });

privateNoteSchema.index({ relationship: 1, user: 1 }, { unique: true });

export default mongoose.model('PrivateNote', privateNoteSchema);
