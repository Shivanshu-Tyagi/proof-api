import Notification from '../models/Notification.js';
import User from '../models/User.js';

// Which personal preference switches off which kind of notification
const CATEGORY_PREFERENCE = { milestone: 'milestones', activity: 'activities' };

// After a request has been answered (or withdrawn), the notification that asked for the answer should stop offering buttons
export const resolveActions = (recipientId, relationshipId, types) =>
  Notification.updateMany(
    { recipient: recipientId, 'metadata.relationshipId': relationshipId, type: { $in: types }, actionRequired: true },
    { $set: { actionRequired: false, status: 'read', readAt: new Date() } }
  ).catch((error) => console.error('Resolve notification actions error:', error.message));

// Creates a notification unless the recipient has turned that kind off.
// Anything that needs the person to act (invites, breakup requests) is never suppressed.
export const notify = async (data) => {
  const key = CATEGORY_PREFERENCE[data.category];
  if (key && !data.actionRequired) {
    const recipient = await User.findById(data.recipient).select('preferences.notifications');
    if (recipient?.preferences?.notifications?.[key] === false) return null;
  }
  return Notification.create(data);
};
