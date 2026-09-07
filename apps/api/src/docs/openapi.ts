import { ALL_PERMISSIONS } from '../auth/permissions';

const bearer = [{ bearerAuth: [] }];

const envelope = (dataSchema: object): object => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    data: dataSchema,
    meta: { $ref: '#/components/schemas/PageMeta' },
  },
});

const listOp = (tag: string, summary: string, extraParams: object[] = []): object => ({
  tags: [tag],
  summary,
  security: bearer,
  parameters: [
    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
    { name: 'perPage', in: 'query', schema: { type: 'integer', default: 25 } },
    { name: 'search', in: 'query', schema: { type: 'string' } },
    { name: 'sortBy', in: 'query', schema: { type: 'string' } },
    { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
    ...extraParams,
  ],
  responses: {
    200: {
      description: 'Paginated list',
      content: { 'application/json': { schema: envelope({ type: 'array', items: { type: 'object' } }) } },
    },
  },
});

const simpleOp = (
  tag: string,
  summary: string,
  options: { body?: boolean; idempotent?: boolean; params?: object[] } = {},
): object => ({
  tags: [tag],
  summary,
  security: bearer,
  parameters: [
    ...(options.params ?? []),
    ...(options.idempotent
      ? [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Replays the original response when reused on this endpoint.',
            schema: { type: 'string' },
          },
        ]
      : []),
  ],
  ...(options.body
    ? {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      }
    : {}),
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: envelope({ type: 'object' }) } } },
    201: { description: 'Created', content: { 'application/json': { schema: envelope({ type: 'object' }) } } },
    400: { $ref: '#/components/responses/Error' },
    401: { $ref: '#/components/responses/Error' },
    403: { $ref: '#/components/responses/Error' },
    404: { $ref: '#/components/responses/Error' },
    409: { $ref: '#/components/responses/Error' },
    422: { $ref: '#/components/responses/Error' },
  },
});

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Product Register API',
    version: '1.0.0',
    description: [
      'Multi-tenant product register: product photo, title, cost price,',
      'warehouse/shop name, date and the current stock quantity.',
      '',
      `Permissions: ${ALL_PERMISSIONS.join(', ')}`,
    ].join('\n'),
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local' }],
  tags: [
    { name: 'Auth' },
    { name: 'Products' },
    { name: 'Uploads' },
    { name: 'Dashboard' },
    { name: 'Admin' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      PageMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'PRODUCT_NOT_FOUND',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'VALIDATION_ERROR',
                  'INVALID_STATE',
                  'NOT_FOUND',
                  'CONFLICT',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
    responses: {
      Error: {
        description: 'Error response',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['Auth'], summary: 'Liveness probe', responses: { 200: { description: 'ok' } } } },
    '/health/ready': {
      get: { tags: ['Auth'], summary: 'Readiness probe (checks database)', responses: { 200: { description: 'ready' } } },
    },

    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Access token, refresh token and user context' },
          401: { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/api/auth/refresh': { post: simpleOp('Auth', 'Rotate refresh token', { body: true }) },
    '/api/auth/logout': { post: simpleOp('Auth', 'Revoke a refresh token', { body: true }) },
    '/api/auth/me': { get: simpleOp('Auth', 'Current user, roles and permissions') },
    '/api/auth/change-password': { post: simpleOp('Auth', 'Change own password', { body: true }) },
    '/api/auth/forgot-password': { post: simpleOp('Auth', 'Request a password reset email', { body: true }) },
    '/api/auth/reset-password': { post: simpleOp('Auth', 'Reset password with a token', { body: true }) },
    '/api/auth/verify-email': { post: simpleOp('Auth', 'Verify an email address', { body: true }) },

    '/api/products': {
      get: listOp('Products', 'List products'),
      post: simpleOp('Products', 'Create product', { body: true }),
    },
    '/api/products/{id}': {
      get: simpleOp('Products', 'Product detail', { params: idParam }),
      put: simpleOp('Products', 'Update product', { body: true, params: idParam }),
      delete: simpleOp('Products', 'Delete product', { params: idParam }),
    },
    '/api/uploads/images': { post: simpleOp('Uploads', 'Upload a product image') },

    '/api/dashboard/summary': {
      get: simpleOp('Dashboard', 'Product count, current stock units and purchase value'),
    },

    '/api/admin/users': { get: listOp('Admin', 'List users'), post: simpleOp('Admin', 'Create user', { body: true }) },
    '/api/admin/users/{id}': {
      get: simpleOp('Admin', 'User detail', { params: idParam }),
      put: simpleOp('Admin', 'Update user and roles', { body: true, params: idParam }),
      delete: simpleOp('Admin', 'Archive user and revoke sessions', { params: idParam }),
    },
    '/api/admin/users/{id}/password': { post: simpleOp('Admin', 'Set a user password', { body: true, params: idParam }) },
    '/api/admin/roles': { get: simpleOp('Admin', 'List roles with permissions'), post: simpleOp('Admin', 'Create role', { body: true }) },
    '/api/admin/roles/{id}': {
      put: simpleOp('Admin', 'Update role permissions', { body: true, params: idParam }),
      delete: simpleOp('Admin', 'Delete custom role', { params: idParam }),
    },
    '/api/admin/permissions': { get: simpleOp('Admin', 'Permission catalogue') },
    '/api/admin/organization': {
      get: simpleOp('Admin', 'Organization profile'),
      put: simpleOp('Admin', 'Update organization', { body: true }),
    },
    '/api/admin/audit-logs': { get: listOp('Admin', 'Immutable audit log') },
  },
} as const;
