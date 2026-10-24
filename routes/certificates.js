// routes/certificates.js
import express from 'express';
import { body, param } from 'express-validator';
import {
  getCertificates,
  getCertificate,
  generateRelationshipCertificate,
  downloadCertificateFile,
  getCertificateImage,
  // trackDownload,
  trackShare,
  setSharing
} from '../controllers/certificateController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Middleware for logging
router.use((req, res, next) => {
  console.log(`📋 [CERT] ${req.method} ${req.path}`);
  next();
});

// ========== GET ROUTES ==========

/**
 * GET /api/certificates
 * Get all certificates for current user
 */
router.get('/', getCertificates);

/**
 * GET /api/certificates/relationship/:relationshipId
 * Get certificates for specific relationship
 */
router.get(
  '/relationship/:relationshipId',
  param('relationshipId').isMongoId(),
  getCertificates
);

// ========== POST ROUTES ==========

/**
 * POST /api/certificates/relationship/:relationshipId/generate
 * Generate new certificate
 */
router.post(
  '/relationship/:relationshipId/generate',
  param('relationshipId').isMongoId(),
  generateRelationshipCertificate
);

/**
 * POST /api/certificates/:id/share
 * Track share
 */
router.post(
  '/:id/share',
  param('id').isMongoId(),
  trackShare
);

/**
 * PUT /api/certificates/:id/sharing
 * Switch the public verify link on or off
 */
router.put(
  '/:id/sharing',
  param('id').isMongoId(),
  body('isPublic').isBoolean().withMessage('isPublic must be true or false'),
  setSharing
);

// ========== FILE DOWNLOAD (MUST BE BEFORE GET /:id) ==========

/**
 * GET /api/certificates/:id/image
 * The certificate artwork (SVG) for its holders to view. Not counted as a download.
 */
router.get('/:id/image', param('id').isMongoId(), getCertificateImage);

/**
 * GET /api/certificates/:id/download
 * Download the certificate as a PNG and count the download
 */
router.get(
  '/:id/download',
  param('id').isMongoId(),
  downloadCertificateFile
);

// ========== GET SINGLE CERTIFICATE (MUST BE LAST) ==========

/**
 * GET /api/certificates/:id
 * Get certificate details
 */
router.get(
  '/:id',
  param('id').isMongoId(),
  getCertificate
);

export default router;