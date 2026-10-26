import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';
import Term from '../models/Term.js';
import Milestone from '../models/Milestone.js';
import Activity from '../models/Activity.js';
import Certificate from '../models/Certificate.js';
import Notification from '../models/Notification.js';
import PrivateNote from '../models/PrivateNote.js';
import RelationshipHistory from '../models/RelationshipHistory.js';
import Message from '../models/Message.js';
import Feedback from '../models/Feedback.js';

const LIVE_STATUSES = ['pending', 'active', 'requested_breakup'];

const memberOf = (userId) => ({ $or: [{ initiator: userId }, { partner: userId }] });

// Everything we hold about the person, as a download. Other people's data is limited to what
// this person can already see in the app: names and usernames, never emails or private notes.
export const exportAccountData = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('-password -passwordResetToken -passwordResetExpires -__v').lean();
    const relationships = await Relationship.find(memberOf(userId))
      .populate('initiator', 'firstName lastName username')
      .populate('partner', 'firstName lastName username')
      .lean();
    const relationshipIds = relationships.map((r) => r._id);

    const [terms, milestones, activities, certificates, notifications, privateNotes, history, sentMessages, feedback] = await Promise.all([
      Term.find({ relationship: { $in: relationshipIds } }).lean(),
      Milestone.find({ relationship: { $in: relationshipIds } }).lean(),
      Activity.find({ relationship: { $in: relationshipIds } }).lean(),
      Certificate.find({ 'recipients.user': userId }).populate('recipients.user', 'firstName lastName').lean(),
      Notification.find({ recipient: userId }).lean(),
      PrivateNote.find({ user: userId }).select('-__v').lean(),
      RelationshipHistory.find({ $or: [{ actor: userId }, { targetUser: userId }] }).lean(),
      Message.find({ sender: userId }).select('relationship text createdAt').lean(),
      Feedback.find({ author: userId }).select('type title body anonymous status response supportCount createdAt').lean()
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      about: 'Everything Twogether holds about your account. Other people appear by name and username only.',
      profile: user,
      relationships,
      agreements: terms,
      milestones,
      moments: activities,
      certificates,
      notifications,
      privateNotes,
      history,
      sentMessages,
      feedback
    };

    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="twogether-data-${day}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Export account data error:', error);
    res.status(500).json({ message: 'Server error exporting your data' });
  }
};

const removeAvatarFile = async (avatar) => {
  if (!avatar) return;
  const root = path.resolve(process.cwd(), 'uploads', 'avatars');
  const file = path.resolve(process.cwd(), avatar);
  // Only ever delete inside the avatars folder
  if (file.startsWith(root + path.sep)) {
    await fs.promises.unlink(file).catch(() => {});
  }
};

// Removes the person's data. Records shared with someone else are kept for them, but the
// person is no longer identifiable in them ("Deleted user"), and live relationships end.
// Their comments and reactions on moments are removed entirely.
export const deleteAccount = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const user = await User.findById(req.user.id);
    if (!user || !(await user.comparePassword(req.body.password))) {
      return res.status(401).json({ message: 'Password is incorrect' });
    }

    const userId = user._id;
    const now = new Date();

    // 1. Live relationships end, and the other people are told
    const live = await Relationship.find({ ...memberOf(userId), status: { $in: LIVE_STATUSES } });
    for (const relationship of live) {
      const otherId = relationship.getPartner(userId);
      const wasInvite = relationship.status === 'pending';
      relationship.status = wasInvite ? 'declined' : 'ended';
      relationship.endDate = now;
      relationship.historyAccess = { requested: false, granted: false };
      await relationship.save();

      if (otherId) {
        await Notification.create({
          recipient: otherId,
          type: 'system_update',
          title: wasInvite ? 'An invitation was withdrawn' : 'A relationship has ended',
          message: wasInvite
            ? `The person you invited to “${relationship.title}” deleted their account.`
            : `Someone you shared “${relationship.title}” with deleted their account, so it has ended.`,
          category: 'relationship',
          metadata: { relationshipId: relationship._id }
        }).catch(() => {});
      }
    }

    // 2. History access involving them stops, and anything they shared publicly goes private
    await Relationship.updateMany(memberOf(userId), { 'historyAccess.granted': false, 'historyAccess.requested': false });
    await Certificate.updateMany({ 'recipients.user': userId }, { 'sharing.isPublic': false });

    // 3. What is only theirs is deleted outright, including what they said on shared moments
    await Activity.updateMany(
      { $or: [{ 'comments.user': userId }, { 'reactions.user': userId }] },
      { $pull: { comments: { user: userId }, reactions: { user: userId } } }
    );
    await PrivateNote.deleteMany({ user: userId });
    await Notification.deleteMany({ recipient: userId });
    await Message.deleteMany({ sender: userId });
    // Their feedback goes, and so do their "me too" on other people's
    await Feedback.deleteMany({ author: userId });
    await Feedback.updateMany({ supporters: userId }, { $pull: { supporters: userId }, $inc: { supportCount: -1 } });
    await removeAvatarFile(user.avatar);

    // 4. The account itself keeps no personal details and can no longer sign in
    const tail = userId.toString();
    await User.updateOne({ _id: userId }, {
      $set: {
        username: `deleted_${tail.slice(-10)}`,
        email: `deleted-${tail}@deleted.invalid`,
        firstName: 'Deleted',
        lastName: 'user',
        registrationId: `del_${tail.slice(-8)}`,
        avatar: '',
        bio: '',
        isActive: false,
        password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
        passwordChangedAt: now
      },
      $unset: { dateOfBirth: '', passwordResetToken: '', passwordResetExpires: '' }
    });

    res.json({ message: 'Your account has been deleted.' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Server error deleting your account' });
  }
};
