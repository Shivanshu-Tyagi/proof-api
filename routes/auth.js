import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query } from 'express-validator';
import { getConnectInfo, signup, login, getMe, updateProfile, searchUsers, searchUserByRegistrationId, searchUsersByEmail, changePassword, forgotPassword, resetPassword, uploadProfileImage, upload } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { exportAccountData, deleteAccount } from '../controllers/accountController.js';

const router = express.Router();

// Validation rules
const signupValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters'),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name is required and cannot exceed 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name is required and cannot exceed 50 characters')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const updateProfileValidation = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name cannot exceed 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name cannot exceed 50 characters'),
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  body('dateOfBirth')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('Please provide a valid date')
];

const passwordRule = body('password')
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be between 8 and 128 characters');

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8, max: 128 }).withMessage('Password must be between 8 and 128 characters')
];

// Routes
router.post('/signup', signupValidation, signup);
router.post('/login', loginValidation, login);
router.post('/forgot-password', [body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email')], forgotPassword);
router.post('/reset-password/:token', [param('token').isHexadecimal().isLength({ min: 64, max: 64 }), passwordRule], resetPassword);
router.post('/change-password', authenticate, changePasswordValidation, changePassword);
router.get('/me', authenticate, getMe);
router.get('/export', authenticate, exportAccountData);
router.post('/delete-account', authenticate, [body('password').notEmpty().withMessage('Password is required')], deleteAccount);
router.put('/profile', authenticate, updateProfileValidation, updateProfile);
router.post('/upload-profile-image', authenticate, upload, uploadProfileImage); // New route for profile image upload
router.get('/search/email', authenticate, searchUsersByEmail);
// Public, so keep guessing links expensive
router.get('/connect/:registrationId', rateLimit({ windowMs: 60 * 1000, max: 30, message: { message: 'Too many lookups, please slow down.' } }), getConnectInfo);

router.get('/search', authenticate, (req, res, next) => (
  req.query.registrationId ? searchUserByRegistrationId(req, res) : next()
), [
  query('q').isString().trim().notEmpty().withMessage('Search query cannot be empty.')
], searchUsers);

export default router;