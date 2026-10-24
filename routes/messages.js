import express from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { listThreads, getMessages, sendMessage, markRead } from '../controllers/messageController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', listThreads);
router.get('/:relationshipId', getMessages);
router.post('/:relationshipId/read', markRead);
router.post(
  '/:relationshipId',
  rateLimit({ windowMs: 60 * 1000, max: 30, message: { message: 'You are sending messages too fast. Wait a moment.' } }),
  [body('text').isString().withMessage('Write a message first').bail().trim().isLength({ min: 1, max: 1000 }).withMessage('Messages can be 1 to 1000 characters')],
  sendMessage
);

export default router;
