"use client";

import type {
  BazaarProducts,
  PricedRecipe,
  PricingSettings,
  Recipe,
} from "@/lib/forge";
import type { ReactTable } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  flexRender,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Info,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import itemIconFiles from "@/data/item-icons.json";
import { DEFAULT_SETTINGS, priceRecipe } from "@/lib/forge";
import { cn, formatDuration, formatPercent, parseUnlock } from "@/lib/utils";
import { getWikiItemUrl } from "@/lib/wiki";

const itemIcons: Record<string, string> = itemIconFiles;

type Props = {
  recipes: Recipe[];
  products: BazaarProducts;
  lastUpdated: number;
};

type ForgeColumnMeta = {
  align?: "right";
  cellClassName?: string;
};

type UpdateSettings = <K extends keyof PricingSettings>(
  key: K,
  value: PricingSettings[K],
) => void;

const features = tableFeatures({
  // Required by globalFilteringFeature/filteredRowModel even though no column filters are defined.
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: metaHelper<ForgeColumnMeta>(),
});

const columnHelper = createColumnHelper<typeof features, PricedRecipe>();

type ForgeTable = ReactTable<typeof features, PricedRecipe>;

function getMaxValue(
  table: Pick<ForgeTable, "getFilteredRowModel">,
  valueFor: (recipe: PricedRecipe) => number,
) {
  return table
    .getFilteredRowModel()
    .rows.reduce((best, row) => Math.max(best, valueFor(row.original)), 0);
}

const INITIAL_TABLE_STATE = {
  sorting: [{ id: "profitPerHour", desc: true }],
  pagination: { pageIndex: 0, pageSize: 10 },
};

const DEFAULT_COLUMN = {
  minSize: 80,
  size: 150,
  maxSize: 500,
};

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50].map((size) => ({
  value: String(size),
  label: `${size} rows`,
}));

const getRecipeRowId = (recipe: PricedRecipe) =>
  `${recipe.section}-${recipe.name}`;

const INPUT_OPTIONS = [
  { value: "instant", label: "Instant buy, lowest sell offer" },
  { value: "order", label: "Buy order, highest bid + 0.1" },
];

const OUTPUT_OPTIONS = [
  { value: "instant", label: "Instant sell, highest buy order" },
  { value: "offer", label: "Sell offer, lowest offer - 0.1" },
];

const TAX_OPTIONS = [
  { value: "1.25", label: "1.25% (no perk)" },
  { value: "1.125", label: "1.125% (Bazaar Flipper 1)" },
  { value: "1", label: "1% (Bazaar Flipper 2)" },
];

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 0,
});

const standardFormatter = new Intl.NumberFormat("en", {
  notation: "standard",
  maximumFractionDigits: 0,
});

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

function formatRelativeTime(timestamp: number) {
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  if (Math.abs(diffSeconds) < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormat.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormat.format(diffHours, "hour");
  }
  return relativeTimeFormat.format(Math.round(diffHours / 24), "day");
}

function RelativeTime({ timestamp }: { timestamp: number }) {
  const [relative, setRelative] = useState(() => formatRelativeTime(timestamp));

  useEffect(() => {
    const update = () => setRelative(formatRelativeTime(timestamp));
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <time dateTime={new Date(timestamp).toISOString()} suppressHydrationWarning>
      {relative}
    </time>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Coins({ value, className }: { value: number; className?: string }) {
  const parts = compactFormatter.formatToParts(value);
  const hasSuffix = parts.some((part) => part.type === "compact");

  const compact = (
    <span data-full-value={value} className={className}>
      {parts.map((part, index) =>
        part.type === "compact" ? (
          <span
            key={index}
            className="text-muted-foreground ml-1 inline-block w-2.5 text-right text-xs"
          >
            {part.value}
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </span>
  );

  if (!hasSuffix) return compact;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="select-text">{compact}</span>} />
      <TooltipContent>{standardFormatter.format(value)}</TooltipContent>
    </Tooltip>
  );
}

function Profit({
  value,
  max = 0,
  className,
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  return (
    <MetricBar value={value} max={max} className={className} prominent>
      <Coins
        value={value}
        className={cn(value < 0 && "text-red-600 dark:text-red-400")}
      />
    </MetricBar>
  );
}

function MetricBar({
  value,
  max,
  children,
  className,
  prominent = false,
}: {
  value: number;
  max: number;
  children: React.ReactNode;
  className?: string;
  prominent?: boolean;
}) {
  const barWidth =
    max > 0 && value > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <span
      className={cn(
        "relative flex w-full items-center justify-end pb-1",
        className,
      )}
    >
      {barWidth > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-0 bottom-0 rounded-full bg-emerald-600/25 dark:bg-emerald-400/25",
            prominent
              ? "h-0.75 bg-emerald-600/55 dark:bg-emerald-400/50"
              : "h-0.5 bg-emerald-600/45 dark:bg-emerald-400/40",
          )}
          style={{ width: `${barWidth}%` }}
        />
      )}
      <span className="relative">{children}</span>
    </span>
  );
}

function Duration({ seconds }: { seconds: number }) {
  const parts = [...formatDuration(seconds).matchAll(/(\d+)([dhms])/g)];

  return (
    <span className="tabular-nums">
      {parts.map((part, index) => (
        <span key={part[2]}>
          {index > 0 && " "}
          {part[1]}
          <span className="text-muted-foreground ml-1 text-xs">{part[2]}</span>
        </span>
      ))}
    </span>
  );
}

function ItemIcon({
  id,
  className,
}: {
  id: string | null;
  className?: string;
}) {
  if (!id) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- keep local 16 px icons out of the image optimizer
    <img
      key={id}
      src={`/item-icons/${itemIcons[id]}`}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      className={cn("size-7 shrink-0 [image-rendering:pixelated]", className)}
    />
  );
}

