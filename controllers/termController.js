import { validationResult } from 'express-validator';
import Term from '../models/Term.js';
import Relationship from '../models/Relationship.js';
import Notification from '../models/Notification.js';

export const createTerm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId, title, description, category, priority = 'medium', expiresAt } = req.body;

    // Verify relationship exists and user is part of it
    const relationship = await Relationship.findById(relationshipId);
    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (relationship.status !== 'active') {
      return res.status(400).json({ message: 'Can only create terms for active relationships' });
    }

    const term = new Term({
      relationship: relationshipId,
      createdBy: req.user.id,
      title,
      description,
      category,
      priority,
      expiresAt
    });

    await term.save();
    await term.populate([
      { path: 'relationship', select: 'title type' },
      { path: 'createdBy', select: 'username firstName lastName avatar' }
    ]);

    // Notify the other person in the relationship
    const partnerId = relationship.getPartner(req.user.id);
    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'term_proposed',
      title: 'New Term Proposed',
      message: `${req.user.firstName} ${req.user.lastName} proposed a new term: "${title}"`,
      category: 'relationship',
      actionRequired: true,
      actions: [
        { type: 'view', label: 'Review Term', url: `/terms/${term._id}` }
      ],
      metadata: {
        termId: term._id,
        relationshipId: relationshipId
      }
    });

    res.status(201).json({
      message: 'Term created successfully',
      term
    });
  } catch (error) {
    console.error('Create term error:', error);
    res.status(500).json({ message: 'Server error during term creation' });
  }
};

export const getTerms = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params;
    const { status, category } = req.query;

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

    const terms = await Term.find(filter)
      .populate('createdBy', 'username firstName lastName avatar')
      .populate('agreedBy.user', 'username firstName lastName avatar')
      .sort({ createdAt: -1 });

    res.json({ terms });
  } catch (error) {
    console.error('Get terms error:', error);
    res.status(500).json({ message: 'Server error fetching terms' });
  }
};

export const getTerm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const term = await Term.findById(req.params.id)
      .populate('relationship', 'title type initiator partner')
      .populate('createdBy', 'username firstName lastName avatar')
      .populate('agreedBy.user', 'username firstName lastName avatar')
      .populate('violations.reportedBy', 'username firstName lastName avatar');

    if (!term) {
      return res.status(404).json({ message: 'Term not found' });
    }

    // Check if user is part of the relationship
    if (!term.relationship.initiator.equals(req.user.id) && !term.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ term });
  } catch (error) {
    console.error('Get term error:', error);
    res.status(500).json({ message: 'Server error fetching term' });
  }
};

export const updateTerm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const term = await Term.findById(req.params.id).populate('relationship');

    if (!term) {
      return res.status(404).json({ message: 'Term not found' });
    }

    // Only creator can update the term
    if (!term.createdBy.equals(req.user.id)) {
      return res.status(403).json({ message: 'Only the creator can update this term' });
    }

    // Can't update if already agreed by both parties
    if (term.status === 'agreed') {
      return res.status(400).json({ message: 'Cannot update agreed terms' });
    }

    const allowedUpdates = ['title', 'description', 'category', 'priority', 'expiresAt'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // Reset agreements if term is modified
    if (Object.keys(updates).length > 0) {
      updates.status = 'modified';
      updates.agreedBy = [];
    }

    const updatedTerm = await Term.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate([
      { path: 'relationship', select: 'title type' },
      { path: 'createdBy', select: 'username firstName lastName avatar' }
    ]);

    res.json({
      message: 'Term updated successfully',
      term: updatedTerm
    });
  } catch (error) {
    console.error('Update term error:', error);
    res.status(500).json({ message: 'Server error during term update' });
  }
};

export const agreeTerm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { signature } = req.body;

    const term = await Term.findById(req.params.id).populate('relationship');

    if (!term) {
      return res.status(404).json({ message: 'Term not found' });
    }

    // Check if user is part of the relationship
    if (!term.relationship.initiator.equals(req.user.id) && !term.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has already agreed
    if (term.hasUserAgreed(req.user.id)) {
      return res.status(400).json({ message: 'You have already agreed to this term' });
    }

    // Add agreement
    term.agreedBy.push({
      user: req.user.id,
      signature: signature || `${req.user.firstName} ${req.user.lastName}`
    });

    // Check if both parties have agreed
    if (term.agreedBy.length >= 2) {
      term.status = 'agreed';
    }

    await term.save();
    await term.populate([
      { path: 'createdBy', select: 'username firstName lastName avatar' },
      { path: 'agreedBy.user', select: 'username firstName lastName avatar' }
    ]);

    // Notify the other person
    const partnerId = term.relationship.initiator.equals(req.user.id) 
      ? term.relationship.partner 
      : term.relationship.initiator;

    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'term_agreed',
      title: 'Term Agreement',
      message: `${req.user.firstName} ${req.user.lastName} agreed to the term: "${term.title}"`,
      category: 'relationship',
      metadata: {
        termId: term._id,
        relationshipId: term.relationship._id
      }
    });

    res.json({
      message: 'Term agreement recorded successfully',
      term
    });
  } catch (error) {
    console.error('Agree term error:', error);
    res.status(500).json({ message: 'Server error during term agreement' });
  }
};

export const reportViolation = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { description, severity = 'minor' } = req.body;

    const term = await Term.findById(req.params.id).populate('relationship');

    if (!term) {
      return res.status(404).json({ message: 'Term not found' });
    }

    // Check if user is part of the relationship
    if (!term.relationship.initiator.equals(req.user.id) && !term.relationship.partner.equals(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Add violation report
    term.violations.push({
      reportedBy: req.user.id,
      description,
      severity
    });

    await term.save();

    // Notify the other person
    const partnerId = term.relationship.initiator.equals(req.user.id) 
      ? term.relationship.partner 
      : term.relationship.initiator;

    await Notification.create({
      recipient: partnerId,
      sender: req.user.id,
      type: 'term_violated',
      title: 'Term Violation Reported',
      message: `${req.user.firstName} ${req.user.lastName} reported a violation of the term: "${term.title}"`,
      category: 'relationship',
      priority: severity === 'severe' ? 'urgent' : 'high',
      actionRequired: true,
      metadata: {
        termId: term._id,
        relationshipId: term.relationship._id
      }
    });

    res.json({
      message: 'Violation reported successfully'
    });
  } catch (error) {
    console.error('Report violation error:', error);
    res.status(500).json({ message: 'Server error during violation report' });
  }
};

export const deleteTerm = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const term = await Term.findById(req.params.id);

    if (!term) {
      return res.status(404).json({ message: 'Term not found' });
    }

    // Only creator can delete the term
    if (!term.createdBy.equals(req.user.id)) {
      return res.status(403).json({ message: 'Only the creator can delete this term' });
    }

    // Can't delete if already agreed by both parties
    if (term.status === 'agreed') {
      return res.status(400).json({ message: 'Cannot delete agreed terms' });
    }

    await Term.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Term deleted successfully'
    });
  } catch (error) {
    console.error('Delete term error:', error);
    res.status(500).json({ message: 'Server error during term deletion' });
  }
};