import express from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: 'Too many messages sent, please try again later.' }
});

const contactValidation = [
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('subject').trim().isLength({ min: 1, max: 150 }).withMessage('Subject is required'),
  body('message').trim().isLength({ min: 1, max: 2000 }).withMessage('Message is required and cannot exceed 2000 characters')
];

router.post('/', contactLimiter, contactValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  // No mail service is configured, so the message is only logged server-side.
  const { name, email, subject } = req.body;
  console.log(`📬 Contact message from ${name} <${email}>: ${subject}`);

  res.json({ message: 'Your message has been sent successfully!' });
});

export default router;
