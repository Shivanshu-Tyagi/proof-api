import mongoose from 'mongoose';
import { validationResult } from 'express-validator';
import Feedback from '../models/Feedback.js';
import { isAdminEmail } from '../config.js';

const PAGE_SIZE = 20;
// Words too common to say anything about what a post is about
const FILLER = new Set(['the', 'and', 'for', 'with', 'want', 'would', 'like', 'have', 'has', 'this', 'that', 'you', 'can', 'could', 'should', 'please', 'make', 'app', 'add', 'need', 'too', 'when', 'what', 'not', 'are', 'there', 'some', 'more', 'just', 'get', 'its', 'but', 'was', 'does', 'did', 'how', 'why', 'our', 'your']);

// Search text becomes words. By default every word has to appear (in the title or the details), in any order.
// With match=any (used to suggest similar posts) one meaningful word is enough.
const searchFilter = (text, any) => {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9\u00C0-\uFFFF]+/).filter((w) => w.length >= 3))].slice(0, 6);
  const wordsToUse = any ? words.filter((w) => !FILLER.has(w)) : words;
  const regexFor = (w) => new RegExp(escapeRegex(w), 'i');
  if (!wordsToUse.length) {
    if (any) return null; // nothing meaningful to match on
    const phrase = regexFor(text.trim());
    return { $or: [{ title: phrase }, { body: phrase }] };
  }
  const either = (w) => ({ $or: [{ title: regexFor(w) }, { body: regexFor(w) }] });
  return any ? { $or: wordsToUse.map(either) } : { $and: wordsToUse.map(either) };
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idOf = (value) => String(value?._id ?? value);

const present = (item, me, canModerate) => ({
  id: item._id,
  type: item.type,
  title: item.title,
  body: item.body,
  status: item.status,
  response: item.response,
  authorName: item.anonymous ? 'Anonymous' : (item.author?.firstName || 'Someone'),
  mine: idOf(item.author) === String(me),
  supported: item.supporters.some((id) => String(id) === String(me)),
  supportCount: item.supportCount,
  createdAt: item.createdAt,
  canDelete: canModerate || idOf(item.author) === String(me)
});

const invalid = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: errors.array()[0].msg });
  return true;
};

const findItem = (req) => (mongoose.isValidObjectId(req.params.id) ? Feedback.findById(req.params.id).populate('author', 'firstName') : null);

export const listFeedback = async (req, res) => {
  if (invalid(req, res)) return;
  try {
    const { sort = 'top', type, status, q, mine, match } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const me = req.user.id;
    const canModerate = isAdminEmail(req.user.email);

    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (mine === 'true') filter.author = me;
    if (q && q.trim()) {
      const text = searchFilter(q.trim().slice(0, 100), match === 'any');
      if (text) Object.assign(filter, text);
      else return res.json({ feedback: [], total: 0, hasMore: false, canModerate }); // only filler words: nothing to suggest
    }

    const order = sort === 'new' ? { createdAt: -1 } : { supportCount: -1, createdAt: -1 };
    const [items, total] = await Promise.all([
      Feedback.find(filter).sort(order).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate('author', 'firstName'),
      Feedback.countDocuments(filter)
    ]);

    res.json({
      feedback: items.map((i) => present(i, me, canModerate)),
      total,
      hasMore: page * PAGE_SIZE < total,
      canModerate
    });
  } catch (error) {
    console.error('List feedback error:', error);
    res.status(500).json({ message: 'Server error loading feedback' });
  }
};

export const createFeedback = async (req, res) => {
  if (invalid(req, res)) return;
  try {
    const me = req.user.id;
    const { type, title, body, anonymous } = req.body;
    // Whoever writes it wants it too, so it starts with one
    const item = await Feedback.create({ author: me, type, title, body, anonymous: anonymous === true, supporters: [me], supportCount: 1 });
    await item.populate('author', 'firstName');
    res.status(201).json({ feedback: present(item, me, isAdminEmail(req.user.email)) });
  } catch (error) {
    console.error('Create feedback error:', error);
    res.status(500).json({ message: 'Server error saving your feedback' });
  }
};

// "Me too": adds your voice, or takes it back. Each step is a single atomic update, so a double tap cannot count twice.
export const toggleSupport = async (req, res) => {
  try {
    const me = req.user.id;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Feedback not found' });

    const added = await Feedback.updateOne({ _id: req.params.id, supporters: { $ne: me } }, { $addToSet: { supporters: me }, $inc: { supportCount: 1 } });
    let supported = added.modifiedCount === 1;
    if (!supported) {
      const removed = await Feedback.updateOne({ _id: req.params.id, supporters: me }, { $pull: { supporters: me }, $inc: { supportCount: -1 } });
      if (removed.modifiedCount !== 1) return res.status(404).json({ message: 'Feedback not found' });
    }
    const item = await Feedback.findById(req.params.id).select('supportCount supporters');
    supported = item.supporters.some((id) => String(id) === String(me));
    res.json({ supported, supportCount: item.supportCount });
  } catch (error) {
    console.error('Support feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteFeedback = async (req, res) => {
  try {
    const item = await findItem(req);
    if (!item) return res.status(404).json({ message: 'Feedback not found' });
    if (idOf(item.author) !== String(req.user.id) && !isAdminEmail(req.user.email)) {
      return res.status(403).json({ message: 'You can only remove your own feedback' });
    }
    await item.deleteOne();
    res.json({ message: 'Feedback removed' });
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({ message: 'Server error removing feedback' });
  }
};

// Owner only: say what is happening with it
export const updateFeedbackStatus = async (req, res) => {
  if (invalid(req, res)) return;
  try {
    if (!isAdminEmail(req.user.email)) return res.status(403).json({ message: 'Only the app owner can do this' });
    const item = await findItem(req);
    if (!item) return res.status(404).json({ message: 'Feedback not found' });
    if (req.body.status) item.status = req.body.status;
    if (typeof req.body.response === 'string') item.response = req.body.response;
    await item.save();
    res.json({ feedback: present(item, req.user.id, true) });
  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({ message: 'Server error updating feedback' });
  }
};
