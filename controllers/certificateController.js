import { validationResult } from 'express-validator';
import Certificate from '../models/Certificate.js';
import Relationship from '../models/Relationship.js';
import User from '../models/User.js'; // Import User model to populate user details
import multer from 'multer'; // Import multer
import path from 'path'; // Import path for directory handling
import fs from 'fs'; // Import fs for file system operations
import sharp from 'sharp'; // Import sharp for image manipulation

export const generateCertificateImage = async (certificateDetails) => {
  const { title, description, recipients, type, level, design } = certificateDetails;

  const width = 800;
  const height = 600;
  const backgroundColor = design?.colors?.primary || '#3b82f6'; // Default to blue
  const textColor = design?.colors?.secondary || '#ffffff'; // Default to white
  const fontFamily = 'sans-serif'; // Or a more stylish font if available

  // Create SVG for text elements
  const titleSvg = `<svg width="${width}" height="${height}"><text x="50%" y="150" font-family="${fontFamily}" font-size="48" fill="${textColor}" text-anchor="middle">${title}</text></svg>`;
  const descriptionSvg = `<svg width="${width}" height="${height}"><text x="50%" y="250" font-family="${fontFamily}" font-size="24" fill="${textColor}" text-anchor="middle">${description}</text></svg>`;
  
  const recipientNames = recipients.map(r => r.user.firstName + ' ' + r.user.lastName).join(' & ');
  const recipientSvg = `<svg width="${width}" height="${height}"><text x="50%" y="350" font-family="${fontFamily}" font-size="36" fill="${textColor}" text-anchor="middle">Awarded to: ${recipientNames}</text></svg>`;

  const typeLevelSvg = `<svg width="${width}" height="${height}"><text x="50%" y="450" font-family="${fontFamily}" font-size="20" fill="${textColor}" text-anchor="middle">Type: ${type.replace(/_/g, ' ').toUpperCase()} | Level: ${level.toUpperCase()}</text></svg>`;

  const filename = `certificate-${Date.now()}.png`;
  const outputPath = path.join('uploads', 'certificates', filename);
  const absoluteOutputPath = path.resolve(outputPath);

  try {
    await sharp({
      create: {
        width: width,
        height: height,
        channels: 4,
        background: backgroundColor,
      },
    })
      .composite([
        { input: Buffer.from(titleSvg), gravity: 'northwest' }, // Position title
        { input: Buffer.from(descriptionSvg), gravity: 'northwest' }, // Position description
        { input: Buffer.from(recipientSvg), gravity: 'northwest' }, // Position recipients
        { input: Buffer.from(typeLevelSvg), gravity: 'northwest' }, // Position type/level
      ])
      .toFile(absoluteOutputPath);

    return outputPath; // Return the relative path for database storage
  } catch (error) {
    console.error('Error generating certificate image:', error);
    throw new Error('Failed to generate certificate image');
  }
};

export const generateRelationshipCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params;
    const userId = req.user.id;

    const relationship = await Relationship.findById(relationshipId)
      .populate('initiator', 'firstName lastName')
      .populate('partner', 'firstName lastName');

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    console.log('Current User ID:', userId);
    console.log('Relationship Initiator:', relationship.initiator._id);
    console.log('Relationship Partner:', relationship.partner._id);
    console.log('Includes User Check:', relationship.includesUser(userId));

    if (!relationship.includesUser(userId)) {
      return res.status(403).json({ message: 'Access denied. You are not part of this relationship.' });
    }

    // Ensure both users are available
    if (!relationship.initiator || !relationship.partner) {
      return res.status(500).json({ message: 'Could not retrieve full user details for the relationship.' });
    }

    const initiatorFullName = `${relationship.initiator.firstName} ${relationship.initiator.lastName}`;
    const partnerFullName = `${relationship.partner.firstName} ${relationship.partner.lastName}`;
    const partners = [relationship.initiator, relationship.partner];
    
    // Generate certificate image
    const certificateImageUrl = await generateCertificateImage({
      title: `Certificate of ${relationship.title} Relationship`,
      description: `This certifies the ${relationship.title} relationship between ${initiatorFullName} and ${partnerFullName}, with a current status of '${relationship.status}'.`,
      recipients: partners.map(p => ({ user: p, firstName: p.firstName, lastName: p.lastName })), // Pass full user objects for image generation
      type: 'relationship',
      level: 'gold',
      design: {
        template: 'romantic',
        colors: { primary: '#ec4899', secondary: '#f0abfc', accent: '#f59e0b' },
        icon: 'heart',
      }
    });

    const newCertificate = await Certificate.create({
      relatedTo: 'relationship',
      relatedId: relationship._id,
      title: `Certificate of ${relationship.title} Relationship`,
      description: `This certifies the ${relationship.title} relationship between ${initiatorFullName} and ${partnerFullName}, with a current status of '${relationship.status}'.`,
      type: 'relationship',
      level: 'gold', // Default level for relationship certificates
      recipients: partners.map(p => ({ user: p._id, awardedAt: new Date() })),
      design: {
        template: 'romantic',
        colors: { primary: '#ec4899', secondary: '#f0abfc', accent: '#f59e0b' },
        icon: 'heart',
        backgroundImage: '/images/certificate-background.png',
        imageUrl: certificateImageUrl, // Store the generated image URL
      },
      metadata: {
        issuedBy: 'RelationApp',
        validUntil: null, // Relationship certificates don't usually expire
        customData: { relationshipStatus: relationship.status }
      }
    });

    // Update the relationship with the new certificate ID
    relationship.latestCertificate = newCertificate._id;
    await relationship.save();

    res.status(201).json({
      message: 'Relationship certificate generated successfully',
      certificate: newCertificate
    });

  } catch (error) {
    console.error('Generate relationship certificate error:', error);
    res.status(500).json({ message: 'Server error generating relationship certificate' });
  }
};

