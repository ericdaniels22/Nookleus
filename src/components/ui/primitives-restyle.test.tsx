// Issue #909 — design v2 step 1: every shadcn primitive is restyled through
// the §2.0 tokens with its public API (exports, variant keys, props)
// preserved. The binding rules exercised here, from docs/design-system.md:
//   §1.3  no drop shadows except floating layers (popovers, dialogs, sheets)
//   §4    radius: 8px (md) inputs/buttons, 10px (lg) cards, 12px (xl) dialogs
//   §5    secondary button = transparent bg + --input border + --text-secondary;
//         ghost = no border, hover --muted; destructive = danger fill;
//         badges are tints, never solid-fill
//   §5    focus ring = 0 0 0 2px var(--background), 0 0 0 4px var(--ring)
//         (Tailwind: ring-2 ring-ring ring-offset-2 ring-offset-background)
//   §7.4  form controls stay 16px — no md:text-sm downgrade (iPad auto-zoom)
// Dark-only: no dark: variants and no references to deleted legacy vars.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("sonner", () => ({ Toaster: () => null, toast: {} }));

import { buttonVariants } from "./button";
import { badgeVariants } from "./badge";
import { Card } from "./card";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

const UI_DIR = resolve(process.cwd(), "src/components/ui");

function uiSources(): Array<[string, string]> {
  return readdirSync(UI_DIR)
    .filter((name) => /\.tsx$/.test(name) && !name.includes(".test."))
    .map((name) => [name, readFileSync(join(UI_DIR, name), "utf8")]);
}

// The public API of each primitive module, frozen before the restyle.
// A restyle that adds or removes an export is an API break, not a restyle.
const EXPORT_MANIFEST: Record<string, string[]> = {
  badge: ["Badge", "badgeVariants"],
  button: ["Button", "buttonVariants"],
  card: [
    "Card",
    "CardAction",
    "CardContent",
    "CardDescription",
    "CardFooter",
    "CardHeader",
    "CardTitle",
  ],
  combobox: [
    "Combobox",
    "ComboboxChip",
    "ComboboxChips",
    "ComboboxChipsInput",
    "ComboboxCollection",
    "ComboboxContent",
    "ComboboxEmpty",
    "ComboboxGroup",
    "ComboboxInput",
    "ComboboxItem",
    "ComboboxLabel",
    "ComboboxList",
    "ComboboxSeparator",
    "ComboboxTrigger",
    "ComboboxValue",
    "useComboboxAnchor",
  ],
  dialog: [
    "Dialog",
    "DialogClose",
    "DialogContent",
    "DialogDescription",
    "DialogFooter",
    "DialogHeader",
    "DialogOverlay",
    "DialogPortal",
    "DialogTitle",
    "DialogTrigger",
  ],
  "dropdown-menu": [
    "DropdownMenu",
    "DropdownMenuCheckboxItem",
    "DropdownMenuContent",
    "DropdownMenuGroup",
    "DropdownMenuItem",
    "DropdownMenuLabel",
    "DropdownMenuPortal",
    "DropdownMenuRadioGroup",
    "DropdownMenuRadioItem",
    "DropdownMenuSeparator",
    "DropdownMenuShortcut",
    "DropdownMenuSub",
    "DropdownMenuSubContent",
    "DropdownMenuSubTrigger",
    "DropdownMenuTrigger",
  ],
  "input-group": [
    "InputGroup",
    "InputGroupAddon",
    "InputGroupButton",
    "InputGroupInput",
    "InputGroupText",
    "InputGroupTextarea",
  ],
  input: ["Input"],
  label: ["Label"],
  select: [
    "Select",
    "SelectContent",
    "SelectGroup",
    "SelectItem",
    "SelectLabel",
    "SelectScrollDownButton",
    "SelectScrollUpButton",
    "SelectSeparator",
    "SelectTrigger",
    "SelectValue",
  ],
  separator: ["Separator"],
  sheet: [
    "Sheet",
    "SheetClose",
    "SheetContent",
    "SheetDescription",
    "SheetFooter",
    "SheetHeader",
    "SheetTitle",
    "SheetTrigger",
  ],
  sonner: ["Toaster"],
  switch: ["Switch"],
  table: [
    "Table",
    "TableBody",
    "TableCaption",
    "TableCell",
    "TableFooter",
    "TableHead",
    "TableHeader",
    "TableRow",
  ],
  tabs: ["Tabs", "TabsContent", "TabsList", "TabsTrigger", "tabsListVariants"],
  textarea: ["Textarea"],
};

describe("primitive restyle — public API preserved (#909)", () => {
  it.each(Object.entries(EXPORT_MANIFEST))(
    "%s exports exactly its pre-restyle API",
    async (module, expected) => {
      const mod = await import(`./${module}.tsx`);
      expect(Object.keys(mod).sort()).toEqual([...expected].sort());
    },
  );
});

