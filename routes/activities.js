import express from 'express';
import { body, param } from 'express-validator';
import {
  createActivity,
  getActivities,
  getActivity,
  updateActivity,
  deleteActivity,
  addReaction,
  addComment,
  getMyAllActivities
} from '../controllers/activityController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

const createActivityValidation = [
  body('relationshipId').isMongoId().withMessage('Invalid relationship ID'),
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title is required and cannot exceed 100 characters'),
  body('type').isIn(['conversation', 'date', 'gift', 'achievement', 'conflict', 'resolution', 'milestone', 'memory', 'goal', 'other']).withMessage('Invalid activity type')
];

// Corrected routes - removed any potential malformed parameters
router.post('/', createActivityValidation, createActivity);
router.get('/mine', getMyAllActivities);
router.get('/relationship/:relationshipId', param('relationshipId').isMongoId(), getActivities);
router.get('/:id', param('id').isMongoId(), getActivity);
router.put('/:id', param('id').isMongoId(), updateActivity);
router.delete('/:id', param('id').isMongoId(), deleteActivity);
router.post('/:id/reaction', param('id').isMongoId(), addReaction);
router.post('/:id/comment', param('id').isMongoId(), addComment);

export default router;