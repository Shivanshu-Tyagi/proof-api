import { validationResult } from 'express-validator';
import Milestone from '../models/Milestone.js';
import Relationship from '../models/Relationship.js';
import Certificate from '../models/Certificate.js';
import Notification from '../models/Notification.js';
import { generateCertificateImage } from './certificateController.js'; // Import the image generation function

export const createMilestone = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId, title, description, category, type = 'manual', targetDate, criteria, rewards, difficulty = 'medium' } = req.body;

    // Verify relationship exists and user is part of it
    const relationship = await Relationship.findById(relationshipId);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (relationship.status !== 'active') {
      return res.status(400).json({ message: 'Can only create milestones for active relationships' });
    }

    const milestone = new Milestone({
      relationship: relationshipId,
      title,
      description,
      category,
      type,
      targetDate,
      criteria,
      rewards,
      difficulty
    });

    await milestone.save();
    await milestone.populate('relationship', 'title type');

    // Notify the other person in the relationship
    const partnerId = relationship.getPartner(req.user.id);
    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'milestone_created',
      title: 'New Milestone Created',
      message: `${req.user.firstName} ${req.user.lastName} created a new milestone: "${title}"`,
      category: 'milestone',
      metadata: {
        milestoneId: milestone._id,
        relationshipId: relationshipId
      }
    });

    res.status(201).json({
      message: 'Milestone created successfully',
      milestone
    });
  } catch (error) {
    console.error('Create milestone error:', error);
    res.status(500).json({ message: 'Server error during milestone creation' });
  }
};

export const getMilestones = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params;
    const { status, category, difficulty } = req.query;

    // Verify relationship exists and user is part of it
    const relationship = await Relationship.findById(relationshipId);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filter = { relationship: relationshipId };
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;

    const milestones = await Milestone.find(filter)
      .populate('participants.user', 'username firstName lastName avatar')
      .sort({ targetDate: 1, createdAt: -1 });

    res.json({ milestones });
  } catch (error) {
    console.error('Get milestones error:', error);
    res.status(500).json({ message: 'Server error fetching milestones' });
  }
};

export const getMilestone = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const milestone = await Milestone.findById(req.params.id)
      .populate('relationship', 'title type initiator partner')
      .populate('participants.user', 'username firstName lastName avatar')
      .populate('evidence.uploadedBy', 'username firstName lastName avatar');

    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Check if user is part of the relationship
    if (!milestone.relationship.initiator.equals(req.user.id) && !milestone.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ milestone });
  } catch (error) {
    console.error('Get milestone error:', error);
    res.status(500).json({ message: 'Server error fetching milestone' });
  }
};

export const updateMilestone = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const milestone = await Milestone.findById(req.params.id).populate('relationship');

    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Check if user is part of the relationship
    if (!milestone.relationship.initiator.equals(req.user.id) && !milestone.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Can't update completed milestones
    if (milestone.status === 'completed') {
      return res.status(400).json({ message: 'Cannot update completed milestones' });
    }

    const allowedUpdates = ['title', 'description', 'targetDate', 'criteria', 'rewards', 'difficulty'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const updatedMilestone = await Milestone.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('relationship', 'title type');

    res.json({
      message: 'Milestone updated successfully',
      milestone: updatedMilestone
    });
  } catch (error) {
    console.error('Update milestone error:', error);
    res.status(500).json({ message: 'Server error during milestone update' });
  }
};

