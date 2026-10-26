import express from 'express';
import { body, query } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { callerKey } from '../middleware/rateLimits.js';
import { listFeedback, createFeedback, toggleSupport, deleteFeedback, updateFeedbackStatus } from '../controllers/feedbackController.js';

const router = express.Router();
router.use(authenticate);

const TYPES = ['problem', 'idea', 'other'];
const STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'];

router.get(
  '/',
  [
    query('sort').optional().isIn(['top', 'new']).withMessage('sort must be top or new'),
    query('type').optional().isIn(TYPES).withMessage('Unknown type'),
    query('status').optional().isIn(STATUSES).withMessage('Unknown status'),
    query('q').optional().isString().isLength({ max: 100 }).withMessage('Search is too long'),
    query('match').optional().isIn(['all', 'any']).withMessage('match must be all or any'),
    query('page').optional().isInt({ min: 1, max: 1000 }).withMessage('Invalid page')
  ],
  listFeedback
);

router.post(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: callerKey, message: { message: 'You have sent a lot of feedback this hour. Please try again later.' } }),
  [
    body('type').isIn(TYPES).withMessage('Choose what kind of feedback this is'),
    body('title').isString().withMessage('Add a short title').bail().trim().isLength({ min: 4, max: 100 }).withMessage('The title should be 4 to 100 characters'),
    body('body').isString().withMessage('Add some details').bail().trim().isLength({ min: 10, max: 1000 }).withMessage('The details should be 10 to 1000 characters'),
    body('anonymous').optional().isBoolean().withMessage('anonymous must be true or false')
  ],
  createFeedback
);

router.post('/:id/support', toggleSupport);
router.delete('/:id', deleteFeedback);
router.patch(
  '/:id',
  [
    body('status').optional().isIn(STATUSES).withMessage('Unknown status'),
    body('response').optional().isString().isLength({ max: 500 }).withMessage('The reply can be up to 500 characters')
  ],
  updateFeedbackStatus
);

export default router;
