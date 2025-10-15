import express from 'express';
import { body, param } from 'express-validator';
import {
  createTerm,
  getTerms,
  getTerm,
  updateTerm,
  deleteTerm,
  agreeTerm,
  reportViolation
} from '../controllers/termController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

const createTermValidation = [
  body('relationshipId').isMongoId().withMessage('Invalid relationship ID'),
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title is required and cannot exceed 100 characters'),
  body('description').isLength({ min: 1, max: 1000 }).withMessage('Description is required and cannot exceed 1000 characters'),
  body('category').isIn(['communication', 'boundaries', 'expectations', 'goals', 'activities', 'conflict_resolution', 'commitment', 'other']).withMessage('Invalid category')
];

router.post('/', createTermValidation, createTerm);
router.get('/relationship/:relationshipId', param('relationshipId').isMongoId(), getTerms);
router.get('/:id', param('id').isMongoId(), getTerm);
router.put('/:id', param('id').isMongoId(), updateTerm);
router.delete('/:id', param('id').isMongoId(), deleteTerm);
router.post('/:id/agree', param('id').isMongoId(), agreeTerm);
router.post('/:id/violation', param('id').isMongoId(), reportViolation);

export default router;