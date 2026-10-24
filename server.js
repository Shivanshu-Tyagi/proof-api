import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getFrontendUrls, validateConfig } from './config.js';
import { sanitizeBody } from './middleware/sanitize.js';

// Import routes
import authRoutes from './routes/auth.js';
import relationshipRoutes from './routes/relationships.js';
import termRoutes from './routes/terms.js';
import milestoneRoutes from './routes/milestones.js';
import activityRoutes from './routes/activities.js';
import certificateRoutes from './routes/certificates.js';
import notificationRoutes from './routes/notifications.js';
import contactRoutes from './routes/contact.js';
import verifyRoutes from './routes/verify.js';
import messageRoutes from './routes/messages.js';
import Relationship from './models/Relationship.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';

validateConfig();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
// Uploaded images are loaded by the frontend from a different origin
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Needed behind a proxy/load balancer so rate limiting sees the real client IP
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}
app.use(cors({
  origin: getFrontendUrls(),
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/auth/login', limiter);
app.use('/api/auth/signup', limiter);
// Export and deletion are heavy and sensitive, so keep them to a few attempts
app.use(['/api/auth/export', '/api/auth/delete-account'], rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: 'Too many attempts, please try again later.' }
}));
app.use('/api/auth/forgot-password', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Too many reset requests, please try again later.' }
}));
// Generous ceiling for everything else
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeBody);

// Serve static uploaded files
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/relationships', relationshipRoutes);
app.use('/api/terms', termRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/messages', messageRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'OK' : 'DEGRADED',
    database: dbConnected ? 'connected' : 'disconnected',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/relationshipapp');
    console.log('✅ Connected to MongoDB');
    // Ensure partial unique index for relationships (allows re-relationship after breakup)
    try {
      const collection = mongoose.connection.collection('relationships');
      const indexes = await collection.indexes();
      const hasLegacy = indexes.find(i => i.name === 'initiator_1_partner_1' && !i.partialFilterExpression);
      if (hasLegacy) {
        console.log('🔧 Dropping legacy initiator_1_partner_1 index to apply partial unique index');
        await collection.dropIndex('initiator_1_partner_1');
      }
      // Recreate indexes from schema definition (includes partial unique)
      await Relationship.syncIndexes();
      console.log('✅ Relationship indexes synchronized');
    } catch (idxErr) {
      console.error('⚠️ Index synchronization error:', idxErr);
    }
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Finish in-flight requests and close the DB cleanly on deploys/restarts
    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await mongoose.connection.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Tests import the app and manage their own connection
if (process.env.NODE_ENV !== 'test') {
  start();
}

export default app;
