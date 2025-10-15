import { validationResult } from 'express-validator';
import Notification from '../models/Notification.js';

export const getNotifications = async (req, res) => {
  try {
    const { status, type, category, page = 1, limit = 20 } = req.query;

    const filter = { recipient: req.user.id };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (category) filter.category = category;

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(filter)
      .populate('sender', 'username firstName lastName avatar')
      .populate('metadata.relationshipId', 'title type')
      .populate('metadata.milestoneId', 'title category')
      .populate('metadata.activityId', 'title type')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      status: 'unread'
    });

    res.json({
      notifications,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      },
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Server error fetching notifications' });
  }
};

export const getNotification = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const notification = await Notification.findById(req.params.id)
      .populate('sender', 'username firstName lastName avatar')
      .populate('metadata.relationshipId', 'title type')
      .populate('metadata.milestoneId', 'title category')
      .populate('metadata.activityId', 'title type')
      .populate('metadata.termId', 'title category')
      .populate('metadata.certificateId', 'title type');

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Check if notification belongs to the user
    if (!notification.recipient.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ notification });
  } catch (error) {
    console.error('Get notification error:', error);
    res.status(500).json({ message: 'Server error fetching notification' });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Check if notification belongs to the user
    if (!notification.recipient.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await notification.markAsRead();

    res.json({
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ message: 'Server error marking notification as read' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, status: 'unread' },
      { 
        status: 'read',
        readAt: new Date()
      }
    );

    res.json({
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ message: 'Server error marking all notifications as read' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Check if notification belongs to the user
    if (!notification.recipient.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Notification.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Server error deleting notification' });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user.id);

    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Server error fetching unread count' });
  }
};