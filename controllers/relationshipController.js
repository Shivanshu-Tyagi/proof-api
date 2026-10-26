import { validationResult } from 'express-validator';
import Relationship from '../models/Relationship.js';
import User from '../models/User.js';
import { notify, resolveActions } from '../utils/notify.js';

// A notification that cannot be saved should not break the action, but it must not disappear without a trace
const logNotifyError = (error) => console.error('Notification error:', error.message);
import RelationshipHistory from '../models/RelationshipHistory.js';
import PrivateNote from '../models/PrivateNote.js';

// A grant counts only until its expiry date, if it has one
const isGrantActive = (access) =>
  !!access?.granted && (!access.expiresAt || new Date(access.expiresAt) > new Date());

// History logging must never fail the request that triggered it
const logHistory = async (entry) => {
  try {
    await RelationshipHistory.create(entry);
  } catch (error) {
    console.error('Error creating relationship history entry:', error);
  }
};

export const createRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { partnerEmail, partnerId, title, type = 'acquaintance', description = '' } = req.body;

    // The person can be named by ID (from a search) or by email
    const partner = partnerId
      ? await User.findOne({ _id: partnerId, isActive: true })
      : await User.findOne({ email: partnerEmail });
    if (!partner) {
      return res.status(404).json({ message: partnerId ? 'User not found' : 'User not found with this email' });
    }

    // Check if user is trying to create relationship with themselves
    if (partner._id.toString() === req.user.id) {
      return res.status(400).json({ message: 'Cannot create relationship with yourself' });
    }

    // Check if a non-ended relationship already exists between the pair
    const existingRelationship = await Relationship.findOne({
      $and: [
        {
          $or: [
            { initiator: req.user.id, partner: partner._id },
            { initiator: partner._id, partner: req.user.id }
          ]
        },
        { status: { $in: ['pending', 'active', 'requested_breakup'] } }
      ]
    });

    if (existingRelationship) {
      return res.status(400).json({ message: 'Relationship already exists' });
    }

    // Prevent creating a new committed relationship (partner/engaged/married/best_friend)
    // if either the current user or the target user is already in an active committed relationship
    const committedTypes = ['partner', 'engaged', 'married', 'best_friend'];

    if (committedTypes.includes(type)) {
      const [currentUserCommitted, targetUserCommitted] = await Promise.all([
        Relationship.findOne({
          status: 'active',
          type: { $in: committedTypes },
          $or: [
            { initiator: req.user.id },
            { partner: req.user.id }
          ]
        }),
        Relationship.findOne({
          status: 'active',
          type: { $in: committedTypes },
          $or: [
            { initiator: partner._id },
            { partner: partner._id }
          ]
        })
      ]);

      if (currentUserCommitted || targetUserCommitted) {
        return res.status(400).json({
          message: 'User is already in a committed relationship. You can send a friend request instead.'
        });
      }
    }

    // Create new relationship
    const relationship = new Relationship({
      initiator: req.user.id,
      partner: partner._id,
      title,
      type,
      description,
      status: 'pending'
    });

    await relationship.save();

    // Populate for UI to display names correctly
    await relationship.populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Populate the relationship data
    await relationship.populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Log relationship creation
    await logHistory({
      relationshipId: relationship._id,
      eventType: 'created',
      actor: req.user.id,
      targetUser: partner._id,
      details: { title: relationship.title, type: relationship.type }
    });

    // Create notification for partner
    await notify({
      recipient: partner._id,
      sender: req.user.id,
      type: 'relationship_invite',
      title: 'New Relationship Invitation',
      message: `${req.user.firstName} ${req.user.lastName} wants to start a "${title}" relationship with you`,
      category: 'relationship',
      actionRequired: true,
      actions: [
        { type: 'accept', label: 'Accept', url: `/relationships/${relationship._id}/accept` },
        { type: 'decline', label: 'Decline', url: `/relationships/${relationship._id}/decline` }
      ],
      metadata: {
        relationshipId: relationship._id
      }
    });

    res.status(201).json({
      message: 'Relationship invitation sent successfully',
      relationship
    });
  } catch (error) {
    console.error('Create relationship error:', error);
    res.status(500).json({ message: 'Server error during relationship creation' });
  }
};

