import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { receiptImages, receipts } from '../db/schema.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { normaliseImage } from '../lib/images.ts';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** No-op until T08 wires in the real job runner; the receipt stays `pending` until then. */
function enqueue(_receiptId: number): void {}

export default async function receiptsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/receipts', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new ValidationError('Ingen fil ble sendt');
    }

    // A file over config.maxUploadBytes makes @fastify/multipart throw a 413 here, which
    // appErrorFromHttpError (T02) maps to the documented PAYLOAD_TOO_LARGE body.
    const buffer = await file.toBuffer();
    const normalised = await normaliseImage(buffer);

    const existingImage = app.db
      .select()
      .from(receiptImages)
      .where(eq(receiptImages.sha256, normalised.sha256))
      .get();
    if (existingImage) {
      throw new ConflictError('Denne kvitteringen er allerede skannet', {
        existingReceiptId: existingImage.receiptId,
      });
    }

    const now = new Date().toISOString();
    const receipt = app.sqlite.transaction(() => {
      const inserted = app.db
        .insert(receipts)
        .values({ status: 'pending', createdAt: now, updatedAt: now })
        .returning()
        .get();
      app.db
        .insert(receiptImages)
        .values({
          receiptId: inserted.id,
          mimeType: 'image/jpeg',
          bytes: normalised.bytes,
          width: normalised.width,
          height: normalised.height,
          sha256: normalised.sha256,
        })
        .run();
      return inserted;
    })();

    enqueue(receipt.id);

    reply.status(202).send({ id: receipt.id });
  });

  app.get('/api/receipts/:id/image', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const image = app.db
      .select()
      .from(receiptImages)
      .where(eq(receiptImages.receiptId, params.id))
      .get();
    if (!image) {
      throw new NotFoundError();
    }

    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type(image.mimeType);
    return image.bytes;
  });
}
