import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyCertificate, verifyCertificateImage } from '../controllers/certificateController.js';

const router = express.Router();

// Unauthenticated, so keep guessing certificate numbers expensive
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many lookups, please slow down.' }
}));

router.get('/:number/image', verifyCertificateImage);
router.get('/:number', verifyCertificate);

export default router;