export const getRelationships = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    
    const filter = {
      $or: [
        { initiator: req.user.id },
        { partner: req.user.id }
      ],
      dismissedBy: { $ne: req.user.id }
    };

    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (page - 1) * limit;

    const relationships = await Relationship.find(filter)
      .populate('initiator', 'username firstName lastName avatar')
      .populate('partner', 'username firstName lastName avatar')
      .populate({
        path: 'latestCertificate'
      }) // Populate the latestCertificate
      .populate({
        path: 'historyAccess.requestedBy',
        select: 'username firstName lastName avatar'
      })
      .populate({
        path: 'historyAccess.grantedBy',
        select: 'username firstName lastName avatar'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Relationship.countDocuments(filter);

    res.json({
      relationships,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get relationships error:', error);
    res.status(500).json({ message: 'Server error fetching relationships' });
  }
};

export const getRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id)
      .populate('initiator', 'username firstName lastName avatar bio')
      .populate('partner', 'username firstName lastName avatar bio')
      .populate({
        path: 'latestCertificate'
      }) // Populate the latestCertificate
      .populate({
        path: 'historyAccess.requestedBy',
        select: 'username firstName lastName avatar'
      })
      .populate({
        path: 'historyAccess.grantedBy',
        select: 'username firstName lastName avatar'
      });

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is part of this relationship
    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ relationship });
  } catch (error) {
    console.error('Get relationship error:', error);
    res.status(500).json({ message: 'Server error fetching relationship' });
  }
};

export const updateRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is part of this relationship
    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Only allow updates if relationship is active
    if (relationship.status !== 'active') {
      return res.status(400).json({ message: 'Can only update active relationships' });
    }

    // Disallow direct type changes here; use the dedicated request flow
    const allowedUpdates = ['title', 'description', 'privacy', 'tags', 'customFields'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // The only settings that do anything: who may add shared items. Everything else is ignored.
    const requested = req.body.settings?.permissions;
    if (requested && typeof requested === 'object') {
      ['createActivities', 'createMilestones', 'createTerms'].forEach((key) => {
        if (typeof requested[key] === 'boolean') {
          updates[`settings.permissions.${key}`] = requested[key];
        }
      });
    }

    const updatedRelationship = await Relationship.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Log relationship update
    await logHistory({
      relationshipId: updatedRelationship._id,
      eventType: 'updated',
      actor: req.user.id,
      targetUser: updatedRelationship.getPartner(req.user.id),
      details: { updated: Object.keys(updates) }
    });

    res.json({
      message: 'Relationship updated successfully',
      relationship: updatedRelationship
    });
  } catch (error) {
    console.error('Update relationship error:', error);
    res.status(500).json({ message: 'Server error during relationship update' });
  }
};

// Request to change relationship type (e.g., friend -> close_friend or partner)
export const requestTypeChange = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const { newType, message } = req.body;
    const userId = req.user.id;

    const relationship = await Relationship.findById(id);
    if (!relationship) return res.status(404).json({ message: 'Relationship not found' });
    if (!relationship.includesUser(userId)) return res.status(403).json({ message: 'Access denied' });
    if (relationship.status !== 'active') return res.status(400).json({ message: 'Can only change type for active relationships' });

    // If there is already a pending request, block duplicate
    if (relationship.typeChangeRequest?.requested) {
      return res.status(400).json({ message: 'A type change request is already pending' });
    }

    // Validate committed-type constraints when escalating to committed types
    const committedTypes = ['partner', 'engaged', 'married', 'best_friend'];
    if (committedTypes.includes(newType)) {
      const someoneCommitted = await Relationship.findOne({
        status: 'active',
        type: { $in: committedTypes },
        $or: [ { initiator: relationship.initiator }, { partner: relationship.initiator } ]
      }) || await Relationship.findOne({
        status: 'active',
        type: { $in: committedTypes },
        $or: [ { initiator: relationship.partner }, { partner: relationship.partner } ]
      });
      if (someoneCommitted) {
        return res.status(400).json({ message: 'One of you is already in a committed relationship' });
      }
    }

    relationship.typeChangeRequest = {
      requested: true,
      requestedBy: userId,
      requestedAt: new Date(),
      newType,
      message
    };
    await relationship.save();

    const partnerId = relationship.getPartner(userId);
    // Fire-and-forget notification
    await notify({
      recipient: partnerId,
      sender: userId,
      type: 'relationship_type_change_request',
      title: 'Type Change Request',
      message: message || `Request to change relationship type to "${newType}"`,
      category: 'relationship',
      actionRequired: true,
      actions: [
        { type: 'accept', label: 'Accept', url: `/relationships/${relationship._id}/accept-type-change` },
        { type: 'decline', label: 'Decline', url: `/relationships/${relationship._id}/decline-type-change` }
      ],
      metadata: { relationshipId: relationship._id, newType }
    }).catch(logNotifyError);

    res.json({ message: 'Type change request sent', relationship });
  } catch (error) {
    console.error('Request type change error:', error);
    res.status(500).json({ message: 'Server error during type change request' });
  }
};

