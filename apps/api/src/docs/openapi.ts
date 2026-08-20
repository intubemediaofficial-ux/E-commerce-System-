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

const reportParams = [
  { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv', 'excel', 'pdf'] } },
  { name: 'warehouseId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
];

const reportPaths = [
  'current-stock',
  'stock-ledger',
  'valuation',
  'low-stock',
  'expiry',
  'wastage',
  'adjustments',
  'transfers',
  'purchases',
  'supplier-purchases',
  'purchase-returns',
  'price-history',
  'consumption',
  'food-cost',
  'recipe-cost',
  'sales',
  'product-sales',
  'stock-movement',
  'audit',
].reduce<Record<string, object>>((acc, name) => {
  acc[`/api/reports/${name}`] = {
    get: {
      tags: ['Reports'],
      summary: `${name} report (json/csv/excel/pdf)`,
      security: bearer,
      parameters: reportParams,
      responses: { 200: { description: 'Report payload or file download' } },
    },
  };
  return acc;
}, {});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Inventory Management System API',
    version: '1.0.0',
    description: [
      'Multi-tenant inventory API for e-commerce and restaurant operations.',
      '',
      'Guarantees: every stock change is transactional, writes an immutable ledger row,',
      'is permission checked, is audited, and can be made idempotent with the',
      '`Idempotency-Key` header.',
      '',
      `Permissions: ${ALL_PERMISSIONS.join(', ')}`,
    ].join('\n'),
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local' }],
  tags: [
    { name: 'Auth' },
    { name: 'Master Data' },
    { name: 'Products' },
    { name: 'Inventory' },
    { name: 'Transfers' },
    { name: 'Purchasing' },
    { name: 'Restaurant' },
    { name: 'E-commerce' },
    { name: 'Reports' },
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
                  'INSUFFICIENT_STOCK',
                  'PRODUCT_NOT_FOUND',
                  'WAREHOUSE_NOT_FOUND',
                  'DUPLICATE_SKU',
                  'INVALID_QUANTITY',
                  'PURCHASE_NOT_FOUND',
                  'TRANSFER_NOT_FOUND',
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

    '/api/categories': { get: listOp('Master Data', 'List categories'), post: simpleOp('Master Data', 'Create category', { body: true }) },
    '/api/categories/tree': { get: simpleOp('Master Data', 'Hierarchical category tree') },
    '/api/brands': { get: listOp('Master Data', 'List brands'), post: simpleOp('Master Data', 'Create brand', { body: true }) },
    '/api/units': { get: listOp('Master Data', 'List units'), post: simpleOp('Master Data', 'Create unit', { body: true }) },
    '/api/units/convert': { get: simpleOp('Master Data', 'Convert a quantity between units') },
    '/api/locations': { get: listOp('Master Data', 'List locations'), post: simpleOp('Master Data', 'Create location', { body: true }) },
    '/api/warehouses': { get: listOp('Master Data', 'List warehouses'), post: simpleOp('Master Data', 'Create warehouse', { body: true }) },
    '/api/suppliers': { get: listOp('Master Data', 'List suppliers'), post: simpleOp('Master Data', 'Create supplier', { body: true }) },
    '/api/suppliers/{id}/history': { get: simpleOp('Purchasing', 'Supplier purchase history and balance', { params: idParam }) },

    '/api/products': { get: listOp('Products', 'List products'), post: simpleOp('Products', 'Create product', { body: true }) },
    '/api/products/{id}': {
      get: simpleOp('Products', 'Product detail with stock and recipes', { params: idParam }),
      put: simpleOp('Products', 'Update product', { body: true, params: idParam }),
      delete: simpleOp('Products', 'Archive product', { params: idParam }),
    },
    '/api/products/{id}/variants': {
      get: simpleOp('Products', 'List variants', { params: idParam }),
      post: simpleOp('Products', 'Create variant', { body: true, params: idParam }),
    },
    '/api/products/{id}/bundle': {
      get: simpleOp('Products', 'Bundle configuration', { params: idParam }),
      put: simpleOp('Products', 'Replace bundle components', { body: true, params: idParam }),
    },

    '/api/inventory': { get: listOp('Inventory', 'Stock rows with reserved/available/value') },
    '/api/inventory/summary': { get: simpleOp('Inventory', 'Aggregate stock KPIs') },
    '/api/inventory/ledger': { get: listOp('Inventory', 'Immutable stock ledger') },
    '/api/inventory/adjust': { post: simpleOp('Inventory', 'Create stock adjustment', { body: true, idempotent: true }) },
    '/api/inventory/adjustments/{id}/approve': {
      post: simpleOp('Inventory', 'Approve a high-value adjustment', { params: idParam }),
    },
    '/api/inventory/wastage': { post: simpleOp('Inventory', 'Record wastage', { body: true, idempotent: true }) },
    '/api/inventory/batches/list': { get: listOp('Inventory', 'Batches with expiry') },
    '/api/inventory/expiry/summary': { get: simpleOp('Inventory', 'Expiry buckets (today/7/15/30 days)') },
    '/api/inventory/{productId}': { get: simpleOp('Inventory', 'Per-product inventory detail') },

    '/api/stock-transfers': {
      get: listOp('Transfers', 'List transfers'),
      post: simpleOp('Transfers', 'Create transfer', { body: true }),
    },
    '/api/stock-transfers/{id}/approve': { post: simpleOp('Transfers', 'Approve transfer', { params: idParam }) },
    '/api/stock-transfers/{id}/dispatch': {
      post: simpleOp('Transfers', 'Dispatch (deducts source stock)', { params: idParam, idempotent: true }),
    },
    '/api/stock-transfers/{id}/receive': {
      post: simpleOp('Transfers', 'Receive (credits destination, supports partial)', {
        body: true,
        params: idParam,
        idempotent: true,
      }),
    },
    '/api/stock-transfers/{id}/cancel': { post: simpleOp('Transfers', 'Cancel before dispatch', { params: idParam }) },

    '/api/purchase-orders': {
      get: listOp('Purchasing', 'List purchase orders'),
      post: simpleOp('Purchasing', 'Create purchase order', { body: true }),
    },
    '/api/purchase-orders/{id}': {
      get: simpleOp('Purchasing', 'Purchase order detail', { params: idParam }),
      put: simpleOp('Purchasing', 'Update draft purchase order', { body: true, params: idParam }),
    },
    '/api/purchase-orders/{id}/approve': { post: simpleOp('Purchasing', 'Approve purchase order', { params: idParam }) },
    '/api/purchase-orders/{id}/cancel': { post: simpleOp('Purchasing', 'Cancel purchase order', { params: idParam }) },
    '/api/purchase-orders/{id}/receive': {
      post: simpleOp('Purchasing', 'Receive goods (GRN, batches, partial receiving)', {
        body: true,
        params: idParam,
        idempotent: true,
      }),
    },
    '/api/purchase-returns': {
      get: listOp('Purchasing', 'List purchase returns'),
      post: simpleOp('Purchasing', 'Create purchase return', { body: true, idempotent: true }),
    },

    '/api/restaurant/recipes': {
      get: listOp('Restaurant', 'List recipes'),
      post: simpleOp('Restaurant', 'Create recipe', { body: true }),
    },
    '/api/restaurant/recipes/{id}': {
      get: simpleOp('Restaurant', 'Recipe detail', { params: idParam }),
      put: simpleOp('Restaurant', 'Update recipe', { body: true, params: idParam }),
      delete: simpleOp('Restaurant', 'Archive recipe', { params: idParam }),
    },
    '/api/restaurant/recipes/{id}/cost': { get: simpleOp('Restaurant', 'Theoretical recipe cost', { params: idParam }) },
    '/api/restaurant/recipes/{id}/requirements': {
      get: simpleOp('Restaurant', 'Ingredient requirement preview', { params: idParam }),
    },
    '/api/restaurant/orders': {
      get: listOp('Restaurant', 'List restaurant orders'),
      post: simpleOp('Restaurant', 'Create restaurant order', { body: true }),
    },
    '/api/restaurant/orders/{id}/complete': {
      post: simpleOp('Restaurant', 'Complete order and consume recipe ingredients', {
        params: idParam,
        idempotent: true,
      }),
    },
    '/api/restaurant/consumption': {
      post: simpleOp('Restaurant', 'Record ad-hoc kitchen consumption', { body: true, idempotent: true }),
    },

    '/api/ecommerce/orders': {
      get: listOp('E-commerce', 'List orders'),
      post: simpleOp('E-commerce', 'Create order', { body: true }),
    },
    '/api/ecommerce/orders/{id}/confirm': {
      post: simpleOp('E-commerce', 'Confirm payment and reserve stock', { params: idParam, idempotent: true }),
    },
    '/api/ecommerce/orders/{id}/ship': {
      post: simpleOp('E-commerce', 'Ship (consumes reservations)', { params: idParam, idempotent: true }),
    },
    '/api/ecommerce/orders/{id}/cancel': {
      post: simpleOp('E-commerce', 'Cancel and release reservations', { params: idParam, idempotent: true }),
    },
    '/api/ecommerce/orders/{id}/return': {
      post: simpleOp('E-commerce', 'Validate a return and restock', { body: true, params: idParam, idempotent: true }),
    },
    '/api/ecommerce/reservations': { get: listOp('E-commerce', 'List reservations') },

    '/api/dashboard/admin': { get: simpleOp('Dashboard', 'Admin KPIs') },
    '/api/dashboard/restaurant': { get: simpleOp('Dashboard', 'Kitchen KPIs and food cost') },
    '/api/dashboard/ecommerce': { get: simpleOp('Dashboard', 'Sales KPIs and reservations') },

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
    '/api/admin/settings': {
      get: simpleOp('Admin', 'Inventory business settings'),
      put: simpleOp('Admin', 'Update business settings', { body: true }),
    },
    '/api/admin/audit-logs': { get: listOp('Admin', 'Immutable audit log') },
    '/api/notifications': { get: listOp('Admin', 'Notification center with unread count') },
    '/api/notifications/read-all': { post: simpleOp('Admin', 'Mark all notifications read') },

    ...reportPaths,
  },
} as const;
