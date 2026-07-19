Winston's operator dashboard — a Next.js app for managing per-project budgets against the [Winston proxy](../README.md), authenticated with [Clerk](https://clerk.com).

## Getting Started

Requires the Winston proxy running locally (see the [root README](../README.md#quick-start)) and the following environment variables:

- `NEXT_PUBLIC_API_URL` — base URL of the Winston proxy
- `NEXT_PUBLIC_WINSTON_API_KEY` — proxy admin API key
- Clerk auth keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
