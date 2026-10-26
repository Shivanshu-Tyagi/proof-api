import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Relationship from '../models/Relationship.js';

// Which personal preference switches off which kind of notification
const CATEGORY_PREFERENCE = { milestone: 'milestones', activity: 'activities' };

// After a request has been answered (or withdrawn), the notification that asked for the answer should stop offering buttons
export const resolveActions = (recipientId, relationshipId, types) =>
  Notification.updateMany(
    { recipient: recipientId, 'metadata.relationshipId': relationshipId, type: { $in: types }, actionRequired: true },
    { $set: { actionRequired: false, status: 'read', readAt: new Date() } }
  ).catch((error) => console.error('Resolve notification actions error:', error.message));

// Requests that ask for an answer (invitations, type changes, break-ups) go out of date: the person may have answered
// from another page, the other person may have withdrawn, or the record may be from before answers were tracked.
// Closes any whose relationship no longer matches, so the Inbox never offers an action that cannot be done.
export const settleStaleRequests = async (userId) => {
  try {
    const open = await Notification.find({ recipient: userId, actionRequired: true, 'metadata.relationshipId': { $exists: true, $ne: null } })
      .select('type metadata.relationshipId').lean();
    if (!open.length) return;

    const ids = [...new Set(open.map((n) => String(n.metadata.relationshipId)))];
    const found = await Relationship.find({ _id: { $in: ids } }).select('status partner typeChangeRequest breakupRequestedBy').lean();
    const byId = new Map(found.map((r) => [String(r._id), r]));
    const me = String(userId);

    const stillOpen = (type, r) => {
      if (!r) return false; // the relationship is gone
      switch (type) {
        case 'relationship_invite': return r.status === 'pending' && String(r.partner) === me;
        case 'relationship_type_change_request':
          return ['active', 'requested_breakup'].includes(r.status) && !!r.typeChangeRequest?.requested && String(r.typeChangeRequest.requestedBy) !== me;
        case 'breakup_request': return r.status === 'requested_breakup' && String(r.breakupRequestedBy) !== me;
        default: return true; // other requests keep their buttons
      }
    };

    const stale = open.filter((n) => !stillOpen(n.type, byId.get(String(n.metadata.relationshipId)))).map((n) => n._id);
    if (stale.length) {
      await Notification.updateMany({ _id: { $in: stale } }, { $set: { actionRequired: false, status: 'read', readAt: new Date() } });
    }
  } catch (error) {
    console.error('Settle stale requests error:', error.message);
  }
};

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
