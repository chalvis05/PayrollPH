import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const PasswordSchema = z.string().min(12, 'Use at least 12 characters').max(200, 'Too long');

export const EmailSchema = z.email().max(254);

export const TotpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

/** First-run setup wizard: creates the owner account and basic settings. */
export const SetupSchema = z.object({
  ownerName: z.string().trim().min(1).max(120),
  email: EmailSchema,
  password: PasswordSchema,
  payFrequency: z.enum(['semi_monthly', 'monthly']),
  region: z.string().min(1),
});
export type SetupInput = z.infer<typeof SetupSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
  totpCode: TotpCodeSchema.optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const TotpVerifySchema = z.object({ code: TotpCodeSchema });
export type TotpVerifyInput = z.infer<typeof TotpVerifySchema>;

export const CreateViewerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: EmailSchema,
  password: PasswordSchema,
});
export type CreateViewerInput = z.infer<typeof CreateViewerSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: PasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  totpEnabled: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;
