import { z } from "zod";

export const verificationReelSchema = z.object({
  url: z.string().max(500).nullable(),
  postedAt: z.string().max(64).nullable(),
  views: z.number().int().nonnegative().nullable(),
});

export const verificationSignalArraySchema = z.array(
  z.string().trim().min(1).max(240),
).max(8);
export const optionalVerificationSignalArraySchema = z.preprocess(
  (value) => value == null ? [] : value,
  verificationSignalArraySchema,
);

export const instagramVerificationResultSchema = z.object({
  handle: z.string().min(1).max(30),
  duplicateStatus: z.enum(["available", "duplicate", "protected", "unknown"]),
  duplicateMessage: z.string().max(500).nullable(),
  exists: z.boolean().nullable(),
  isPrivate: z.boolean().nullable(),
  isPersonalCreator: z.boolean().nullable(),
  bio: z.string().max(2000).nullable(),
  followers: z.number().int().nonnegative().nullable(),
  recentActivity: z.boolean().nullable(),
  lastActivityAt: z.string().max(64).nullable(),
  japaneseTarget: z.boolean().nullable(),
  koreaConnection: z.boolean().nullable(),
  categoryRelevant: z.boolean().nullable(),  creatorSignals: optionalVerificationSignalArraySchema,
  targetSignals: optionalVerificationSignalArraySchema,
  koreaSignals: optionalVerificationSignalArraySchema,
  categorySignals: optionalVerificationSignalArraySchema,
  reels: z.array(verificationReelSchema).max(8),
  note: z.string().max(500).nullable(),
});

export const verificationPayloadSchema = z.object({
  jobId: z.string().uuid(),
  category: z.enum(["beauty", "food"]),
  results: z.array(instagramVerificationResultSchema).min(1).max(30),
});

export type InstagramVerificationResult = z.infer<typeof instagramVerificationResultSchema>;
export type VerificationPayload = z.infer<typeof verificationPayloadSchema>;
