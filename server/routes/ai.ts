import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { getDb } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import {
  classifyScrapImage,
  generateListingSuggestion,
  getAiSystemStatus,
  getContextualGuidance,
} from '../services/ai';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

router.get('/status', requireAuth, (_req, res) => {
  res.json(getAiSystemStatus());
});

router.get('/guidance', (req, res) => {
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  res.json({ guidance: getContextualGuidance(topic), ragEnabled: false });
});

router.post(
  '/classify-image',
  requireAuth,
  upload.single('image'),
  async (req: AuthenticatedRequest, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Image file is required for classification.' });
      return;
    }
    if (!config.allowedImageMimes.includes(file.mimetype)) {
      res.status(400).json({ error: 'Only JPEG, PNG, or WebP images are supported.' });
      return;
    }
    const db = getDb();
    const result = await classifyScrapImage(db, {
      userId: req.authUser!.id,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      sellerHint: typeof req.body?.hint === 'string' ? req.body.hint : undefined,
    });
    res.json(result);
  }
);

router.post('/listing-assist', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { description, selectedCategories, imagePredictions } = req.body || {};
  const db = getDb();
  const result = await generateListingSuggestion(db, {
    userId: req.authUser!.id,
    description: String(description || ''),
    selectedCategories: Array.isArray(selectedCategories)
      ? selectedCategories.map(String)
      : [],
    imagePredictions: Array.isArray(imagePredictions) ? imagePredictions.map(String) : [],
  });
  res.json(result);
});

export default router;
