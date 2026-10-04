import { z } from 'zod';
import { route, zDate, zId, zOptText, zPaise, zQty } from '../../api/router';
import * as orders from './service';

const zOrder = z.object({
  date: zDate.nullish(),
  expectedDate: zDate.nullish(),
  supplierId: zId,
  items: z
    .array(
      z.object({
        itemId: zId.nullish(),
        description: z.string().trim().min(1, 'Enter what is ordered').max(200),
        unit: zOptText(20),
        qty: zQty,
        rate: zPaise,
      }),
    )
    .min(1, 'Add at least one item')
    .max(500, 'An order can have at most 500 lines'),
  remarks: zOptText(500),
});

const VIEW = ['suppliers.view', 'purchases.manage'] as const;

export const purchaseOrdersRoutes = {
  'purchaseOrders.list': route({
    access: [...VIEW],
    input: z.object({
      from: zDate,
      to: zDate,
      q: z.string().max(100).nullish(),
      status: z.enum(['open', 'received', 'cancelled']).nullish(),
      supplierId: zId.nullish(),
    }),
    handler: (ctx, input) => orders.listPurchaseOrders(ctx, input),
  }),

  'purchaseOrders.get': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => orders.getPurchaseOrder(ctx, input.id) }),

  'purchaseOrders.create': route({ access: 'purchases.manage', mutation: true, input: zOrder, handler: (ctx, input) => orders.createPurchaseOrder(ctx, input) }),

  'purchaseOrders.update': route({
    access: 'purchases.manage',
    mutation: true,
    input: zOrder.extend({ id: zId }),
    handler: (ctx, { id, ...input }) => orders.updatePurchaseOrder(ctx, id, input),
  }),

  'purchaseOrders.cancel': route({
    access: 'purchases.manage',
    mutation: true,
    input: z.object({ id: zId, reason: z.string().trim().min(1, 'Enter the reason for cancelling').max(300) }),
    handler: (ctx, input) => orders.cancelPurchaseOrder(ctx, input.id, input.reason),
  }),

  /** The purchase form filled from an open order (/purchases/new?po=<id>). */
  'purchaseOrders.billData': route({ access: 'purchases.manage', input: z.object({ id: zId }), handler: (ctx, input) => orders.purchaseOrderBillData(ctx, input.id) }),

  'purchaseOrders.html': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => orders.purchaseOrderHtml(ctx, input.id) }),

  'purchaseOrders.print': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => orders.printPurchaseOrder(ctx, input.id) }),
};
