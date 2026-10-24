import mongoose from 'mongoose';
import { validationResult } from 'express-validator';
import Certificate from '../models/Certificate.js';
import Relationship from '../models/Relationship.js';
import Milestone from '../models/Milestone.js';
import { certificatePng, certificateSvg } from '../utils/certificateArt.js';

const idOf = (v) => String(v?._id ?? v);

// Everything the artwork needs. The public version carries no relationship title or dates.
const artDataFor = async (certificate, { isPublic = false } = {}) => {
  await certificate.populate('recipients.user', 'firstName lastName');
  const data = {
    names: certificate.recipients.map((r) => `${r.user?.firstName ?? ''} ${r.user?.lastName ?? ''}`.trim()).filter(Boolean),
    level: certificate.level,
    number: certificate.metadata?.certificateNumber,
    issuedAt: certificate.createdAt,
    kind: certificate.relatedTo === 'milestone' ? 'milestone' : 'relationship',
    isPublic,
  };
  if (!isPublic) {
    const longDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (certificate.relatedTo === 'milestone') {
      const milestone = await Milestone.findById(certificate.relatedId).select('title completedDate');
      data.kind = 'milestone';
      data.subject = milestone?.title ?? certificate.title.replace(/ Achievement$/, '');
      data.dateLine = milestone?.completedDate ? `Completed ${longDate(milestone.completedDate)}` : '';
    } else {
      const relationship = certificate.relatedTo === 'relationship' ? await Relationship.findById(certificate.relatedId).select('title acceptedDate startDate') : null;
      const since = relationship?.acceptedDate ?? relationship?.startDate;
      data.subject = relationship?.title ?? certificate.title.replace(/^Certificate of /, '');
      data.dateLine = since ? `Together since ${longDate(since)}` : '';
    }
  }
  return data;
};

