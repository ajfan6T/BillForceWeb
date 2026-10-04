import { z } from 'zod';
import { route } from '../../api/router';
import { exportReport, printReport } from './service';

const zReport = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['text', 'money', 'number', 'qty', 'date', 'datetime', 'percent', 'drcr']).optional(),
      width: z.number().optional(),
      align: z.enum(['left', 'right', 'center']).optional(),
      nowrap: z.boolean().optional(),
    }),
  ),
  rows: z.array(
    z.object({
      cells: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      style: z.enum(['normal', 'group', 'subtotal', 'total', 'muted', 'section']).optional(),
      indent: z.number().optional(),
      link: z.object({ kind: z.string(), id: z.union([z.number(), z.string()]) }).optional(),
    }),
  ),
  summary: z
    .array(
      z.object({
        label: z.string(),
        value: z.union([z.string(), z.number(), z.null()]),
        type: z.enum(['text', 'money', 'number', 'qty', 'date', 'datetime', 'percent', 'drcr']).optional(),
      }),
    )
    .optional(),
  notes: z.array(z.string()).optional(),
  landscape: z.boolean().optional(),
});

export const filesRoutes = {
  /** Save any on-screen report as Excel, CSV or PDF (downloaded by the browser). */
  'files.exportReport': route({
    access: 'reports.export',
    input: z.object({ report: zReport, format: z.enum(['xlsx', 'csv', 'pdf']) }),
    handler: (ctx, input) => exportReport(ctx, input.report, input.format),
  }),

  /** Print a report on an A4 printer (system print dialog). */
  'files.printReport': route({
    access: 'user',
    input: z.object({ report: zReport }),
    handler: (ctx, input) => printReport(ctx, input.report),
  }),

  'print.listPrinters': route({ access: 'user', handler: (ctx) => ctx.platform.listPrinters() }),
};
