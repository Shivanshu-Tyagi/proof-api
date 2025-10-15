import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Import routes
import authRoutes from './routes/auth.js';
import relationshipRoutes from './routes/relationships.js';
import termRoutes from './routes/terms.js';
import milestoneRoutes from './routes/milestones.js';
import activityRoutes from './routes/activities.js';
import certificateRoutes from './routes/certificates.js';
import notificationRoutes from './routes/notifications.js';
import Relationship from './models/Relationship.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/auth', limiter);

// Logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/relationshipapp')
  .then(() => {
    console.log('✅ Connected to MongoDB');
    // Ensure partial unique index for relationships (allows re-relationship after breakup)
    (async () => {
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
    })();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

