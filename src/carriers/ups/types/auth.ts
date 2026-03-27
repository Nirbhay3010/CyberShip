import { z } from "zod";

export const UpsTokenResponseSchema = z.object({
  token_type: z.string(),
  access_token: z.string(),
  expires_in: z.coerce.number(),
  issued_at: z.string(),
  client_id: z.string(),
  status: z.string(),
});

export type UpsTokenResponse = z.infer<typeof UpsTokenResponseSchema>;
