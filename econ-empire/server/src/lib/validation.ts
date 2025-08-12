import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1).max(50),
});

export const CreateGameSchema = z.object({
  totalRounds: z.number().int().min(1).max(50).default(5),
  roundDurationSeconds: z.number().int().min(60).max(7200).default(900),
});

export const TariffItemSchema = z.object({
  productCode: z.string(),
  toCountryCode: z.string(),
  ratePercent: z.number().int().min(0).max(100),
});

export const TariffSubmissionSchema = z.array(TariffItemSchema).min(1);

export const ChatMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  toCountryCode: z.string().optional(),
});