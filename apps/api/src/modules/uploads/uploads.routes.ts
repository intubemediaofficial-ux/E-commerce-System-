import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { env, uploadDir } from '../../config/env';
import { created } from '../../lib/http';
import { badRequest } from '../../lib/errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requirePermission } from '../../middleware/auth';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * Images are stored on the local disk under `UPLOAD_DIR` and served read-only
 * from `/uploads`. Product records keep the returned relative path so the
 * storage backend can later move to S3 without a data migration.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

const router = Router();

router.post(
  '/images',
  requirePermission('product.update'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('VALIDATION_ERROR', 'An image file is required.');

    const extension = EXTENSIONS[file.mimetype];
    if (!extension) {
      throw badRequest('VALIDATION_ERROR', 'Only JPEG, PNG, WebP and GIF images are supported.');
    }

    const now = new Date();
    const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const target = path.join(uploadDir, folder);
    await fs.promises.mkdir(target, { recursive: true });

    const name = `${crypto.randomUUID()}${extension}`;
    await fs.promises.writeFile(path.join(target, name), file.buffer);

    return created(res, {
      url: `/uploads/${folder}/${name}`,
      size: file.size,
      contentType: file.mimetype,
    });
  }),
);

export default router;