export const acceptTypeChange = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;
    const relationship = await Relationship.findById(id);
    if (!relationship) return res.status(404).json({ message: 'Relationship not found' });
    if (!relationship.includesUser(userId)) return res.status(403).json({ message: 'Access denied' });

    // A plain copy: the stored request is cleared below, and the requester must still be known afterwards
    const reqState = relationship.typeChangeRequest ? { ...relationship.typeChangeRequest.toObject?.() ?? relationship.typeChangeRequest } : {};
    if (!reqState.requested) return res.status(400).json({ message: 'No pending type change request' });

    // Only the other partner (not requester) can accept
    if (reqState.requestedBy?.toString() === userId) {
      return res.status(400).json({ message: 'You cannot accept your own request' });
    }

    // Apply the type change
    relationship.type = reqState.newType;
    relationship.typeChangeRequest = { requested: false };
    await relationship.save();

    // Notify requester
    await notify({
      recipient: reqState.requestedBy,
      sender: userId,
      type: 'relationship_type_change_accepted',
      title: 'Type Change Accepted',
      message: `Your request to change relationship type to "${relationship.type}" has been accepted`,
      category: 'relationship',
      metadata: { relationshipId: relationship._id, newType: relationship.type }
    }).catch(logNotifyError);

    await resolveActions(req.user.id, relationship._id, ['relationship_type_change_request']);
    res.json({ message: 'Type changed successfully', relationship });
  } catch (error) {
    console.error('Accept type change error:', error);
    res.status(500).json({ message: 'Server error during type change acceptance' });
  }
};

export const declineTypeChange = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;
    const relationship = await Relationship.findById(id);
    if (!relationship) return res.status(404).json({ message: 'Relationship not found' });
    if (!relationship.includesUser(userId)) return res.status(403).json({ message: 'Access denied' });

    // A plain copy: the stored request is cleared below, and the requester must still be known afterwards
    const reqState = relationship.typeChangeRequest ? { ...relationship.typeChangeRequest.toObject?.() ?? relationship.typeChangeRequest } : {};
    if (!reqState.requested) return res.status(400).json({ message: 'No pending type change request' });

    // Only the other partner (not requester) can decline
    if (reqState.requestedBy?.toString() === userId) {
      return res.status(400).json({ message: 'You cannot decline your own request' });
    }

    relationship.typeChangeRequest = { requested: false };
    await relationship.save();

    // Notify requester
    await notify({
      recipient: reqState.requestedBy,
      sender: userId,
      type: 'relationship_type_change_declined',
      title: 'Type Change Declined',
      message: 'Your request to change relationship type was declined',
      category: 'relationship',
      metadata: { relationshipId: relationship._id }
    }).catch(logNotifyError);

    await resolveActions(req.user.id, relationship._id, ['relationship_type_change_request']);
    res.json({ message: 'Type change request declined', relationship });
  } catch (error) {
    console.error('Decline type change error:', error);
    res.status(500).json({ message: 'Server error during type change decline' });
  }
};

