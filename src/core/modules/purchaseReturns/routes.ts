import { z } from 'zod';
import { route, zDate, zId, zOptText, zQty } from '../../api/router';
import * as returns from './service';

const VIEW = ['suppliers.view', 'purchases.manage'] as const;

export const purchaseReturnsRoutes = {
  /** The lines of a purchase and how much of each can still be sent back. */
  'purchaseReturns.returnable': route({ access: 'purchases.manage', input: z.object({ purchaseId: zId }), handler: (ctx, input) => returns.purchaseReturnable(ctx, input.purchaseId) }),

  'purchaseReturns.create': route({
    access: 'purchases.manage',
    mutation: true,
    input: z.object({
      purchaseId: zId,
      date: zDate.nullish(),
      items: z
        .array(z.object({ lineNo: z.number().int().positive(), qty: zQty }))
        .min(1, 'Enter the quantity returned')
        .max(500),
      settlement: z.enum(['adjust', 'cash', 'upi', 'bank']),
      accountId: zId.nullish(),
      reference: zOptText(60),
      remarks: zOptText(500),
    }),
    handler: (ctx, input) => returns.createPurchaseReturn(ctx, input),
  }),

  'purchaseReturns.cancel': route({
    access: 'purchases.manage',
    mutation: true,
    input: z.object({ id: zId, reason: z.string().trim().min(1, 'Enter the reason for cancelling').max(300) }),
    handler: (ctx, input) => returns.cancelPurchaseReturn(ctx, input.id, input.reason),
  }),

  'purchaseReturns.get': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => returns.getPurchaseReturn(ctx, input.id) }),

  'purchaseReturns.list': route({
    access: [...VIEW],
    input: z.object({ from: zDate, to: zDate, q: z.string().max(100).nullish(), status: z.enum(['active', 'cancelled']).nullish(), supplierId: zId.nullish() }),
    handler: (ctx, input) => returns.listPurchaseReturns(ctx, input),
  }),

  'purchaseReturns.html': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => returns.purchaseReturnHtml(ctx, input.id) }),

  'purchaseReturns.print': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => returns.printPurchaseReturn(ctx, input.id) }),
};
