import { validationResult } from 'express-validator';
import Activity from '../models/Activity.js';
import Relationship from '../models/Relationship.js';
import Notification from '../models/Notification.js';

export const createActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId, title, description, type, category, mood, location, duration, tags, impact } = req.body;

    // Verify relationship exists and user is part of it
    const relationship = await Relationship.findById(relationshipId);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (relationship.status !== 'active') {
      return res.status(400).json({ message: 'Can only create activities for active relationships' });
    }

    const activity = new Activity({
      relationship: relationshipId,
      createdBy: req.user.id,
      title,
      description,
      type,
      category,
      mood,
      location,
      duration,
      tags,
      impact,
      participants: [{ user: req.user.id, role: 'participant' }]
    });

    await activity.save();
    await activity.populate([
      { path: 'relationship', select: 'title type' },
      { path: 'createdBy', select: 'username firstName lastName avatar' },
      { path: 'participants.user', select: 'username firstName lastName avatar' }
    ]);

    // Update relationship stats
    await Relationship.findByIdAndUpdate(relationshipId, {
      $inc: { 'stats.totalActivities': 1 },
      $set: { 'stats.lastInteraction': new Date() }
    });

    // Apply trust/relationship impact if specified
    if (impact && (impact.trustChange || impact.relationshipStrength)) {
      const trustUpdate = {};
      if (impact.trustChange) {
        trustUpdate['stats.trustLevel'] = Math.max(0, Math.min(100, relationship.stats.trustLevel + impact.trustChange));
      }
      
      if (Object.keys(trustUpdate).length > 0) {
        await Relationship.findByIdAndUpdate(relationshipId, trustUpdate);
      }
    }

    // Notify the other person in the relationship
    const partnerId = relationship.getPartner(req.user.id);
    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'activity_added',
      title: 'New Activity Added',
      message: `${req.user.firstName} ${req.user.lastName} added a new activity: "${title}"`,
      category: 'activity',
      metadata: {
        activityId: activity._id,
        relationshipId: relationshipId
      }
    });

    res.status(201).json({
      message: 'Activity created successfully',
      activity
    });
  } catch (error) {
    console.error('Create activity error:', error);
    res.status(500).json({ message: 'Server error during activity creation' });
  }
};

export const getActivities = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params;
    const { type, category, mood, page = 1, limit = 20 } = req.query;

    // Verify relationship exists and user is part of it
    const relationship = await Relationship.findById(relationshipId);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filter = { relationship: relationshipId };
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (mood) filter.mood = mood;

    const skip = (page - 1) * limit;

    const activities = await Activity.find(filter)
    .populate({
      path: 'relationship',
      select: 'title type initiator partner',
      populate: {
        path: 'partner initiator',
        select: 'username firstName lastName avatar'
      }
    })
    .populate('createdBy', 'username firstName lastName avatar')
    .populate('participants.user', 'username firstName lastName avatar')
    .populate('reactions.user', 'username firstName lastName avatar')
    .populate('comments.user', 'username firstName lastName avatar')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Activity.countDocuments(filter);

    res.json({
      activities,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ message: 'Server error fetching activities' });
  }
};

export const getMyAllActivities = async (req, res) => {
  try {
    const userId = req.user.id;
console.log(userId);
    // Find all accepted relationships where user is userA or userB
    const relationships = await Relationship.find({
      status: 'active',
      $or: [
        { initiator: userId },
        { partner: userId }
      ]
    }).select('_id');
    console.log("Found Relationships:", relationships);

    const relationshipIds = relationships.map(r => r._id);

    // Find activities linked to these relationships
    const activities = await Activity.find({
      relationship: { $in: relationshipIds }
    })
      .populate({
        path: 'relationship',
        select: 'title type initiator partner',
        populate: [
          { path: 'initiator', select: 'username firstName lastName avatar' },
          { path: 'partner', select: 'username firstName lastName avatar' }
        ]
      })
      .populate('createdBy', 'username firstName lastName avatar')
      .populate('participants.user', 'username firstName lastName avatar')
      .populate('reactions.user', 'username firstName lastName avatar')
      .populate('comments.user', 'username firstName lastName avatar')
      .sort({ createdAt: -1 });

    res.json({ activities });
    console.log(activities,"==========");
  } catch (error) {
    console.error('Error fetching user activities:', error);
    res.status(500).json({ message: 'Server error fetching activities' });
  }
};

export const getActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const activity = await Activity.findById(req.params.id)
      .populate('relationship', 'title type initiator partner')
      .populate('createdBy', 'username firstName lastName avatar')
      .populate('participants.user', 'username firstName lastName avatar')
      .populate('reactions.user', 'username firstName lastName avatar')
      .populate('comments.user', 'username firstName lastName avatar')
      .populate('relatedMilestone', 'title status');

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    // Check if user is part of the relationship
    if (!activity.relationship.initiator.equals(req.user.id) && !activity.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ activity });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ message: 'Server error fetching activity' });
  }
};

export const updateActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const activity = await Activity.findById(req.params.id).populate('relationship');

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    // Only creator can update the activity
    if (!activity.createdBy.equals(req.user.id)) {
      return res.status(403).json({ message: 'Only the creator can update this activity' });
    }

    const allowedUpdates = ['title', 'description', 'type', 'category', 'mood', 'location', 'duration', 'tags', 'privacy'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const updatedActivity = await Activity.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate([
      { path: 'relationship', select: 'title type' },
      { path: 'createdBy', select: 'username firstName lastName avatar' },
      { path: 'participants.user', select: 'username firstName lastName avatar' }
    ]);

    res.json({
      message: 'Activity updated successfully',
      activity: updatedActivity
    });
  } catch (error) {
    console.error('Update activity error:', error);
    res.status(500).json({ message: 'Server error during activity update' });
  }
};

export const addReaction = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { type = 'like' } = req.body;

    const activity = await Activity.findById(req.params.id).populate('relationship');

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    // Check if user is part of the relationship
    if (!activity.relationship.initiator.equals(req.user.id) && !activity.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    activity.addReaction(req.user.id, type);
    await activity.save();

    await activity.populate('reactions.user', 'username firstName lastName avatar');

    res.json({
      message: 'Reaction added successfully',
      reactions: activity.reactions
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ message: 'Server error adding reaction' });
  }
};

export const addComment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const activity = await Activity.findById(req.params.id).populate('relationship');

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    // Check if user is part of the relationship
    if (!activity.relationship.initiator.equals(req.user.id) && !activity.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    activity.addComment(req.user.id, text.trim());
    await activity.save();

    await activity.populate('comments.user', 'username firstName lastName avatar');

    res.json({
      message: 'Comment added successfully',
      comments: activity.comments
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ message: 'Server error adding comment' });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    // Only creator can delete the activity
    if (!activity.createdBy.equals(req.user.id)) {
      return res.status(403).json({ message: 'Only the creator can delete this activity' });
    }

    await Activity.findByIdAndDelete(req.params.id);

    // Update relationship stats
    await Relationship.findByIdAndUpdate(activity.relationship, {
      $inc: { 'stats.totalActivities': -1 }
    });

    res.json({
      message: 'Activity deleted successfully'
    });
  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({ message: 'Server error during activity deletion' });
  }
};