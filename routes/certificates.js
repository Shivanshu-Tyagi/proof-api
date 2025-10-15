import express from 'express';
import { param } from 'express-validator';
import {
  getCertificates,
  getCertificate,
  downloadCertificate,
  shareCertificate,
  generateRelationshipCertificate,
  uploadCertificateImage,
  uploadCertificate // Import the uploadCertificate middleware
} from '../controllers/certificateController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getCertificates);
router.post('/relationship/:relationshipId/generate', param('relationshipId').isMongoId(), generateRelationshipCertificate);
router.get('/relationship/:relationshipId', param('relationshipId').isMongoId(), getCertificates);
router.post('/upload-image', uploadCertificate, uploadCertificateImage);
router.get('/:id', param('id').isMongoId(), getCertificate);
router.get('/:id/download', param('id').isMongoId(), downloadCertificate);
router.post('/:id/share', param('id').isMongoId(), shareCertificate);

export default router;