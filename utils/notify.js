import Notification from '../models/Notification.js';
import User from '../models/User.js';

// Which personal preference switches off which kind of notification
const CATEGORY_PREFERENCE = { milestone: 'milestones', activity: 'activities' };

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
