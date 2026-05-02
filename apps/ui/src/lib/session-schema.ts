import { z } from "zod";

const cursorStateSchema = z.unknown().nullable();

const tabSchema = z.object({
  id: z.string(),
  path: z.string().nullable(),
  name: z.string(),
  language: z.string(),
  content: z.string(),
  savedContent: z.string(),
  cursorState: cursorStateSchema,
  pinned: z.boolean(),
  untitledIndex: z.number().nullable(),
});

const closedTabSchema = z.object({
  id: z.string(),
  path: z.string().nullable(),
  name: z.string(),
  language: z.string(),
  content: z.string(),
  savedContent: z.string(),
  closedAt: z.number(),
});

const sessionBlobSchema = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  activeTabId: z.string().nullable(),
  untitledCounter: z.number().int().nonnegative(),
  tabs: z.array(tabSchema),
  mruOrder: z.array(z.string()),
  recentlyClosed: z.array(closedTabSchema),
});

export type SessionTab = z.infer<typeof tabSchema>;
export type SessionClosedTab = z.infer<typeof closedTabSchema>;
export type SessionBlob = z.infer<typeof sessionBlobSchema>;

const RECENTLY_CLOSED_CAP = 20;

export const EMPTY_SESSION: SessionBlob = {
  version: 1,
  savedAt: 0,
  activeTabId: null,
  untitledCounter: 0,
  tabs: [],
  mruOrder: [],
  recentlyClosed: [],
};

export function parseSessionBlob(value: unknown): SessionBlob {
  const result = sessionBlobSchema.safeParse(value);
  if (!result.success) {
    return EMPTY_SESSION;
  }
  if (result.data.recentlyClosed.length > RECENTLY_CLOSED_CAP) {
    return {
      ...result.data,
      recentlyClosed: result.data.recentlyClosed.slice(0, RECENTLY_CLOSED_CAP),
    };
  }
  return result.data;
}