export const cancelTypeChangeRequest = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;
    const relationship = await Relationship.findById(id);
    if (!relationship) return res.status(404).json({ message: 'Relationship not found' });
    if (!relationship.includesUser(userId)) return res.status(403).json({ message: 'Access denied' });

    const reqState = relationship.typeChangeRequest || {};
    if (!reqState.requested) return res.status(400).json({ message: 'No pending type change request' });
    if (reqState.requestedBy?.toString() !== userId) {
      return res.status(403).json({ message: 'Only the requester can cancel this' });
    }

    relationship.typeChangeRequest = { requested: false };
    await relationship.save();

    const partnerId = relationship.getPartner(userId);
    if (partnerId) {
      await notify({
        recipient: partnerId,
        sender: userId,
        type: 'relationship_type_change_canceled',
        title: 'Type Change Canceled',
        message: 'The type change request has been canceled',
        category: 'relationship',
        metadata: { relationshipId: relationship._id }
      }).catch(logNotifyError);
    }

    await resolveActions(relationship.getPartner(req.user.id), relationship._id, ['relationship_type_change_request']);
    res.json({ message: 'Type change request canceled', relationship });
  } catch (error) {
    console.error('Cancel type change error:', error);
    res.status(500).json({ message: 'Server error during type change cancelation' });
  }
};

export const acceptRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is the partner (not the initiator)
    if (relationship.partner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the invited partner can accept this relationship' });
    }

    // Check if relationship is still pending
    if (relationship.status !== 'pending') {
      return res.status(400).json({ message: 'Relationship is not pending' });
    }

    // Update relationship status
    relationship.status = 'active';
    relationship.acceptedDate = new Date();
    await relationship.save();

    // Log relationship acceptance
    await logHistory({
      relationshipId: relationship._id,
      eventType: 'accepted',
      actor: req.user.id,
      targetUser: relationship.initiator._id,
      details: { title: relationship.title, type: relationship.type }
    });

    // Populate the relationship data
    await relationship.populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Create notification for initiator
    await notify({
      recipient: relationship.initiator._id,
      sender: req.user.id,
      type: 'relationship_accepted',
      title: 'Relationship Accepted',
      message: `${req.user.firstName} ${req.user.lastName} accepted your "${relationship.title}" relationship invitation`,
      category: 'relationship',
      metadata: {
        relationshipId: relationship._id
      }
    });

    await resolveActions(req.user.id, relationship._id, ['relationship_invite']);
    res.json({
      message: 'Relationship accepted successfully',
      relationship
    });
  } catch (error) {
    console.error('Accept relationship error:', error);
    res.status(500).json({ message: 'Server error during relationship acceptance' });
  }
};

export const declineRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is the partner (not the initiator)
    if (relationship.partner.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the invited partner can decline this relationship' });
    }

    // Check if relationship is still pending
    if (relationship.status !== 'pending') {
      return res.status(400).json({ message: 'Relationship is not pending' });
    }

    // Mark as declined (keep record for UI visibility)
    relationship.status = 'declined';
    relationship.declinedDate = new Date();
    await relationship.save();

    // Log relationship decline
    await logHistory({
      relationshipId: relationship._id,
      eventType: 'declined',
      actor: req.user.id,
      targetUser: relationship.initiator._id,
      details: { title: relationship.title, type: relationship.type }
    });

    // Create notification for initiator
    await notify({
      recipient: relationship.initiator._id,
      sender: req.user.id,
      type: 'relationship_declined',
      title: 'Relationship Declined',
      message: `${req.user.firstName} ${req.user.lastName} declined your "${relationship.title}" relationship invitation`,
      category: 'relationship',
      metadata: {
        relationshipId: relationship._id
      }
    });

    await resolveActions(req.user.id, relationship._id, ['relationship_invite']);
    res.json({
      message: 'Relationship declined successfully',
      relationship
    });
  } catch (error) {
    console.error('Decline relationship error:', error);
    res.status(500).json({ message: 'Server error during relationship decline' });
  }
};

export const deleteRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is part of this relationship
    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // For pending/declined/ended/archived, support per-user dismiss instead of hard delete
    if (['pending', 'declined', 'ended', 'archived'].includes(relationship.status)) {
      const alreadyDismissed = relationship.dismissedBy?.some(u => u.toString() === req.user.id);
      if (!alreadyDismissed) {
        relationship.dismissedBy = [...(relationship.dismissedBy || []), req.user.id];
        await relationship.save();
      }
      return res.json({ message: 'Relationship removed from your view' });
    }

    // Archive instead of delete if relationship is active
    relationship.status = 'archived';
    relationship.endDate = new Date();
    await relationship.save();

    res.json({
      message: 'Relationship archived successfully'
    });
  } catch (error) {
    console.error('Delete relationship error:', error);
    res.status(500).json({ message: 'Server error during relationship deletion' });
  }
};

