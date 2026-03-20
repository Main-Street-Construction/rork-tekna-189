import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  return `https://rork-tekna-189.vercel.app`;
};

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
```

**Step 4 — Add to Vercel env vars:**
```
EXPO_PUBLIC_RORK_API_BASE_URL=https://rork-tekna-189.vercel.app