describe("primitive restyle — dark-only single code path", () => {
  it("ships no dark: variants in src/components/ui", () => {
    const offenders = uiSources()
      .filter(([, source]) => /\bdark:/.test(source))
      .map(([name]) => name);
    expect(
      offenders,
      "fold dark: branches into the single dark-only styling",
    ).toEqual([]);
  });

  it("references no deleted legacy custom properties", () => {
    const offenders = uiSources()
      .filter(([, source]) =>
        /var\(--(?:gradient-|shadow-card|shadow-vibrant|shadow-glow|vibrant-)/.test(
          source,
        ),
      )
      .map(([name]) => name);
    expect(
      offenders,
      "these vars were deleted from globals.css and now render as nothing",
    ).toEqual([]);
  });
});

describe("Button — §5 variant conventions through buttonVariants", () => {
  const base = buttonVariants({ variant: "default" });

  it("keeps the gradient variant key as an alias of the solid primary", () => {
    expect(buttonVariants({ variant: "gradient" })).toBe(base);
  });

  it("default is solid emerald at 8px radius with no shadow", () => {
    expect(base).toMatch(/\bbg-primary\b/);
    expect(base).toContain("text-primary-foreground");
    expect(base).toMatch(/\brounded-md\b/);
  });

  it("secondary is transparent bg + --input border + --text-secondary", () => {
    const secondary = buttonVariants({ variant: "secondary" });
    expect(secondary).toContain("border-input");
    expect(secondary).toContain("bg-transparent");
    expect(secondary).toContain("text-text-secondary");
  });

  it("outline renders the same secondary treatment (§5 has one secondary look)", () => {
    expect(buttonVariants({ variant: "outline" })).toBe(
      buttonVariants({ variant: "secondary" }),
    );
  });

  it("ghost has no border and hovers --muted", () => {
    const ghost = buttonVariants({ variant: "ghost" });
    expect(ghost).toContain("hover:bg-muted");
    expect(ghost).not.toContain("border-input");
  });

  it("destructive is a danger fill, not a tint", () => {
    const destructive = buttonVariants({ variant: "destructive" });
    expect(destructive).not.toContain("bg-destructive/10");
    expect(destructive).toContain("text-white");
  });

  it("focus is the double ring: 2px background offset + ring color", () => {
    expect(base).toContain("focus-visible:ring-2");
    expect(base).toContain("focus-visible:ring-ring");
    expect(base).toContain("focus-visible:ring-offset-2");
  });

  it.each(["default", "gradient", "secondary", "outline", "ghost", "destructive", "link"] as const)(
    "%s casts no drop shadow (§1.3 — buttons are not floating layers)",
    (variant) => {
      expect(buttonVariants({ variant })).not.toMatch(
        /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl)\b/,
      );
    },
  );
});

describe("Badge — §5 tints, never solid-fill", () => {
  it("default is the emerald tint with accent text", () => {
    const badge = badgeVariants({ variant: "default" });
    expect(badge).toContain("bg-accent-tint");
    expect(badge).toContain("text-accent-text");
  });

  it("keeps the vibrant variant key as an alias of the default tint", () => {
    expect(badgeVariants({ variant: "vibrant" })).toBe(
      badgeVariants({ variant: "default" }),
    );
  });
});

describe("Card — §4/§5 hairline surface at 10px radius, no shadow", () => {
  it("renders with a --border hairline and rounded-lg, shadowless", () => {
    render(<Card data-testid="card">body</Card>);
    const card = document.querySelector('[data-slot="card"]')!;
    expect(card).not.toBeNull();
    const cls = card.className;
    expect(cls).toMatch(/\brounded-lg\b/);
    expect(cls).toMatch(/\bborder\b/);
    expect(cls).not.toMatch(/\brounded-xl\b/);
    expect(cls).not.toContain("shadow-[");
    expect(cls).not.toContain("ring-1");
  });
});

describe("form controls — §7.4 16px floor, §4 8px radius, §5 focus ring", () => {
  it("Input stays 16px (no md:text-sm), rounded-md, double focus ring", () => {
    render(<Input />);
    const cls = document.querySelector('[data-slot="input"]')!.className;
    expect(cls).not.toContain("md:text-sm");
    expect(cls).toMatch(/\btext-base\b/);
    expect(cls).toMatch(/\brounded-md\b/);
    expect(cls).toContain("focus-visible:ring-2");
  });

  it("Textarea stays 16px (no md:text-sm) and rounded-md", () => {
    render(<Textarea />);
    const cls = document.querySelector('[data-slot="textarea"]')!.className;
    expect(cls).not.toContain("md:text-sm");
    expect(cls).toMatch(/\btext-base\b/);
    expect(cls).toMatch(/\brounded-md\b/);
  });
});

describe("Tabs — §1.1 active tab is not the view's solid emerald", () => {
  it("styles the active trigger without a solid bg-primary fill", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">content</TabsContent>
      </Tabs>,
    );
    const cls = document.querySelector('[data-slot="tabs-trigger"]')!.className;
    expect(cls).not.toMatch(/data-active:bg-primary\b/);
    expect(cls).toContain("data-active:bg-");
  });
});
