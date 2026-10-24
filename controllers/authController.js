import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getJwtSecret, getFrontendUrls } from '../config.js';
import { sendMail } from '../utils/mailer.js';
import { validationResult } from 'express-validator';
import User from '../models/User.js';
import multer from 'multer'; // Import multer
import path from 'path'; // Import path for directory handling
import fs from 'fs'; // Import fs for file system operations

const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

export const signup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    const { username, email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });
    if (existingUser) {
      return res.status(400).json({
        message: existingUser.email === email 
          ? 'Email already registered' 
          : 'Username already taken'
      });
    }
    // Create new user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName
    });

    await user.save();
    

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        registrationId: user.registrationId,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error during signup' });
  }
};

export const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        registrationId: user.registrationId,
        avatar: user.avatar,
        preferences: user.preferences
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        registrationId: user.registrationId,
        avatar: user.avatar,
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        preferences: user.preferences,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const allowedUpdates = ['firstName', 'lastName', 'bio', 'avatar', 'dateOfBirth', 'preferences'];
    const updates = {};

    // Only include allowed fields
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        registrationId: user.registrationId,
        avatar: user.avatar,
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        preferences: user.preferences
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error during profile update' });
  }
};

// Multer storage configuration for profile avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/avatars';
    // Create directory if it doesn't exist
    fs.mkdirSync(uploadPath, { recursive: true }); 
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `avatar-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({ 
  storage: avatarStorage, 
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit 
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpeg, jpg, png, gif) are allowed'));
  }
 }).single('avatar'); // 'avatar' is the name of the form field

export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const avatarPath = req.file.path; // Multer saves the path

    // Update the user's avatar field in the database
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: avatarPath },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'Profile image uploaded successfully', imageUrl: avatarPath });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({ message: error.message || 'Server error uploading profile image' });
  }
};

export const searchUsers = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    const { q } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        message: 'Search query is required'
      });
    }
    
    // Match on name or username only. Email addresses are never searchable or returned.
    const safeQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { username: { $regex: safeQ, $options: 'i' } },
        { firstName: { $regex: safeQ, $options: 'i' } },
        { lastName: { $regex: safeQ, $options: 'i' } }
      ],
      _id: { $ne: req.user.id } // Exclude the current user from search results
    }).select('firstName lastName username avatar bio createdAt').limit(20);

    res.json({
      success: true,
      users: users.map(user => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Server error during user search' });
  }
};

// Find a single user by registration ID
export const searchUserByRegistrationId = async (req, res) => {
  try {
    const { registrationId } = req.query;
    if (!registrationId || registrationId.length < 8 || registrationId.length > 12) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: [{
          type: 'field',
          value: registrationId || '',
          msg: 'Registration ID must be between 8 and 12 characters',
          path: 'registrationId',
          location: 'query'
        }]
      });
    }

    const user = await User.findOne({ registrationId }).select('firstName lastName username avatar bio registrationId');
    if (!user) {
      return res.status(404).json({ message: 'User not found with this registration ID' });
    }

    res.status(200).json({
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        registrationId: user.registrationId
      }
    });
  } catch (error) {
    console.error('Search by registration ID error:', error);
    res.status(500).json({ message: 'Server error during user search' });
  }
};

// Confirms whether a full email address belongs to someone, without ever returning it.
// Exact match only, so it cannot be used to browse or guess at addresses.
export const searchUsersByEmail = async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(q)) {
      return res.json({ users: [] });
    }
    const user = await User.findOne({ email: q, _id: { $ne: req.user.id }, isActive: true })
      .select('firstName lastName username avatar');

    res.json({
      users: user ? [{
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatar: user.avatar
      }] : []
    });
  } catch (error) {
    console.error('Search users by email error:', error);
    res.status(500).json({ message: 'Server error during email search' });
  }
};


const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const userPayload = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: user.fullName,
  registrationId: user.registrationId,
  avatar: user.avatar,
  preferences: user.preferences
});

export const changePassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    // Other sessions are invalidated; hand this session a fresh token
    res.json({ message: 'Password changed successfully', token: generateToken(user._id) });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error changing password' });
  }
};

// Always answers the same way so the endpoint can't be used to discover accounts
export const forgotPassword = async (req, res) => {
  const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const user = await User.findOne({ email: req.body.email, isActive: true });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.passwordResetToken = sha256(token);
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save({ validateBeforeSave: false });

      const link = `${getFrontendUrls()[0]}/reset-password/${token}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your password',
        text: `Hi ${user.firstName},\n\nUse the link below to reset your password. It expires in 1 hour.\n\n${link}\n\nIf you did not request this, you can ignore this email.`
      });
    }
    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    // Don't reveal whether the lookup or the mail step failed
    res.json(genericResponse);
  }
};

export const resetPassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const user = await User.findOne({
      passwordResetToken: sha256(req.params.token),
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired' });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully', token: generateToken(user._id), user: userPayload(user) });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error resetting password' });
  }
};
