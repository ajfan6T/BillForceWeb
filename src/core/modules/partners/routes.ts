import { z } from 'zod';
import { route, zDate, zId, zOptText, zPositivePaise, zRange, zSettlementMode } from '../../api/router';
import * as partners from './service';

const zAmount = zPositivePaise.refine((v) => v <= 1_000_000_000_00, 'Amount is too large');
const zPartnerInput = z.object({
  name: z.string().trim().min(1, "Enter the partner's name").max(80, 'Name is too long (max 80 characters)'),
  phone: zOptText(40),
  email: zOptText(120),
  address: zOptText(500),
  notes: zOptText(1000),
  sharePct: z.number({ error: 'Enter the profit share' }).min(0, 'Cannot be negative').max(100, 'At most 100%'),
  joinedOn: zDate.nullish(),
  isActive: z.boolean().optional(),
});
const VIEW = ['accounts.view', 'accounts.manage'] as const;

export const partnersRoutes = {
  /** Partners with what each invested, paid for the business, took out and is owed. */
  'partners.list': route({ access: [...VIEW], handler: (ctx) => partners.listPartners(ctx) }),
  /** Names only, for forms (who paid an expense). */
  'partners.options': route({ access: ['expenses.manage', ...VIEW], handler: (ctx) => partners.partnerOptions(ctx) }),
  'partners.get': route({ access: [...VIEW], input: z.object({ id: zId }), handler: (ctx, input) => partners.getPartner(ctx, input.id) }),
  'partners.statement': route({
    access: [...VIEW],
    input: zRange.extend({ id: zId }),
    handler: (ctx, { id, ...range }) => partners.partnerStatement(ctx, id, range),
  }),
  'partners.create': route({ access: 'accounts.manage', mutation: true, input: zPartnerInput, handler: (ctx, input) => partners.createPartner(ctx, input) }),
  'partners.update': route({
    access: 'accounts.manage',
    mutation: true,
    input: zPartnerInput.extend({ id: zId }),
    handler: (ctx, { id, ...input }) => partners.updatePartner(ctx, id, input),
  }),
  /** Money a partner brings in (Dr cash / bank, Cr the partner's capital). */
  'partners.invest': route({
    access: 'accounts.manage',
    mutation: true,
    input: z.object({ partnerId: zId, date: zDate.nullish(), amount: zAmount, mode: zSettlementMode, accountId: z.number().int().positive().nullish(), narration: zOptText(500) }),
    handler: (ctx, input) => partners.recordInvestment(ctx, input),
  }),
  /** Money or goods a partner takes out, or money paid back to a partner (Dr the partner's drawings). */
  'partners.withdraw': route({
    access: 'accounts.manage',
    mutation: true,
    input: z.object({
      partnerId: zId,
      date: zDate.nullish(),
      amount: zAmount,
      mode: zSettlementMode.nullish(),
      accountId: z.number().int().positive().nullish(),
      goods: z.boolean().optional(),
      narration: zOptText(500),
    }),
    handler: (ctx, input) => partners.recordWithdrawal(ctx, input),
  }),
};
