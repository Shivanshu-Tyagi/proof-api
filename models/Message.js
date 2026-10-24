import mongoose from 'mongoose';

// One message between the two people of a relationship
const messageSchema = new mongoose.Schema({
  relationship: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

messageSchema.index({ relationship: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);
