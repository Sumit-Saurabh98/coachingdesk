import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { DataExport } from './data-export.repository';
import type { ExportService } from './export.service';

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }).strict();

const exportJSON = (e: DataExport) => ({
  id: e.id,
  status: e.status,
  byteSize: e.byteSize,
  createdAt: e.createdAt.toISOString(),
  readyAt: e.readyAt?.toISOString() ?? null,
  expiresAt: e.expiresAt?.toISOString() ?? null,
  // A path on THIS API (owner login needed), never a public link: the file holds every phone.
  downloadPath:
    e.status === 'ready' ? `/v1/institutes/${e.instituteId}/exports/${e.id}/download` : null,
});

/** Data export (FR-7.6): owner only. */
export class ExportsController {
  constructor(private readonly exports: ExportService) {}

  /** POST .../exports -> 202 { export } (new) or 200 { export } (one already in progress) */
  async request(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { created, export: found } = await this.exports.request(
      currentTenant(request).instituteId,
      currentUserId(request),
    );
    await reply.status(created ? 202 : 200).send({ export: exportJSON(found) });
  }

  /** GET .../exports?limit -> 200 { exports } (newest first) */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { limit } = ListQuery.parse(request.query);
    const found = await this.exports.list(currentTenant(request).instituteId, limit);
    await reply.status(200).send({ exports: found.map(exportJSON) });
  }

  /** GET .../exports/:exportId -> 200 { export } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const found = await this.exports.get(
      currentTenant(request).instituteId,
      uuidParam(request, 'exportId', 'Export not found'),
    );
    await reply.status(200).send({ export: exportJSON(found) });
  }

  /** GET .../exports/:exportId/download -> the ZIP (409 while not ready or after expiry) */
  async download(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { data, filename } = await this.exports.download(
      currentTenant(request).instituteId,
      uuidParam(request, 'exportId', 'Export not found'),
    );
    await reply
      .status(200)
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store') // personal data: no proxy or browser cache
      .send(Buffer.from(data));
  }
}
