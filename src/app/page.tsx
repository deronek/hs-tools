import Link from "next/link";

const tools = [
  {
    name: "Forge Profit Calculator",
    description:
      "Compare Hypixel SkyBlock forge recipe profits using bazaar prices and profit-per-hour metrics.",
    href: "/forge",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-4">
        <p className="text-sm font-medium tracking-[0.2em] text-slate-300 uppercase">
          HS Tools
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Practical tools for Hypixel SkyBlock players
        </h1>
        <p className="max-w-2xl text-lg text-slate-300">
          HS Tools is a growing collection of calculators and utilities for
          market analysis, progression planning, and everyday in-game decision
          making.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.name}
            href={tool.href}
            className="group rounded-xl border border-slate-700 bg-slate-900/70 p-5 transition hover:border-sky-500 hover:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">{tool.name}</h2>
              <span className="text-sm text-sky-300 transition group-hover:translate-x-1">
                Open →
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-300">
              {tool.description}
            </p>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-slate-200">
        <h2 className="mb-2 text-xl font-semibold text-white">Project focus</h2>
        <p className="text-sm leading-6 text-slate-300">
          This repository is broader than a single view: it gives a home for
          useful SkyBlock helpers, starting with the Forge Profit Calculator and
          leaving room for future tools.
        </p>
      </section>
    </div>
  );
}