function WikiLink({ name }: { name: string }) {
  return (
    <a
      href={getWikiItemUrl(name)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${name} on the Hypixel SkyBlock Wiki`}
      title={`Open ${name} on the Hypixel SkyBlock Wiki`}
      className="text-muted-foreground hover:text-primary focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <ExternalLink aria-hidden="true" className="size-4" />
    </a>
  );
}

function IngredientList({ recipe }: { recipe: PricedRecipe }) {
  return (
    <div className="space-y-1.5">
      {recipe.ingredients.map((ingredient) => (
        <div
          key={ingredient.name}
          className="grid min-h-11 grid-cols-[minmax(0,1fr)_44px_4rem] items-center gap-1 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex w-7 shrink-0 items-center justify-center">
              <ItemIcon id={ingredient.id} className="size-6" />
            </span>
            <span className="shrink-0">
              <span className="inline-block min-w-[3ch] text-right font-medium tabular-nums">
                {ingredient.qty}
              </span>
              <span className="text-muted-foreground ml-0.5">×</span>
            </span>
            <span className="truncate">{ingredient.name}</span>
          </span>
          <WikiLink name={ingredient.name} />
          <span className="text-right tabular-nums">
            <Coins value={ingredient.cost} />
          </span>
        </div>
      ))}
    </div>
  );
}

function UnlockText({ hotm }: { hotm: string }) {
  const { tier, requirement } = parseUnlock(hotm);
  return (
    <>
      HotM {tier}
      {requirement && (
        <>
          <span className="text-muted-foreground/50 px-1 select-none">·</span>
          {requirement}
        </>
      )}
    </>
  );
}

function RecipeDetails({ recipe }: { recipe: PricedRecipe }) {
  return (
    <Collapsible>
      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_44px_4rem] items-center gap-1">
        <CollapsibleTrigger className="group hover:bg-muted/50 -m-1 flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md p-1 text-left transition-colors">
          <span className="flex w-7 shrink-0 items-center justify-center">
            <ItemIcon id={recipe.outputId} />
          </span>
          <span className="min-w-0 flex-1">
            <p className="leading-tight font-semibold break-words">
              {recipe.name}
            </p>
            <p className="text-muted-foreground truncate text-xs leading-4">
              <UnlockText hotm={recipe.hotm} />
            </p>
          </span>
        </CollapsibleTrigger>
        <WikiLink name={recipe.name} />
        <CollapsibleTrigger
          aria-label={`Toggle ${recipe.name} ingredients`}
          className="group hover:bg-muted/50 flex size-11 cursor-pointer items-center justify-center justify-self-end rounded-md transition-colors"
        >
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="pt-2">
          <IngredientList recipe={recipe} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ConfidenceInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="About the confidence score"
            className="text-muted-foreground"
          >
            <Info className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 max-w-[280px]">
        <p className="text-sm leading-relaxed">
          A snapshot score from order depth (40%), daily volume (35%), and
          bid/ask spread (25%). Order or offer fills multiply it by 0.85. It is
          not a guarantee of fill.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SettingsPopover({
  settings,
  update,
  onReset,
}: {
  settings: PricingSettings;
  update: UpdateSettings;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="group gap-3"
          >
            <SlidersHorizontal className="size-4" />
            <span>Settings</span>
            <ChevronDown className="ml-1 size-3 transition-transform duration-200 group-aria-expanded:rotate-180" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold">Calculation settings</h4>
            <p className="text-muted-foreground text-sm">
              How fills, tax, and forge time are valued.
            </p>
          </div>

          <div className="space-y-4">
            <Field label="Buy inputs">
              <Select
                items={INPUT_OPTIONS}
                value={settings.inputMode}
                onValueChange={(value) =>
                  update("inputMode", value as "instant" | "order")
                }
              >
                <SelectTrigger className="w-full" aria-label="Buy inputs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INPUT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Sell output">
              <Select
                items={OUTPUT_OPTIONS}
                value={settings.outputMode}
                onValueChange={(value) =>
                  update("outputMode", value as "instant" | "offer")
                }
              >
                <SelectTrigger className="w-full" aria-label="Sell output">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Bazaar tax">
              <Select
                items={TAX_OPTIONS}
                value={String(settings.taxRate)}
                onValueChange={(value) => {
                  if (!value) return;
                  update("taxRate", Number(value));
                }}
              >
                <SelectTrigger className="w-full" aria-label="Bazaar tax">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={`Forge time reduction: ${settings.timeReduction}%`}
              htmlFor="time-reduction"
            >
              <Slider
                id="time-reduction"
                value={settings.timeReduction}
                onValueChange={(value) =>
                  update("timeReduction", Number(value))
                }
                min={0}
                max={55}
                step={0.5}
              />
            </Field>

            <Field
              label={`Minimum confidence: ${settings.minConfidence}%`}
              htmlFor="min-confidence"
            >
              <Slider
                id="min-confidence"
                value={settings.minConfidence}
                onValueChange={(value) =>
                  update("minConfidence", Number(value))
                }
                min={0}
                max={100}
                step={5}
              />
            </Field>
          </div>

          <Separator />

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onReset}
            >
              <RotateCcw />
              Reset
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor(
    (recipe) =>
      `${recipe.name} ${recipe.section.replaceAll("_", " ")} ${recipe.ingredients
        .map((ingredient) => ingredient.name)
        .join(" ")}`,
    {
      id: "recipe",
      header: "Recipe",
      cell: ({ row }) => <RecipeDetails recipe={row.original} />,
      sortFn: sortFn_text,
      size: 350,
      minSize: 220,
      maxSize: 480,
      enableHiding: false,
      meta: { cellClassName: "px-4 py-3 whitespace-normal" },
    },
  ),
  columnHelper.accessor("cost", {
    header: "Cost",
    cell: ({ getValue, table }) => (
      <MetricBar
        value={getValue()}
        max={getMaxValue(table, (recipe) => recipe.cost)}
      >
        <Coins value={getValue()} />
      </MetricBar>
    ),
    sortFn: sortFn_basic,
    size: 80,
    enableGlobalFilter: false,
    meta: {
      align: "right",
      cellClassName: "text-right tabular-nums",
    },
  }),
  columnHelper.accessor("revenue", {
    header: "Revenue",
    cell: ({ getValue, table }) => (
      <MetricBar
        value={getValue()}
        max={getMaxValue(table, (recipe) => recipe.revenue)}
      >
        <Coins value={getValue()} />
      </MetricBar>
    ),
    sortFn: sortFn_basic,
    sortDescFirst: true,
    size: 100,
    enableGlobalFilter: false,
    meta: {
      align: "right",
      cellClassName: "text-right tabular-nums",
    },
  }),
  columnHelper.accessor("profit", {
    header: "Profit",
    cell: ({ getValue, table }) => (
      <Profit
        value={getValue()}
        max={getMaxValue(table, (recipe) => recipe.profit)}
      />
    ),
    sortFn: sortFn_basic,
    sortDescFirst: true,
    size: 110,
    enableGlobalFilter: false,
    meta: { align: "right", cellClassName: "text-right" },
  }),
  columnHelper.accessor("profitPerHour", {
    header: "Profit/hr",
    cell: ({ getValue, table }) => (
      <Profit
        value={getValue()}
        max={getMaxValue(table, (recipe) => recipe.profitPerHour)}
      />
    ),
    sortFn: sortFn_basic,
    sortDescFirst: true,
    size: 130,
    enableGlobalFilter: false,
    meta: { align: "right", cellClassName: "text-right" },
  }),
  columnHelper.accessor((recipe) => recipe.hours * 3_600, {
    id: "time",
    header: "Time",
    cell: ({ getValue, table }) => (
      <MetricBar
        value={getValue()}
        max={getMaxValue(table, (recipe) => recipe.hours * 3_600)}
      >
        <Duration seconds={getValue()} />
      </MetricBar>
    ),
    sortFn: sortFn_basic,
    size: 80,
    enableGlobalFilter: false,
    meta: {
      align: "right",
      cellClassName: "text-right tabular-nums",
    },
  }),
  columnHelper.accessor("confidence", {
    header: "Conf.",
    cell: ({ getValue }) => (
      <MetricBar value={getValue()} max={100}>
        <span className="tabular-nums">
          {Math.round(getValue())}
          <span className="text-muted-foreground ml-1 text-xs">%</span>
        </span>
      </MetricBar>
    ),
    sortFn: sortFn_basic,
    sortDescFirst: true,
    size: 110,
    enableGlobalFilter: false,
    meta: { align: "right", cellClassName: "text-right pr-4 tabular-nums" },
  }),
]);

function TableControls({ table }: { table: ForgeTable }) {
  const sortOptions = table
    .getAllLeafColumns()
    .filter((column) => column.getCanSort())
    .map((column) => ({
      value: column.id,
      label:
        column.id === "confidence"
          ? "Confidence"
          : typeof column.columnDef.header === "string"
            ? column.columnDef.header
            : column.id,
    }));
  const sortValue = table.state.sorting[0]?.id ?? "profitPerHour";

  return (
    <>
      <div className="relative max-w-xs min-w-40 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={String(table.state.globalFilter ?? "")}
          onChange={(event) => {
            table.setGlobalFilter(event.target.value);
            table.setPageIndex(0);
          }}
          placeholder="Search recipes, sections, or inputs"
          aria-label="Search recipes"
          className="pl-8"
        />
      </div>
      <div className="lg:hidden">
        <Select
          items={sortOptions}
          value={sortValue}
          onValueChange={(value) => {
            if (!value) return;
            table.setSorting([
              {
                id: value,
                desc: !["recipe", "cost", "time"].includes(value),
              },
            ]);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Sort recipes">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function TablePagination({ table }: { table: ForgeTable }) {
  const { pageIndex, pageSize } = table.state.pagination;
  const rowCount = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(1, table.getPageCount());

  return (
    <div className="bg-background-200 flex flex-wrap items-center justify-between gap-3 border-t p-3">
      <p className="text-muted-foreground text-sm tabular-nums">
        {rowCount} {rowCount === 1 ? "recipe" : "recipes"}, page {pageIndex + 1}{" "}
        of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        <Select
          items={PAGE_SIZE_OPTIONS}
          value={String(pageSize)}
          onValueChange={(value) => {
            table.setPageSize(Number(value));
            table.setPageIndex(0);
          }}
        >
          <SelectTrigger size="sm" className="w-24" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function DesktopTable({ table }: { table: ForgeTable }) {
  const rows = table.getRowModel().rows;

  return (
    <div className="hidden overflow-x-auto lg:block">
      <Table className="table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const toggleSort = canSort
                  ? header.column.getToggleSortingHandler()
                  : undefined;
                const meta = header.column.columnDef.meta;
                const headerName =
                  header.column.id === "confidence"
                    ? "Confidence"
                    : typeof header.column.columnDef.header === "string"
                      ? header.column.columnDef.header
                      : "column";

                return (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() }}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={cn(
                      "relative px-3 font-normal",
                      canSort && "hover:bg-muted/60",
                      sorted && "text-primary",
                    )}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex w-full min-w-0 items-center gap-1">
                        <div
                          role={canSort ? "button" : undefined}
                          tabIndex={canSort ? 0 : undefined}
                          onClick={toggleSort}
                          onKeyDown={(event) => {
                            if (!canSort) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSort?.(event);
                            }
                          }}
                          aria-label={
                            canSort ? `Sort by ${headerName}` : undefined
                          }
                          aria-disabled={canSort ? undefined : true}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-1 rounded-sm py-1 outline-none select-none",
                            meta?.align === "right"
                              ? "justify-end"
                              : "justify-between",
                            canSort &&
                              "focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-2",
                          )}
                        >
                          <span className="truncate">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                          {canSort &&
                            (sorted ? (
                              <ChevronDown
                                aria-hidden="true"
                                className={cn(
                                  "size-4 shrink-0 transition-transform",
                                  sorted === "asc" && "rotate-180",
                                )}
                              />
                            ) : (
                              <ChevronsUpDown
                                aria-hidden="true"
                                className="text-muted-foreground size-4 shrink-0"
                              />
                            ))}
                        </div>
                        {header.column.id === "confidence" && (
                          <ConfidenceInfoPopover />
                        )}
                      </div>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow
                key={row.id}
                className="bg-background-200 even:bg-background"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className={cell.column.columnDef.meta?.cellClassName}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="text-muted-foreground h-24 text-center"
              >
                No recipes match those filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MobileCards({ table }: { table: ForgeTable }) {
  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-2 p-2 lg:hidden">
      {rows.length > 0 ? (
        rows.map(({ original: recipe }) => (
          <div
            key={`${recipe.section}-${recipe.name}`}
            className="rounded-md border p-3"
          >
            <Collapsible>
              <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_44px_4rem] items-center gap-1">
                <CollapsibleTrigger className="group hover:bg-muted/50 -m-1 flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md p-1 text-left transition-colors">
                  <span className="flex w-7 shrink-0 items-center justify-center">
                    <ItemIcon id={recipe.outputId} />
                  </span>
                  <p className="min-w-0 text-sm font-semibold break-words">
                    {recipe.name}
                  </p>
                </CollapsibleTrigger>
                <WikiLink name={recipe.name} />
                <CollapsibleTrigger
                  aria-label={`Toggle ${recipe.name} details`}
                  className="group hover:bg-muted/50 flex size-11 cursor-pointer items-center justify-center justify-self-end rounded-md transition-colors"
                >
                  <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-aria-expanded:rotate-180" />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <Profit value={recipe.profit} className="w-auto" />
                    <span className="text-muted-foreground tabular-nums">
                      <Coins value={recipe.profitPerHour} />
                      /hr
                    </span>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <span className="truncate">
                      {recipe.section.replaceAll("_", " ")},{" "}
                      <UnlockText hotm={recipe.hotm} />
                      {", "}
                      {formatDuration(recipe.durationSeconds)}
                    </span>
                    <span className="select-none">·</span>
                    <span className="tabular-nums">
                      {formatPercent(recipe.confidence)}
                    </span>
                    <ConfidenceInfoPopover />
                  </div>
                  <IngredientList recipe={recipe} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ))
      ) : (
        <div className="p-8 text-center">
          <p className="text-muted-foreground">
            No recipes match those filters.
          </p>
        </div>
      )}
    </div>
  );
}

export function ForgeCalculator({ recipes, products, lastUpdated }: Props) {
  const [settings, setSettings] = useState<PricingSettings>(DEFAULT_SETTINGS);

  const priced = useMemo(
    () =>
      recipes
        .map((recipe) => priceRecipe(recipe, products, settings))
        .filter((recipe): recipe is PricedRecipe => recipe !== null),
    [recipes, products, settings],
  );

  const eligible = useMemo(
    () =>
      priced.filter((recipe) => recipe.confidence >= settings.minConfidence),
    [priced, settings.minConfidence],
  );

  const table = useTable({
    features,
    columns,
    data: eligible,
    initialState: INITIAL_TABLE_STATE,
    globalFilterFn: filterFn_includesString,
    enableSortingRemoval: false,
    enableMultiSort: false,
    defaultColumn: DEFAULT_COLUMN,
    getRowId: getRecipeRowId,
    autoResetPageIndex: true,
  });

  const update: UpdateSettings = (key, value) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <>
      <header className="pb-3 lg:pb-2">
        <h1 className="mb-2 text-2xl font-bold">
          SkyBlock Forge Profit Calculator
        </h1>
        <p className="text-lg">
          Find the most profitable Hypixel SkyBlock forge recipes from live
          bazaar prices.
        </p>
      </header>

      <p className="text-muted-foreground text-sm">
        Prices updated <RelativeTime timestamp={lastUpdated} />
      </p>

      <section className="py-1">
        <div className="mx-auto w-full max-w-md rounded-md border md:max-w-4xl lg:max-w-screen-xl">
          <div className="bg-background-200 flex flex-wrap items-center gap-2 border-b p-3">
            <TableControls table={table} />
            <div className="ml-auto flex items-center gap-2">
              <SettingsPopover
                settings={settings}
                update={update}
                onReset={() => setSettings(DEFAULT_SETTINGS)}
              />
            </div>
          </div>
          <DesktopTable table={table} />
          <MobileCards table={table} />
          <TablePagination table={table} />
        </div>
      </section>
    </>
  );
}
