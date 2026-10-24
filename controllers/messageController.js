import mongoose from 'mongoose';
import { validationResult } from 'express-validator';
import Message from '../models/Message.js';
import Relationship from '../models/Relationship.js';
import { notify } from '../utils/notify.js';

const OPEN = ['active', 'requested_breakup'];
const PAGE = 50;
const idOf = (v) => String(v?._id ?? v);

// The relationship, only if the signed-in person is one of its two members
const findMine = async (req) => {
  if (!mongoose.isValidObjectId(req.params.relationshipId)) return null;
  const rel = await Relationship.findOne({
    _id: req.params.relationshipId,
    status: { $in: [...OPEN, 'ended'] },
    $or: [{ initiator: req.user.id }, { partner: req.user.id }]
  }).populate('initiator partner', 'firstName lastName username avatar');
  return rel;
};

const otherOf = (rel, me) => {
  const o = idOf(rel.initiator) === String(me) ? rel.partner : rel.initiator;
  return { id: o._id, firstName: o.firstName, lastName: o.lastName, username: o.username, avatar: o.avatar };
};

const present = (m, me) => ({ id: m._id, text: m.text, mine: idOf(m.sender) === String(me), createdAt: m.createdAt });

export const listThreads = async (req, res) => {
  try {
    const me = req.user.id;
    const rels = await Relationship.find({
      status: { $in: [...OPEN, 'ended'] },
      $or: [{ initiator: me }, { partner: me }]
    }).populate('initiator partner', 'firstName lastName username avatar');

    const threads = await Promise.all(rels.map(async (rel) => {
      const [last, unread] = await Promise.all([
        Message.findOne({ relationship: rel._id }).sort({ createdAt: -1 }),
        Message.countDocuments({ relationship: rel._id, sender: { $ne: me }, readBy: { $ne: new mongoose.Types.ObjectId(me) } })
      ]);
      return {
        relationshipId: rel._id,
        title: rel.title,
        status: rel.status,
        canSend: OPEN.includes(rel.status),
        other: otherOf(rel, me),
        last: last ? present(last, me) : null,
        unread,
        sortAt: last?.createdAt ?? rel.updatedAt
      };
    }));
    threads.sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
    res.json({ threads: threads.map(({ sortAt, ...t }) => t), unreadTotal: threads.reduce((n, t) => n + t.unread, 0) });
  } catch (error) {
    console.error('List threads error:', error);
    res.status(500).json({ message: 'Server error loading messages' });
  }
};

export const getMessages = async (req, res) => {
  try {
    const rel = await findMine(req);
    if (!rel) return res.status(404).json({ message: 'Conversation not found' });
    const filter = { relationship: rel._id };
    if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) filter.createdAt = { $lt: new Date(req.query.before) };
    const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(PAGE + 1);
    const hasMore = rows.length > PAGE;
    const messages = rows.slice(0, PAGE).reverse().map((m) => present(m, req.user.id));
    res.json({
      relationship: { id: rel._id, title: rel.title, status: rel.status, canSend: OPEN.includes(rel.status), other: otherOf(rel, req.user.id) },
      messages,
      hasMore
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error loading messages' });
  }
};

export const sendMessage = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
  try {
    const rel = await findMine(req);
    if (!rel) return res.status(404).json({ message: 'Conversation not found' });
    if (!OPEN.includes(rel.status)) return res.status(403).json({ message: 'This relationship has ended, so messaging is closed.' });

    const me = req.user.id;
    const message = await Message.create({ relationship: rel._id, sender: me, text: req.body.text.trim(), readBy: [me] });

    // One alert per unread stretch, so a burst of messages is not a burst of notifications
    const other = otherOf(rel, me);
    const alreadyUnread = await Message.countDocuments({ relationship: rel._id, sender: me, _id: { $ne: message._id }, readBy: { $ne: other.id } });
    if (alreadyUnread === 0) {
      await notify({
        recipient: other.id, sender: me, type: 'other', category: 'relationship',
        title: 'New message', message: `You have a new message in “${rel.title}”.`,
        metadata: { relationshipId: rel._id, source: 'messages' }
      }).catch((e) => console.error('Message notify error:', e.message));
    }
    res.status(201).json({ message: present(message, me) });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error sending the message' });
  }
};

export const markRead = async (req, res) => {
  try {
    const rel = await findMine(req);
    if (!rel) return res.status(404).json({ message: 'Conversation not found' });
    await Message.updateMany({ relationship: rel._id, sender: { $ne: req.user.id }, readBy: { $ne: req.user.id } }, { $addToSet: { readBy: req.user.id } });
    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
