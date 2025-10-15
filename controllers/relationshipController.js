import { validationResult } from 'express-validator';
import Relationship from '../models/Relationship.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
// import RelationshipHistory from '../models/RelationshipHistory.js';

export const createRelationship = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { partnerEmail, title, type = 'acquaintance', description = '' } = req.body;

    // Find partner by email
    const partner = await User.findOne({ email: partnerEmail });
    if (!partner) {
      return res.status(404).json({ message: 'User not found with this email' });
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
    // await RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'created',
    //   actor: req.user.id,
    //   targetUser: partner._id,
    //   details: { title: relationship.title, type: relationship.type }
    // });

    // Create notification for partner
    await Notification.create({
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
      // .populate({
      //   path: 'historyAccess.requestedBy',
      //   select: 'username firstName lastName avatar'
      // })
      // .populate({
      //   path: 'historyAccess.grantedBy',
      //   select: 'username firstName lastName avatar'
      // })
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
      // .populate({
      //   path: 'historyAccess.requestedBy',
      //   select: 'username firstName lastName avatar'
      // })
      // .populate({
      //   path: 'historyAccess.grantedBy',
      //   select: 'username firstName lastName avatar'
      // });

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

    const updatedRelationship = await Relationship.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Log relationship update
    // await RelationshipHistory.create({
    //   relationshipId: updatedRelationship._id,
    //   eventType: 'updated',
    //   actor: req.user.id,
    //   targetUser: updatedRelationship.getPartner(req.user.id),
    //   details: { updates: updates }
    // });

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
    Notification.create({
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
    }).catch(() => {});

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

    const reqState = relationship.typeChangeRequest || {};
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
    Notification.create({
      recipient: reqState.requestedBy,
      sender: userId,
      type: 'relationship_type_change_accepted',
      title: 'Type Change Accepted',
      message: `Your request to change relationship type to "${relationship.type}" has been accepted`,
      category: 'relationship',
      metadata: { relationshipId: relationship._id, newType: relationship.type }
    }).catch(() => {});

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

    const reqState = relationship.typeChangeRequest || {};
    if (!reqState.requested) return res.status(400).json({ message: 'No pending type change request' });

    // Only the other partner (not requester) can decline
    if (reqState.requestedBy?.toString() === userId) {
      return res.status(400).json({ message: 'You cannot decline your own request' });
    }

    relationship.typeChangeRequest = { requested: false };
    await relationship.save();

    // Notify requester
    Notification.create({
      recipient: reqState.requestedBy,
      sender: userId,
      type: 'relationship_type_change_declined',
      title: 'Type Change Declined',
      message: 'Your request to change relationship type was declined',
      category: 'relationship',
      metadata: { relationshipId: relationship._id }
    }).catch(() => {});

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
      Notification.create({
        recipient: partnerId,
        sender: userId,
        type: 'relationship_type_change_canceled',
        title: 'Type Change Canceled',
        message: 'The type change request has been canceled',
        category: 'relationship',
        metadata: { relationshipId: relationship._id }
      }).catch(() => {});
    }

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
    // await RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'accepted',
    //   actor: req.user.id,
    //   targetUser: relationship.initiator._id,
    //   details: { title: relationship.title, type: relationship.type }
    // });

    // Populate the relationship data
    await relationship.populate([
      { path: 'initiator', select: 'username firstName lastName avatar' },
      { path: 'partner', select: 'username firstName lastName avatar' }
    ]);

    // Create notification for initiator
    await Notification.create({
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
    // await RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'declined',
    //   actor: req.user.id,
    //   targetUser: relationship.initiator._id,
    //   details: { title: relationship.title, type: relationship.type }
    // });

    // Create notification for initiator
    await Notification.create({
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
    Notification.create({
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

    // RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'breakup_requested',
    //   actor: req.user.id,
    //   targetUser: partnerId,
    //   details: { requestedBy: req.user.id }
    // }).catch(historyError => console.error('Error creating breakup request history:', historyError));
    
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

    res.json({
      message: 'Breakup confirmed successfully',
      relationship
    });

    const initiatorId = relationship.breakupRequestedBy;
    // No need to await these, let them run in background. If they fail, log it but don't block response.
    Notification.create({
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

    // RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'breakup_confirmed',
    //   actor: req.user.id,
    //   targetUser: initiatorId,
    //   details: { confirmedBy: req.user.id }
    // }).catch(historyError => console.error('Error creating breakup confirmed history:', historyError));
  
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
    // await RelationshipHistory.create({
    //   relationshipId: relationship._id,
    //   eventType: 'breakup_request_canceled',
    //   initiatedBy: userId,
    //   details: { message: 'Breakup request canceled by initiator' }
    // });

    // Notify the other partner
    const partnerId = relationship.getPartner(userId);
    if (partnerId) {
      await Notification.create({
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

// export const getUserHistory = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const requestingUser = req.user.id;

//     const targetUser = await User.findById(userId);
//     if (!targetUser) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     let canAccessHistory = false;
//     if (targetUser.historyPrivacy === 'public') {
//       canAccessHistory = true;
//     } else if (targetUser.historyPrivacy === 'granted_only') {
//       // Check if the requesting user has been explicitly granted access
//       // This will require a new field on User model or a separate collection for grants
//       // For now, we will assume this is handled on a relationship-by-relationship basis
//       // We'll refine this when we implement the user-specific history access grant/revoke

//       // For the scope of relationship history, if they are/were in a relationship and access was granted for that specific relationship.
//       const existingRelationship = await Relationship.findOne({
//         $or: [
//           { initiator: requestingUser, partner: targetUser._id },
//           { initiator: targetUser._id, partner: requestingUser }
//         ],
//         'historyAccess.granted': true
//       });
//       if (existingRelationship) {
//         canAccessHistory = true;
//       }
//     }

//     if (!canAccessHistory) {
//       return res.status(403).json({ message: 'Access to this user\'s history is denied' });
//     }

//     const history = await RelationshipHistory.find({
//       $or: [
//         { actor: targetUser._id },
//         { targetUser: targetUser._id }
//       ]
//     })
//     .populate('relationshipId', 'title type')
//     .populate('actor', 'username firstName lastName avatar')
//     .populate('targetUser', 'username firstName lastName avatar')
//     .sort({ eventDate: -1 });

//     res.json({ history });

//   } catch (error) {
//     console.error('Get user history error:', error);
//     res.status(500).json({ message: 'Server error fetching user history' });
//   }
// };

// export const requestHistoryAccess = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         message: 'Validation failed',
//         errors: errors.array()
//       });
//     }

//     const relationship = await Relationship.findById(req.params.id);

//     if (!relationship) {
//       return res.status(404).json({ message: 'Relationship not found' });
//     }

//     // Check if user is part of this relationship
//     if (!relationship.includesUser(req.user.id)) {
//       return res.status(403).json({ message: 'Access denied' });
//     }

//     // Update history access request
//     relationship.historyAccess.requested = true;
//     relationship.historyAccess.requestedBy = req.user.id;
//     relationship.historyAccess.requestedAt = new Date();
//     await relationship.save();

//     // Notify the other person
//     const partnerId = relationship.getPartner(req.user.id);
//     await Notification.create({
//       recipient: partnerId,
//       sender: req.user.id,
//       type: 'history_access_request',
//       title: 'History Access Request',
//       message: `${req.user.firstName} ${req.user.lastName} wants to view your relationship history`,
//       category: 'relationship',
//       actionRequired: true,
//       actions: [
//         { type: 'accept', label: 'Review Request', url: `/relationships/${relationship._id}` },
//         { type: 'decline', label: 'Dismiss', url: `/notifications` } // Changed to /notifications as a placeholder or dismiss action
//       ],
//       metadata: {
//         relationshipId: relationship._id
//       }
//     });

//     await RelationshipHistory.create({
//       relationshipId: relationship._id,
//       eventType: 'history_access_requested',
//       actor: req.user.id,
//       targetUser: partnerId,
//       details: { requestedForRelationship: relationship._id }
//     });

//     res.json({
//       message: 'History access request sent successfully'
//     });
//   } catch (error) {
//     console.error('Request history access error:', error);
//     res.status(500).json({ message: 'Server error during history access request' });
//   }
// };

// export const grantHistoryAccess = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         message: 'Validation failed',
//         errors: errors.array()
//       });
//     }

//     const { granted = true } = req.body;
//     const relationship = await Relationship.findById(req.params.id);

//     if (!relationship) {
//       return res.status(404).json({ message: 'Relationship not found' });
//     }

//     // Check if user is part of this relationship
//     if (!relationship.includesUser(req.user.id)) {
//       return res.status(403).json({ message: 'Access denied' });
//     }

//     // Update history access grant
//     relationship.historyAccess.requested = true;
//     relationship.historyAccess.granted = granted;
//     relationship.historyAccess.grantedBy = req.user.id;
//     relationship.historyAccess.grantedAt = new Date();
//     await relationship.save();

//     // Log history access granted/denied event
//     await RelationshipHistory.create({
//       relationshipId: relationship._id,
//       eventType: granted ? 'history_access_granted' : 'history_access_denied',
//       actor: req.user.id,
//       targetUser: relationship.historyAccess.requestedBy,
//       details: { grantedAccess: granted, relationshipId: relationship._id }
//     });

//     // Notify the requester
//     const requesterId = relationship.historyAccess.requestedBy;
//     if (requesterId) {
//       await Notification.create({
//         recipient: requesterId,
//         sender: req.user.id,
//         type: granted ? 'history_access_granted' : 'history_access_denied',
//         title: granted ? 'History Access Granted' : 'History Access Denied',
//         message: granted 
//           ? `${req.user.firstName} ${req.user.lastName} granted you access to view relationship history`
//           : `${req.user.firstName} ${req.user.lastName} denied your request to view relationship history`,
//         category: 'relationship',
//         actions: [
//           { type: 'view', label: 'View Relationship', url: `/relationships/${relationship._id}` }
//         ],
//         metadata: {
//           relationshipId: relationship._id
//         }
//       });
//     }

//     res.json({
//       message: granted ? 'History access granted successfully' : 'History access denied'
//     });
//   } catch (error) {
//     console.error('Grant history access error:', error);
//     res.status(500).json({ message: 'Server error during history access grant' });
//   }
// };