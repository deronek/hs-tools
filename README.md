# HS Tools

HS Tools is a collection of tools for Hypixel SkyBlock players.

The current tool is the Forge Profit Calculator, which compares forge recipe profits using live bazaar pricing. It covers 30 of 119 recipes today. See [recipe coverage](docs/recipes.md) and [design notes](docs/design.md).

## Development

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000/forge`. The root URL redirects there.

Useful commands:

```sh
pnpm build      # production build
pnpm start      # serve the production build
pnpm test:unit  # run pricing tests
pnpm lint       # Prettier check, ESLint, and tsc
pnpm format     # write Prettier changes
```

## Tech stack

- Next.js 16.4.3 and React 19.2.1
- Tailwind CSS 4.1.15
- shadcn/ui with Base UI
- TanStack Table 9
- Zod 4
- Vitest 3
- Node 24