export const requestBreakup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (relationship.status !== 'active') {
      return res.status(400).json({ message: 'Can only request breakup for active relationships' });
    }

    relationship.status = 'requested_breakup';
    relationship.breakupRequestedBy = req.user.id; // New field
    await relationship.save();

    res.json({
      message: 'Breakup request sent successfully',
      relationship
    });

    const partnerId = relationship.getPartner(req.user.id);
    // No need to await these, let them run in background. If they fail, log it but don't block response.
    notify({
      recipient: partnerId,
      sender: req.user.id,
      type: 'breakup_request',
      title: 'Breakup Request',
      message: `${req.user.firstName} ${req.user.lastName} has requested a breakup for your "${relationship.title}" relationship. Both parties must agree.`, 
      category: 'relationship',
      actionRequired: true,
      actions: [
        { type: 'accept', label: 'Confirm Breakup', url: `/relationships/${relationship._id}/confirm-breakup` },
        { type: 'decline', label: 'Cancel Request', url: `/relationships/${relationship._id}/cancel-breakup-request` } 
      ],
      metadata: {
        relationshipId: relationship._id
      }
    }).catch(notificationError => console.error('Error creating breakup request notification:', notificationError));

    await logHistory({
      relationshipId: relationship._id,
      eventType: 'breakup_requested',
      actor: req.user.id,
      targetUser: partnerId,
      details: { requestedBy: req.user.id }
    });
    
  } catch (error) {
    console.error('Request breakup error:', error);
    res.status(500).json({ message: 'Server error during breakup request' });
  }
};

export const confirmBreakup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const relationship = await Relationship.findById(req.params.id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (relationship.status !== 'requested_breakup') {
      return res.status(400).json({ message: 'Relationship is not in breakup request state' });
    }

    // Ensure the confirming user is not the one who initiated the breakup request
    if (relationship.breakupRequestedBy.toString() === req.user.id) {
      return res.status(400).json({ message: 'You cannot confirm your own breakup request' });
    }

    relationship.status = 'ended';
    relationship.endDate = new Date();
    await relationship.save();

    await resolveActions(req.user.id, relationship._id, ['breakup_request']);
    res.json({
      message: 'Breakup confirmed successfully',
      relationship
    });

    const initiatorId = relationship.breakupRequestedBy;
    // No need to await these, let them run in background. If they fail, log it but don't block response.
    notify({
      recipient: initiatorId,
      sender: req.user.id,
      type: 'breakup_confirmed',
      title: 'Breakup Confirmed',
      message: `${req.user.firstName} ${req.user.lastName} has confirmed the breakup for your "${relationship.title}" relationship. Your relationship has ended.`,
      category: 'relationship',
      metadata: {
        relationshipId: relationship._id
      }
    }).catch(notificationError => console.error('Error creating breakup confirmed notification:', notificationError));

    await logHistory({
      relationshipId: relationship._id,
      eventType: 'breakup_confirmed',
      actor: req.user.id,
      targetUser: initiatorId,
      details: { confirmedBy: req.user.id }
    });
  
  } catch (error) {
    console.error('Confirm breakup error:', error);
    res.status(500).json({ message: 'Server error during breakup confirmation' });
  }
};

export const cancelBreakupRequest = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const userId = req.user.id;

    const relationship = await Relationship.findById(id);

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    // Check if user is part of this relationship
    if (!relationship.includesUser(userId)) {
      return res.status(403).json({ message: 'Not authorized to cancel this request' });
    }

    // Check if a breakup was actually requested
    if (relationship.status !== 'requested_breakup') {
      return res.status(400).json({ message: 'No breakup request pending for this relationship' });
    }

    // Only the user who requested the breakup can cancel it
    if (relationship.breakupRequestedBy.toString() !== userId) {
      return res.status(403).json({ message: 'Only the initiator can cancel the breakup request' });
    }

    // Revert relationship status to active
    relationship.status = 'active';
    relationship.breakupRequestedBy = undefined;
    relationship.breakupRequestedAt = undefined;
    await relationship.save();

    // Log relationship history
    await logHistory({
      relationshipId: relationship._id,
      eventType: 'breakup_request_canceled',
      actor: userId,
      details: { message: 'Breakup request canceled by initiator' }
    });

    // Notify the other partner
    const partnerId = relationship.getPartner(userId);
    if (partnerId) {
      await notify({
        recipient: partnerId,
        sender: userId,
        type: 'breakup_request_canceled',
        title: 'Breakup Request Canceled',
        message: `${req.user.firstName} ${req.user.lastName} has canceled the breakup request for your "${relationship.title}" relationship. Your relationship is now active again.`,
        category: 'relationship',
        metadata: {
          relationshipId: relationship._id
        }
      });
    }

    await resolveActions(relationship.getPartner(req.user.id), relationship._id, ['breakup_request']);
    res.json({
      success: true,
      message: 'Breakup request canceled successfully. Relationship is now active.',
      relationship
    });
  } catch (error) {
    console.error('Cancel breakup request error:', error);
    res.status(500).json({ message: 'Server error during breakup request cancellation' });
  }
};