// Generate relationship certificate
export const generateRelationshipCertificate = async (req, res) => {
  try {
    const { relationshipId } = req.params;
    const userId = req.user.id;

    const relationship = await Relationship.findById(relationshipId)
      .populate('initiator', 'firstName lastName')
      .populate('partner', 'firstName lastName');

    if (!relationship) {
      return res.status(404).json({ message: 'Relationship not found' });
    }

    if (!relationship.includesUser(userId)) {
      return res.status(403).json({ message: 'You are not part of this relationship' });
    }

    // Check if certificate already exists
    let certificate = null;
    if (relationship.latestCertificate) {
      certificate = await Certificate.findById(relationship.latestCertificate);
      if (certificate && !certificate.metadata.isRevoked) {
        console.log(`ℹ️  Certificate already exists: ${certificate._id}`);
        return res.status(200).json({
          message: 'Certificate already exists',
          certificate
        });
      }
    }

    const partners = [relationship.initiator, relationship.partner];

    // Create certificate record
    certificate = await Certificate.create({
      relatedTo: 'relationship',
      relatedId: relationship._id,
      title: `Certificate of ${relationship.title}`,
      description: `Celebrating the ${relationship.title} between ${relationship.initiator.firstName} ${relationship.initiator.lastName} and ${relationship.partner.firstName} ${relationship.partner.lastName}`,
      type: 'relationship',
      level: 'gold',
      recipients: partners.map(p => ({
        user: p._id,
        awardedAt: new Date()
      })),
      design: {
        template: 'romantic',
        colors: {
          primary: '#ec4899',
          secondary: '#f0abfc',
          accent: '#f59e0b'
        }
      },
      metadata: {
        issuedBy: 'Proof',
        validUntil: null
      },
      stats: {
        viewCount: 0,
        downloadCount: 0,
        shareCount: 0
      }
    });

    // Update relationship with latest certificate
    relationship.latestCertificate = certificate._id;
    await relationship.save();

    console.log(`✅ Certificate created: ${certificate._id}`);

    res.status(201).json({
      message: 'Certificate generated successfully',
      certificate
    });
  } catch (error) {
    console.error('❌ Error generating certificate:', error);
    res.status(500).json({ 
      message: 'Failed to generate certificate',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all certificates for user
export const getCertificates = async (req, res) => {
  try {
    const { relationshipId } = req.params;

    const filter = {
      'recipients.user': req.user.id
    };

    if (relationshipId) {
      filter.relatedId = relationshipId;
      filter.relatedTo = 'relationship';

      const relationship = await Relationship.findById(relationshipId);
      if (!relationship) {
        return res.status(404).json({ message: 'Relationship not found' });
      }

      if (!relationship.includesUser(req.user.id)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const certificates = await Certificate.find(filter)
      .populate('recipients.user', 'firstName lastName avatar')
      .populate({
        path: 'relatedId',
        // relatedTo stores 'relationship' but the model is registered as 'Relationship';
        // relationships are the only certificate subject generated today
        model: 'Relationship',
        select: 'title type initiator partner',
        populate: [
          { path: 'initiator', select: 'firstName lastName' },
          { path: 'partner', select: 'firstName lastName' }
        ]
      })
      .sort({ createdAt: -1 });

    res.json({ certificates });
  } catch (error) {
    console.error('❌ Error fetching certificates:', error);
    res.status(500).json({ message: 'Failed to fetch certificates' });
  }
};

// Get single certificate
export const getCertificate = async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id)
      .populate('recipients.user', 'firstName lastName avatar');

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    // Check if user is recipient
    const isRecipient = certificate.recipients.some(r => 
      r.user._id.toString() === req.user.id.toString()
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Increment view count
    certificate.stats.viewCount = (certificate.stats.viewCount || 0) + 1;
    await certificate.save();

    res.json({ certificate });
  } catch (error) {
    console.error('❌ Error fetching certificate:', error);
    res.status(500).json({ message: 'Failed to fetch certificate' });
  }
};

// Turn the public verify link on or off for one certificate (recipients only)
export const setSharing = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const certificate = await Certificate.findById(req.params.id);
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    const isRecipient = certificate.recipients.some(r => r.user.toString() === req.user.id.toString());
    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    certificate.sharing.isPublic = req.body.isPublic === true;
    await certificate.save();
    res.json({ message: certificate.sharing.isPublic ? 'Verify link is on' : 'Verify link is off', sharing: certificate.sharing });
  } catch (error) {
    console.error('❌ Error updating certificate sharing:', error);
    res.status(500).json({ message: 'Failed to update sharing' });
  }
};

// Public: confirms a certificate is genuine. Only names, level and date are exposed,
// and only when a recipient has switched the link on.
export const verifyCertificate = async (req, res) => {
  try {
    const number = String(req.params.number || '').trim().toUpperCase();
    const certificate = await Certificate.findOne({ 'metadata.certificateNumber': number })
      .populate('recipients.user', 'firstName lastName');

    if (!certificate || !certificate.sharing?.isPublic) {
      return res.status(404).json({ message: 'No shared certificate found for that number' });
    }

    res.json({
      verified: certificate.isValid(),
      revoked: !!certificate.metadata?.isRevoked,
      number: certificate.metadata.certificateNumber,
      title: certificate.title,
      level: certificate.level,
      issuedAt: certificate.createdAt,
      people: certificate.recipients.map(r => `${r.user?.firstName ?? ''} ${r.user?.lastName ?? ''}`.trim())
    });
  } catch (error) {
    console.error('❌ Error verifying certificate:', error);
    res.status(500).json({ message: 'Failed to verify certificate' });
  }
};

const ownCertificate = async (req, res) => {
  const certificate = mongoose.isValidObjectId(req.params.id) ? await Certificate.findById(req.params.id) : null;
  if (!certificate) { res.status(404).json({ message: 'Certificate not found' }); return null; }
  if (!certificate.recipients.some((r) => idOf(r.user) === String(req.user.id))) {
    res.status(403).json({ message: 'Access denied' });
    return null;
  }
  return certificate;
};

// The certificate artwork for the holders to look at (not counted as a download)
export const getCertificateImage = async (req, res) => {
  try {
    const certificate = await ownCertificate(req, res);
    if (!certificate) return;
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, max-age=300' });
    res.send(certificateSvg(await artDataFor(certificate)));
  } catch (error) {
    console.error('❌ Error rendering certificate:', error);
    res.status(500).json({ message: 'Failed to load certificate' });
  }
};

// Send the certificate as a PNG download and count it
export const downloadCertificateFile = async (req, res) => {
  try {
    const certificate = await ownCertificate(req, res);
    if (!certificate) return;
    const png = await certificatePng(await artDataFor(certificate));
    certificate.stats.downloadCount = (certificate.stats.downloadCount || 0) + 1;
    await certificate.save();
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="certificate-${certificate._id}.png"` });
    res.send(png);
  } catch (error) {
    console.error('❌ Error downloading certificate:', error);
    res.status(500).json({ message: 'Failed to download certificate' });
  }
};

// Public: the shareable artwork, only while the holders have the verify link switched on
export const verifyCertificateImage = async (req, res) => {
  try {
    const number = String(req.params.number || '').trim().toUpperCase();
    const certificate = await Certificate.findOne({ 'metadata.certificateNumber': number });
    if (!certificate || !certificate.sharing?.isPublic) {
      return res.status(404).json({ message: 'No shared certificate found for that number' });
    }
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.send(certificateSvg(await artDataFor(certificate, { isPublic: true })));
  } catch (error) {
    console.error('❌ Error rendering shared certificate:', error);
    res.status(500).json({ message: 'Failed to load certificate' });
  }
};

// Track certificate share
export const trackShare = async (req, res) => {
  try {
    const { platform } = req.body;
    const certificate = await Certificate.findById(req.params.id);

    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }

    const isRecipient = certificate.recipients.some(r => 
      r.user.toString() === req.user.id.toString()
    );

    if (!isRecipient) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const validPlatforms = ['twitter', 'facebook', 'linkedin', 'whatsapp', 'email'];
    if (platform && !validPlatforms.includes(platform)) {
      return res.status(400).json({ message: 'Invalid platform' });
    }

    if (!certificate.sharing) {
      certificate.sharing = { sharedOn: [], shareCount: 0 };
    }

    if (platform && !certificate.sharing.sharedOn.includes(platform)) {
      certificate.sharing.sharedOn.push(platform);
    }

    certificate.sharing.shareCount = (certificate.sharing.shareCount || 0) + 1;
    certificate.stats.shareCount = (certificate.stats.shareCount || 0) + 1;
    await certificate.save();

    console.log(`✅ Share tracked - Platform: ${platform}`);

    res.json({
      message: 'Share tracked',
      shareCount: certificate.stats.shareCount
    });
  } catch (error) {
    console.error('❌ Error tracking share:', error);
    res.status(500).json({ message: 'Failed to track share' });
  }
};