import { z } from 'zod';
import { assertionSchema } from './assertionSchema.js';

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export const checkInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
      message: 'Поддерживаются только http и https',
    }),
  method: z.enum(HTTP_METHODS).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(64_000).nullable().default(null),
  intervalSeconds: z.number().int().min(10).max(86_400).default(60),
  timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
  retries: z.number().int().min(0).max(5).default(1),
  followRedirects: z.boolean().default(true),
  insecureSkipTlsVerify: z.boolean().default(false),
  assertions: z.array(assertionSchema).max(20).default([]),
  degradedThresholdMs: z.number().int().min(1).max(600_000).nullable().default(null),
  failureThreshold: z.number().int().min(1).max(10).default(2),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  enabled: z.boolean().default(true),
  channelIds: z.array(z.string().uuid()).max(20).default([]),
});

export const checkUpdateSchema = checkInputSchema.partial();

export type CheckInput = z.infer<typeof checkInputSchema>;
export type CheckUpdate = z.infer<typeof checkUpdateSchema>;
