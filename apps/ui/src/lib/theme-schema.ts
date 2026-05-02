import { z } from "zod";

const tokenSettingsSchema = z.object({
  foreground: z.string().optional(),
  background: z.string().optional(),
  fontStyle: z.string().optional(),
});

const tokenColorSchema = z.object({
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  settings: tokenSettingsSchema,
});

export const ThemeSchema = z.object({
  name: z.string(),
  type: z.enum(["dark", "light", "hc-dark", "hc-light"]),
  colors: z.record(z.string(), z.string()).optional(),
  tokenColors: z.array(tokenColorSchema).optional(),
});

export type ParsedTheme = z.infer<typeof ThemeSchema>;
