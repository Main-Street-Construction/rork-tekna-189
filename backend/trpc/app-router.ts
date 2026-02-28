import { createTRPCRouter } from "./create-context";
import { feedbackRouter } from "./routes/feedback";

export const appRouter = createTRPCRouter({
  feedback: feedbackRouter,
});

export type AppRouter = typeof appRouter;
