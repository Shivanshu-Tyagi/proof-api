import express from 'express';
import { body, param, query } from 'express-validator';
import {
  createRelationship,
  getRelationships,
  getRelationship,
  updateRelationship,
  deleteRelationship,
  acceptRelationship,
  declineRelationship,
  requestTypeChange,
  acceptTypeChange,
  declineTypeChange,
  cancelTypeChangeRequest,
  // requestHistoryAccess,
  // grantHistoryAccess,
  requestBreakup,
  confirmBreakup,
  // getUserHistory,
  cancelBreakupRequest
} from '../controllers/relationshipController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Validation rules
const createRelationshipValidation = [
  body('partnerEmail')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid partner email'),
  body('title')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Title is required and cannot exceed 100 characters'),
  body('type')
    .optional()
    .isIn(['acquaintance', 'friend', 'close_friend', 'best_friend', 'romantic_interest', 'partner', 'engaged', 'married', 'family', 'mentor', 'mentee'])
    .withMessage('Invalid relationship type'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

const updateRelationshipValidation = [
  param('id').isMongoId().withMessage('Invalid relationship ID'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Title cannot exceed 100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('privacy')
    .optional()
    .isIn(['public', 'friends', 'private'])
    .withMessage('Invalid privacy setting')
];

const typeChangeValidation = [
  param('id').isMongoId().withMessage('Invalid relationship ID'),
  body('newType')
    .isIn(['acquaintance', 'friend', 'close_friend', 'best_friend', 'romantic_interest', 'partner', 'engaged', 'married', 'family', 'mentor', 'mentee'])
    .withMessage('Invalid relationship type'),
  body('message')
    .optional()
    .isLength({ max: 500 })
];

// Routes
router.post('/', createRelationshipValidation, createRelationship);
router.get('/', getRelationships);
router.get('/:id', param('id').isMongoId(), getRelationship);
router.put('/:id', updateRelationshipValidation, updateRelationship);
router.delete('/:id', param('id').isMongoId(), deleteRelationship);
router.post('/:id/accept', param('id').isMongoId(), acceptRelationship);
router.post('/:id/decline', param('id').isMongoId(), declineRelationship);
router.post('/:id/request-breakup', param('id').isMongoId(), requestBreakup);
router.post('/:id/confirm-breakup', param('id').isMongoId(), confirmBreakup);
router.post('/:id/cancel-breakup-request', param('id').isMongoId(), cancelBreakupRequest);
router.post('/:id/request-type-change', typeChangeValidation, requestTypeChange);
router.post('/:id/accept-type-change', param('id').isMongoId(), acceptTypeChange);
router.post('/:id/decline-type-change', param('id').isMongoId(), declineTypeChange);
router.post('/:id/cancel-type-change', param('id').isMongoId(), cancelTypeChangeRequest);
// router.get('/history/:userId', param('userId').isMongoId(), getUserHistory);
// router.post('/:id/request-history-access', param('id').isMongoId(), requestHistoryAccess);
// router.post('/:id/grant-history-access', param('id').isMongoId(), grantHistoryAccess);

export default router;