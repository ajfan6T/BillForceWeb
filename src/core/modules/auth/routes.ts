import { z } from 'zod';
import { route, zDate, zPaise } from '../../api/router';
import * as auth from './service';

const zUsername = z
  .string()
  .trim()
  .min(2, 'Username must be at least 2 characters')
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'Username can have letters, numbers, dot, dash and underscore only');

const zBusinessName = z.string().trim().min(1, 'Enter your registered business name').max(120);

export const authRoutes = {
  /** App status for the startup screen: who is logged in, to which business. */
  'app.status': route({ access: 'public', handler: (ctx) => auth.appStatus(ctx) }),

  /** Register a new business (its own database) with its owner; the owner is logged in. */
  'business.register': route({
    access: 'public',
    input: z.object({
      business: z.object({
        name: z.string().trim().min(1, 'Enter your business name').max(120),
        address: z.string().trim().max(500).nullish(),
        phone: z.string().trim().max(40).nullish(),
        email: z.string().trim().max(120).nullish(),
      }),
      owner: z.object({
        fullName: z.string().trim().min(1, 'Enter your name').max(80),
        username: zUsername,
        password: z.string().min(4, 'Password must be at least 4 characters').max(128),
      }),
      booksStartDate: zDate.optional(),
      openingCash: zPaise.optional(),
      openingBank: zPaise.optional(),
      openingUpi: zPaise.optional(),
    }),
    handler: (ctx, input) => ctx.app.registerBusiness(input),
  }),

  /** Active users of the business (for the logged-in user only). */
  'auth.loginUsers': route({ access: 'user', handler: (ctx) => auth.loginUsers(ctx) }),

  // Not a single transaction on purpose: failed attempts must be recorded even though login throws.
  'auth.login': route({
    access: 'public',
    input: z.object({
      businessName: zBusinessName,
      username: z.string().trim().min(1, 'Enter your username').max(40),
      password: z.string().min(1, 'Enter your password').max(128),
    }),
    handler: (ctx, input) => auth.login(ctx, input.username, input.password),
  }),

  /** Lock screen: check the logged-in user's password again. */
  'auth.unlock': route({
    access: 'user',
    input: z.object({ password: z.string().min(1, 'Enter your password').max(128) }),
    handler: (ctx, input) => auth.unlock(ctx, input.password),
  }),

  'auth.logout': route({ access: 'public', handler: (ctx) => auth.logout(ctx) }),

  'auth.me': route({ access: 'public', handler: (ctx) => auth.sessionInfo(ctx) }),

  'auth.changePassword': route({
    access: 'user',
    mutation: true,
    input: z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(4, 'Password must be at least 4 characters').max(128) }),
    handler: (ctx, input) => auth.changePassword(ctx, input.currentPassword, input.newPassword),
  }),

  /** Reset the owner's password with the recovery code of the business. */
  'auth.recover': route({
    access: 'public',
    input: z.object({
      businessName: zBusinessName,
      recoveryCode: z.string().trim().min(1, 'Enter the recovery code').max(40),
      newPassword: z.string().min(4, 'Password must be at least 4 characters').max(128),
    }),
    handler: (ctx, input) => auth.recoverOwner(ctx, input.recoveryCode, input.newPassword),
  }),

  'auth.regenerateRecoveryCode': route({
    access: 'user',
    mutation: true,
    input: z.object({ password: z.string().min(1).max(128) }),
    handler: (ctx, input) => ({ recoveryCode: auth.regenerateRecoveryCode(ctx, input.password) }),
  }),
};
