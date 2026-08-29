import { z } from 'zod';

/**
 * Ассерты описывают, что считается корректным ответом. Хранятся в БД как jsonb-массив,
 * поэтому схема — единственный источник правды и для API, и для раннера.
 */
export const assertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    codes: z.array(z.number().int().min(100).max(599)).min(1),
  }),
  z.object({
    type: z.literal('status_range'),
    min: z.number().int().min(100).max(599),
    max: z.number().int().min(100).max(599),
  }),
  z.object({
    type: z.literal('body_contains'),
    value: z.string().min(1),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('body_not_contains'),
    value: z.string().min(1),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('json_path'),
    path: z.string().min(1),
    operator: z.enum(['equals', 'not_equals', 'contains', 'exists']).default('equals'),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  }),
  z.object({
    type: z.literal('max_latency_ms'),
    value: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('header_equals'),
    name: z.string().min(1),
    value: z.string(),
  }),
]);

export type Assertion = z.infer<typeof assertionSchema>;

export type FailedAssertion = {
  assertion: Assertion;
  message: string;
  actual: string | null;
};
