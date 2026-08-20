import { Response } from 'express';

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export function ok<T>(res: Response, data: T, meta?: PageMeta) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res: Response) {
  return res.status(204).send();
}

export function pageMeta(page: number, perPage: number, total: number): PageMeta {
  return { page, perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 };
}