// A user's history is visible to themselves, or to someone they granted access
// to through a relationship the viewer requested it in.
export const getUserHistory = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { userId } = req.params;
    const requestingUser = req.user.id;

    const targetUser = await User.findById(userId).select('username firstName lastName avatar');
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isSelf = requestingUser.toString() === userId;
    let canAccessHistory = isSelf;
    let grant = null;
    if (!canAccessHistory) {
      grant = await Relationship.findOne({
        $and: [
          {
            $or: [
              { initiator: requestingUser, partner: userId },
              { initiator: userId, partner: requestingUser }
            ]
          },
          {
            $or: [
              { 'historyAccess.expiresAt': { $exists: false } },
              { 'historyAccess.expiresAt': null },
              { 'historyAccess.expiresAt': { $gt: new Date() } }
            ]
          }
        ],
        'historyAccess.granted': true,
        'historyAccess.requestedBy': requestingUser,
        'historyAccess.grantedBy': userId
      });
      canAccessHistory = !!grant;
    }

    if (!canAccessHistory) {
      return res.status(403).json({ message: "Access to this user's history is denied" });
    }

    const history = await RelationshipHistory.find({
      $or: [{ actor: userId }, { targetUser: userId }],
      eventType: { $not: /^history_access/ }
    })
      .populate('relationshipId', 'title type')
      .populate('actor', 'firstName lastName')
      .populate('targetUser', 'firstName lastName')
      .sort({ eventDate: -1 })
      .limit(200);

    // Share what the grant promises: titles, types and dates. People other than the two of
    // you appear only as "Someone", and free-form event details are left out.
    const known = new Set([userId.toString(), requestingUser.toString()]);
    const nameOf = (person) => {
      if (!person) return null;
      return known.has(person._id.toString()) ? `${person.firstName} ${person.lastName}` : 'Someone';
    };
    const shaped = history.map((event) => ({
      _id: event._id,
      eventType: event.eventType,
      eventDate: event.eventDate,
      relationship: event.relationshipId ? { title: event.relationshipId.title, type: event.relationshipId.type } : null,
      actor: nameOf(event.actor),
      targetUser: nameOf(event.targetUser)
    }));

    res.json({
      user: targetUser,
      history: shaped,
      access: isSelf ? { self: true } : { self: false, expiresAt: grant?.historyAccess?.expiresAt ?? null }
    });
  } catch (error) {
    console.error('Get user history error:', error);
    res.status(500).json({ message: 'Server error fetching user history' });
  }
};

