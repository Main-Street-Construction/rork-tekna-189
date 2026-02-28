import * as z from "zod";
import { createTRPCRouter, publicProcedure } from "../create-context";

interface FeedbackItem {
  id: string;
  message: string;
  userName: string;
  createdAt: string;
}

export const feedbackStore: FeedbackItem[] = [];

export const feedbackRouter = createTRPCRouter({
  submit: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(2000),
        userName: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const item: FeedbackItem = {
        id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        message: input.message,
        userName: input.userName ?? "Anonymous",
        createdAt: new Date().toISOString(),
      };
      feedbackStore.push(item);
      console.log("[Feedback] New submission:", item);
      return { success: true, id: item.id };
    }),

  list: publicProcedure.query(() => {
    return feedbackStore.slice().reverse();
  }),
});
