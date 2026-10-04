import { z } from 'zod';
import { route, zDate, zId, zOptText, zPaise, zPhone, zQty } from '../../api/router';
import * as quotations from './service';

const zPct = z.number().min(0, 'Discount % cannot be negative').max(100, 'Discount cannot be more than 100%');

const zLine = z.object({
  itemId: zId.nullish(),
  itemName: z.string().trim().min(1, 'Enter the item name').max(120, 'Item name is too long'),
  unit: zOptText(20),
  qty: zQty,
  rate: zPaise,
  discount: zPaise.nullish(),
  discountPct: zPct.nullish(),
  gstRate: z.number().min(0).max(40).nullish(),
  hsn: zOptText(8),
});

const zQuotation = z.object({
  date: zDate.nullish(),
  validUntil: zDate.nullish(),
  customerId: zId.nullish(),
  customerName: zOptText(120),
  customerPhone: zPhone,
  items: z.array(zLine).min(1, 'Add at least one item').max(500, 'A quotation can have at most 500 lines'),
  billDiscount: zPaise.nullish(),
  billDiscountPct: zPct.nullish(),
  remarks: zOptText(500),
});

const VIEW = ['billing.create', 'billing.view'] as const;

export const quotationsRoutes = {
  'quotations.list': route({
    access: [...VIEW],
    input: z.object({ from: zDate, to: zDate, q: z.string().max(100).nullish(), status: z.enum(['open', 'converted', 'cancelled']).nullish() }),
    handler: (ctx, input) => quotations.listQuotations(ctx, input),
  }),

  'quotations.get': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => quotations.getQuotation(ctx, input.id) }),

  'quotations.create': route({ access: 'billing.create', mutation: true, input: zQuotation, handler: (ctx, input) => quotations.createQuotation(ctx, input) }),

  'quotations.update': route({
    access: 'billing.create',
    mutation: true,
    input: zQuotation.extend({ id: zId }),
    handler: (ctx, { id, ...input }) => quotations.updateQuotation(ctx, id, input),
  }),

  'quotations.cancel': route({
    access: 'billing.create',
    mutation: true,
    input: z.object({ id: zId, reason: z.string().trim().min(1, 'Enter the reason for cancelling').max(300) }),
    handler: (ctx, input) => quotations.cancelQuotation(ctx, input.id, input.reason),
  }),

  /** Lines of an open quotation for the billing screen (/billing/new?quote=<id>). */
  'quotations.billData': route({ access: 'billing.create', input: z.object({ id: zId }), handler: (ctx, input) => quotations.quotationBillData(ctx, input.id) }),

  'quotations.receiptHtml': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => quotations.quotationReceiptHtml(ctx, input.id) }),

  'quotations.print': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => quotations.printQuotation(ctx, input.id) }),
};
