export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'PRODUCT_NOT_FOUND'
  | 'WAREHOUSE_NOT_FOUND'
  | 'DUPLICATE_SKU'
  | 'INVALID_QUANTITY'
  | 'PURCHASE_NOT_FOUND'
  | 'SUPPLIER_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'INVALID_STATE'
  | 'EXPIRED_STOCK'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(code, message, 400, details);

export const unauthorized = (message = 'Authentication required.') =>
  new AppError('UNAUTHORIZED', message, 401);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError('FORBIDDEN', message, 403);

export const notFound = (code: ErrorCode, message: string) => new AppError(code, message, 404);

export const conflict = (code: ErrorCode, message: string) => new AppError(code, message, 409);

export const insufficientStock = (message = 'Insufficient stock available.', details?: unknown) =>
  new AppError('INSUFFICIENT_STOCK', message, 409, details);

export const invalidState = (message: string) => new AppError('INVALID_STATE', message, 409);