export const completeMilestone = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const milestone = await Milestone.findById(req.params.id).populate(
      'relationship', 'initiator partner title type' // Populate relationship details needed for certificate
    );

    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Check if user is part of the relationship
    if (!milestone.relationship.initiator.equals(req.user.id) && !milestone.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (milestone.status === 'completed') {
      return res.status(400).json({ message: 'Milestone is already completed' });
    }

    // Complete the milestone
    milestone.complete(req.user.id);
    await milestone.save();

    // Update relationship stats
    await Relationship.findByIdAndUpdate(milestone.relationship._id, {
      $inc: { 'stats.milestonesAchieved': 1 }
    });

    // Create certificate if specified in rewards
    if (milestone.rewards.certificate) {
      // Populate initiator and partner details for certificate generation
      const populatedRelationship = await milestone.relationship.populate(
        'initiator partner', 'firstName lastName'
      );

      const initiatorFullName = `${populatedRelationship.initiator.firstName} ${populatedRelationship.initiator.lastName}`;
      const partnerFullName = `${populatedRelationship.partner.firstName} ${populatedRelationship.partner.lastName}`;
      const recipientsForImage = [
        { user: populatedRelationship.initiator, firstName: populatedRelationship.initiator.firstName, lastName: populatedRelationship.initiator.lastName },
        { user: populatedRelationship.partner, firstName: populatedRelationship.partner.firstName, lastName: populatedRelationship.partner.lastName },
      ];

      const certificateTitle = `${milestone.title} Achievement`;
      const certificateDescription = `Awarded for completing the milestone: ${milestone.title}`;
      const certificateType = 'milestone';
      const certificateLevel = milestone.difficulty === 'expert' ? 'platinum' :
                               milestone.difficulty === 'hard' ? 'gold' :
                               milestone.difficulty === 'medium' ? 'silver' : 'bronze';

      // Generate certificate image
      const certificateImageUrl = await generateCertificateImage({
        title: certificateTitle,
        description: certificateDescription,
        recipients: recipientsForImage,
        type: certificateType,
        level: certificateLevel,
        design: milestone.rewards.certificateDesign || {}, // Use existing design or empty object
      });
      
      milestone.rewards.imageUrl = certificateImageUrl; // Store generated image URL in milestone
      await milestone.save(); // Save milestone with new image URL

      const certificate = new Certificate({
        relatedTo: 'milestone',
        relatedId: milestone._id,
        title: certificateTitle,
        description: certificateDescription,
        type: certificateType,
        level: certificateLevel,
        recipients: [
          { user: populatedRelationship.initiator._id },
          { user: populatedRelationship.partner._id }
        ],
        design: {
          ...milestone.rewards.certificateDesign,
          imageUrl: certificateImageUrl,
        },
      });

      await certificate.save();

      // Notify about certificate
      await Notification.create({
        recipient: milestone.relationship.initiator,
        sender: req.user.id,
        type: 'certificate_earned',
        title: 'Certificate Earned',
        message: `You earned a certificate for completing "${milestone.title}"`,
        category: 'achievement',
        metadata: {
          certificateId: certificate._id,
          milestoneId: milestone._id
        }
      });

      await Notification.create({
        recipient: milestone.relationship.partner,
        sender: req.user.id,
        type: 'certificate_earned',
        title: 'Certificate Earned',
        message: `You earned a certificate for completing "${milestone.title}"`,
        category: 'achievement',
        metadata: {
          certificateId: certificate._id,
          milestoneId: milestone._id
        }
      });
    }

    // Notify the other person about milestone completion
    const partnerId = milestone.relationship.initiator.equals(req.user.id) 
      ? milestone.relationship.partner 
      : milestone.relationship.initiator;

    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'milestone_achieved',
      title: 'Milestone Completed',
      message: `${req.user.firstName} ${req.user.lastName} completed the milestone: "${milestone.title}"`,
      category: 'milestone',
      metadata: {
        milestoneId: milestone._id,
        relationshipId: milestone.relationship._id
      }
    });

    await milestone.populate('participants.user', 'username firstName lastName avatar');

    res.json({
      message: 'Milestone completed successfully',
      milestone
    });
  } catch (error) {
    console.error('Complete milestone error:', error);
    res.status(500).json({ message: 'Server error during milestone completion' });
  }
};

export const addEvidence = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { type, url, description } = req.body;

    const milestone = await Milestone.findById(req.params.id).populate('relationship');

    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Check if user is part of the relationship
    if (!milestone.relationship.initiator.equals(req.user.id) && !milestone.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    milestone.evidence.push({
      type,
      url,
      description,
      uploadedBy: req.user.id
    });

    await milestone.save();
    await milestone.populate('evidence.uploadedBy', 'username firstName lastName avatar');

    res.json({
      message: 'Evidence added successfully',
      milestone
    });
  } catch (error) {
    console.error('Add evidence error:', error);
    res.status(500).json({ message: 'Server error adding evidence' });
  }
};

export const deleteMilestone = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const milestone = await Milestone.findById(req.params.id).populate('relationship');

    if (!milestone) {
      return res.status(404).json({ message: 'Milestone not found' });
    }

    // Check if user is part of the relationship
    if (!milestone.relationship.initiator.equals(req.user.id) && !milestone.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Can't delete completed milestones
    if (milestone.status === 'completed') {
      return res.status(400).json({ message: 'Cannot delete completed milestones' });
    }

    await Milestone.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Milestone deleted successfully'
    });
  } catch (error) {
    console.error('Delete milestone error:', error);
    res.status(500).json({ message: 'Server error during milestone deletion' });
  }
};