export const requestHistoryAccess = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const relationship = await Relationship.findById(req.params.id);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }
    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const access = relationship.historyAccess;
    if (isGrantActive(access) && access.requestedBy?.toString() === req.user.id.toString()) {
      return res.status(400).json({ message: 'You already have access to this history' });
    }
    // Pending means nobody has answered yet; a declined request can be asked again
    const pending = access.requested && !access.granted && !access.grantedAt;
    if (pending && access.requestedBy?.toString() === req.user.id.toString()) {
      return res.status(400).json({ message: 'History access request already sent' });
    }

    // A new request replaces any earlier grant or denial
    relationship.historyAccess = {
      requested: true,
      requestedBy: req.user.id,
      requestedAt: new Date(),
      granted: false
    };
    await relationship.save();

    const partnerId = relationship.getPartner(req.user.id);
    await notify({
      recipient: partnerId,
      sender: req.user.id,
      type: 'history_access_request',
      title: 'History Access Request',
      message: `${req.user.firstName} ${req.user.lastName} wants to view your relationship history`,
      category: 'relationship',
      actionRequired: true,
      actions: [
        { type: 'accept', label: 'Review Request', url: `/relationships/${relationship._id}` },
        { type: 'decline', label: 'Dismiss', url: '/notifications' }
      ],
      metadata: { relationshipId: relationship._id }
    });

    await logHistory({
      relationshipId: relationship._id,
      eventType: 'history_access_requested',
      actor: req.user.id,
      targetUser: partnerId,
      details: { requestedForRelationship: relationship._id }
    });

    res.json({ message: 'History access request sent successfully' });
  } catch (error) {
    console.error('Request history access error:', error);
    res.status(500).json({ message: 'Server error during history access request' });
  }
};

export const grantHistoryAccess = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { granted = true, durationDays } = req.body;
    const relationship = await Relationship.findById(req.params.id);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }
    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const requesterId = relationship.historyAccess?.requestedBy;
    if (!relationship.historyAccess?.requested || !requesterId) {
      return res.status(400).json({ message: 'No history access request pending' });
    }
    // Only the person being asked can answer
    if (requesterId.toString() === req.user.id.toString()) {
      return res.status(403).json({ message: 'You cannot respond to your own request' });
    }

    relationship.historyAccess.granted = !!granted;
    relationship.historyAccess.grantedBy = req.user.id;
    relationship.historyAccess.grantedAt = new Date();
    relationship.historyAccess.expiresAt = granted && durationDays
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : undefined;
    await relationship.save();

    await logHistory({
      relationshipId: relationship._id,
      eventType: granted ? 'history_access_granted' : 'history_access_denied',
      actor: req.user.id,
      targetUser: requesterId,
      details: { grantedAccess: !!granted, relationshipId: relationship._id }
    });

    await notify({
      recipient: requesterId,
      sender: req.user.id,
      type: granted ? 'history_access_granted' : 'history_access_denied',
      title: granted ? 'History Access Granted' : 'History Access Denied',
      message: granted
        ? `${req.user.firstName} ${req.user.lastName} granted you access to view relationship history${durationDays ? ` for ${durationDays} days` : ''}`
        : `${req.user.firstName} ${req.user.lastName} denied your request to view relationship history`,
      category: 'relationship',
      actions: [
        { type: 'view', label: 'View Relationship', url: `/relationships/${relationship._id}` }
      ],
      metadata: { relationshipId: relationship._id }
    });

    res.json({
      message: granted ? 'History access granted successfully' : 'History access denied'
    });
  } catch (error) {
    console.error('Grant history access error:', error);
    res.status(500).json({ message: 'Server error during history access grant' });
  }
};

// Private notes: each person only ever sees their own
const memberOr403 = async (req, res) => {
  const relationship = await Relationship.findById(req.params.id);
  if (!relationship) {
    res.status(404).json({ message: 'Relationship not found' });
    return null;
  }
  if (!relationship.includesUser(req.user.id)) {
    res.status(403).json({ message: 'Access denied' });
    return null;
  }
  return relationship;
};

export const getPrivateNote = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const relationship = await memberOr403(req, res);
    if (!relationship) return;
    const note = await PrivateNote.findOne({ relationship: relationship._id, user: req.user.id });
    res.json({ note: note ? { text: note.text, updatedAt: note.updatedAt } : null });
  } catch (error) {
    console.error('Get private note error:', error);
    res.status(500).json({ message: 'Server error fetching note' });
  }
};

export const savePrivateNote = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const relationship = await memberOr403(req, res);
    if (!relationship) return;

    const text = (req.body.text ?? '').trim();
    if (!text) {
      await PrivateNote.deleteOne({ relationship: relationship._id, user: req.user.id });
      return res.json({ note: null });
    }
    const note = await PrivateNote.findOneAndUpdate(
      { relationship: relationship._id, user: req.user.id },
      { text },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ note: { text: note.text, updatedAt: note.updatedAt } });
  } catch (error) {
    console.error('Save private note error:', error);
    res.status(500).json({ message: 'Server error saving note' });
  }
};
