import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendMail } from './mail.service';

interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  /** When omitted the notification fans out to every user holding these permissions. */
  userIds?: string[];
  permissions?: string[];
}

async function resolveRecipients(input: NotifyInput): Promise<{ id: string; email: string }[]> {
  if (input.userIds?.length) {
    return prisma.user.findMany({
      where: { id: { in: input.userIds }, status: 'ACTIVE' },
      select: { id: true, email: true },
    });
  }
  const permissions = input.permissions ?? ['inventory.view'];
  return prisma.user.findMany({
    where: {
      organizationId: input.organizationId,
      status: 'ACTIVE',
      userRoles: {
        some: {
          role: {
            OR: [
              { slug: { in: ['super_admin', 'admin'] } },
              { rolePermissions: { some: { permission: { slug: { in: permissions } } } } },
            ],
          },
        },
      },
    },
    select: { id: true, email: true },
  });
}

export async function notify(input: NotifyInput): Promise<number> {
  const recipients = await resolveRecipients(input);
  if (recipients.length === 0) return 0;

  const data: Prisma.NotificationCreateManyInput[] = recipients.map((user) => ({
    organizationId: input.organizationId,
    userId: user.id,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: input.entityType,
    entityId: input.entityId,
  }));

  await prisma.notification.createMany({ data });

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: input.organizationId },
    select: { notifyByEmail: true },
  });
  if (settings?.notifyByEmail) {
    await Promise.all(
      recipients.map((r) =>
        sendMail({ to: r.email, subject: input.title, text: input.message }).catch((err) =>
          logger.warn({ err }, 'Notification email failed'),
        ),
      ),
    );
  }

  return recipients.length;
}

/**
 * Emits LOW_STOCK / OUT_OF_STOCK notifications for a product-warehouse pair,
 * de-duplicated against unread notifications for the same stock row.
 */
export async function checkStockThresholds(stockId: string): Promise<void> {
  const stock = await prisma.inventoryStock.findUnique({
    where: { id: stockId },
    include: {
      product: { select: { id: true, name: true, sku: true, reorderLevel: true } },
      warehouse: { select: { id: true, name: true } },
    },
  });
  if (!stock) return;

  const quantity = new Prisma.Decimal(stock.quantity);
  const reorderLevel = new Prisma.Decimal(stock.product.reorderLevel);
  const type: NotificationType | null = quantity.lessThanOrEqualTo(0)
    ? 'OUT_OF_STOCK'
    : quantity.lessThanOrEqualTo(reorderLevel)
      ? 'LOW_STOCK'
      : null;
  if (!type) return;

  const alreadyOpen = await prisma.notification.findFirst({
    where: {
      organizationId: stock.organizationId,
      type,
      entityType: 'INVENTORY_STOCK',
      entityId: stock.id,
      readAt: null,
    },
    select: { id: true },
  });
  if (alreadyOpen) return;

  await notify({
    organizationId: stock.organizationId,
    type,
    title: type === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock',
    message: `${stock.product.name} (${stock.product.sku}) at ${stock.warehouse.name} is at ${quantity.toFixed(2)} (reorder level ${reorderLevel.toFixed(2)}).`,
    entityType: 'INVENTORY_STOCK',
    entityId: stock.id,
    permissions: ['inventory.view'],
  });
}
