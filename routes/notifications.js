import express from 'express';
import { param, query } from 'express-validator';
import {
  getNotifications,
  getNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount
} from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/:id', param('id').isMongoId(), getNotification);
router.put('/:id/read', param('id').isMongoId(), markAsRead);
router.put('/mark-all-read', markAllAsRead);
router.delete('/:id', param('id').isMongoId(), deleteNotification);

export default router;