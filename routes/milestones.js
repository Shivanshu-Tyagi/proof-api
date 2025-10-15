import express from 'express';
import { body, param } from 'express-validator';
import {
  createMilestone,
  getMilestones,
  getMilestone,
  updateMilestone,
  deleteMilestone,
  completeMilestone,
  addEvidence
} from '../controllers/milestoneController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

const createMilestoneValidation = [
  body('relationshipId').isMongoId().withMessage('Invalid relationship ID'),
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title is required and cannot exceed 100 characters'),
  body('category').isIn(['time_based', 'activity_based', 'trust_based', 'communication', 'commitment', 'achievement', 'celebration', 'custom']).withMessage('Invalid category')
];

router.post('/', createMilestoneValidation, createMilestone);
router.get('/relationship/:relationshipId', param('relationshipId').isMongoId(), getMilestones);
router.get('/:id', param('id').isMongoId(), getMilestone);
router.put('/:id', param('id').isMongoId(), updateMilestone);
router.delete('/:id', param('id').isMongoId(), deleteMilestone);
router.post('/:id/complete', param('id').isMongoId(), completeMilestone);
router.post('/:id/evidence', param('id').isMongoId(), addEvidence);

export default router;