export const getCertificates = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { relationshipId } = req.params; // This will be undefined for /certificates
    const { type, level } = req.query;

    const filter = {
      'recipients.user': req.user.id
    };

    // If relationshipId is provided, filter by it and set relatedTo
    if (relationshipId) {
      filter.relatedTo = 'relationship';
      filter.relatedId = relationshipId;
      
      // Additionally, verify relationship exists and user is part of it
      const relationship = await Relationship.findById(relationshipId);
      if (!relationship) {
        return res.status(404).json({ message: 'Relationship not found' });
      }

      if (!relationship.includesUser(req.user.id)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    if (type) filter.type = type;
    if (level) filter.level = level;

    const certificates = await Certificate.find(filter)
      .populate({
        path: 'relatedId',
        select: 'title type initiator partner',
        // Use a dynamic model based on relatedTo for population
        // This requires an explicit model for each relatedTo type that needs population
        // For simplicity, we'll handle only 'relationship' and 'milestone' for now.
        // If relatedTo is not 'relationship' or 'milestone', relatedId will not be populated with a document from the default model.
        // The frontend should then handle cases where relatedId is not fully populated.
        // A more robust solution might involve multiple .populate calls or a virtual populate.
        get model() { 
          if (this.relatedTo === 'relationship') return 'Relationship';
          if (this.relatedTo === 'milestone') return 'Milestone';
          return null; // Don't populate if relatedTo is not a known type
        }
      })
      .populate('recipients.user', 'username firstName lastName avatar')
      .sort({ createdAt: -1 });

    res.json({ certificates });
  } catch (error) {
    console.error('Get certificates error:', error);
    res.status(500).json({ message: 'Server error fetching certificates' });
  }
};

export const getCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const certificate = await Certificate.findById(req.params.id)
      .populate({ path: 'relatedId', select: 'title type initiator partner', model: 'Relationship' })
      .populate('recipients.user', 'username firstName lastName avatar');

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user._id.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Increment view count
    await certificate.incrementView();

    res.json({ certificate });
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({ message: 'Server error fetching certificate' });
  }
};

export const downloadCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const certificate = await Certificate.findById(req.params.id)
      .populate({ path: 'relatedId', select: 'title type', model: 'Relationship' })
      .populate('recipients.user', 'username firstName lastName avatar');

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user._id.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Increment download count
    certificate.stats.downloadCount += 1;
    await certificate.save();

    // In a real implementation, you would generate a PDF or image here
    // For now, we'll return the certificate data with a download flag
    res.json({
      message: 'Certificate ready for download',
      certificate,
      downloadUrl: `/api/certificates/${certificate._id}/file` // This would be the actual file URL
    });
  } catch (error) {
    console.error('Download certificate error:', error);
    res.status(500).json({ message: 'Server error downloading certificate' });
  }
};

export const shareCertificate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { platform } = req.body;

    const certificate = await Certificate.findById(req.params.id);

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is a recipient of this certificate
    const isRecipient = certificate.recipients.some(recipient => 
      recipient.user.equals(req.user.id)
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if certificate is valid
    if (!certificate.isValid()) {
      return res.status(400).json({ message: 'Certificate is no longer valid' });
    }

    // Update sharing stats
    if (platform && !certificate.sharing.sharedOn.includes(platform)) {
      certificate.sharing.sharedOn.push(platform);
    }
    certificate.sharing.shareCount += 1;
    certificate.stats.shareCount += 1;

    await certificate.save();

    res.json({
      message: 'Certificate sharing recorded successfully',
      shareUrl: `${process.env.FRONTEND_URL}/certificates/${certificate._id}/public`
    });
  } catch (error) {
    console.error('Share certificate error:', error);
    res.status(500).json({ message: 'Server error sharing certificate' });
  }
};

// Multer storage configuration for certificate images
const certificateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/certificates';
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `certificate-${Date.now()}${path.extname(file.originalname)}`);
  },
});

export const uploadCertificate = multer({
  storage: certificateStorage,
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
}).single('certificateImage'); // 'certificateImage' is the name of the form field

export const uploadCertificateImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const imageUrl = req.file.path; // Multer saves the path

    res.status(200).json({ message: 'Image uploaded successfully', imageUrl: imageUrl });
  } catch (error) {
    console.error('Upload certificate image error:', error);
    res.status(500).json({ message: error.message || 'Server error uploading certificate image' });
  }
};