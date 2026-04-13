# Atrium — Project Instructions

## Styling: Tailwind v4 with ongoing `@apply` migration

This project uses **Tailwind v4** (configured via `@tailwindcss/vite` in `electron.vite.config.ts`). The theme is declared in CSS-first form at the top of `src/renderer/src/styles/global.css` using `@theme`.

### Current state (migration in progress)

The original hand-written stylesheet was converted to a Tailwind `@apply`-based shim to preserve pixel-perfect styling during migration. Semantic classes like `.btn`, `.panel`, `.workspace-card`, etc. still exist in `global.css`, defined as `@apply` rules that compose Tailwind utilities. Components reference them via `className="panel"`, `className="btn btn-primary"`, etc.

**Goal:** gradually replace these semantic classes with inline Tailwind utilities on `.tsx` elements, deleting the corresponding `@apply` rules from `global.css` as they become unused. Eventually `global.css` should contain only: `@import`, `@theme`, the compat `:root` block, and the small tail of non-convertible CSS (scrollbars, `@keyframes`, `-webkit-app-region`).

### Migration rules for agents

**When you touch a component file for any reason**, consider migrating its styling as a bonus improvement — but only if you can do it safely. The rules:

1. **Multi-usage check before inlining.** Before replacing `className="btn"` with inline utilities, grep the codebase: `grep -rn 'className=.*\bbtn\b' src/renderer/src --include='*.tsx'`. If the class is used in multiple components:
   - Either migrate **all** usages in the same change, or
   - Leave it alone. Do NOT create split-brain state where `.btn` is inlined in one file and still referenced as a class elsewhere.

2. **Some CSS never converts — don't try.** These stay in `global.css` forever, even after everything else is inlined:
   - `::-webkit-scrollbar*` pseudo-elements (no Tailwind utility)
   - `-webkit-app-region: drag/no-drag` (the draggable titlebar region)
   - `@keyframes` blocks (`spin`, `ci-glow`, `pulse-dot`)
   - Custom `font-family` stacks (`SF Mono`, `Fira Code`)
   - Box-shadows using hex-alpha color tricks (e.g., `var(--green)44`)
   - Complex `grid-template-columns` (e.g., `repeat(auto-fill, minmax(...))`)

3. **Compound selectors need conditional classes.** Rules like `.workspace-card.blocked { border-color: var(--red) }` do NOT become utilities — they become `clsx`-style logic in the `.tsx`:
   ```tsx
   <div className={`workspace-card ${blocked ? 'border-red' : ''}`}>
   ```
   This is a legitimate reason to touch component logic, not just styling.

4. **Delete-when-zero.** After migrating a class, verify zero `className=` references remain (`grep -rn 'className=.*\bfoo-bar\b' src/`). If zero, delete the `@apply` rule from `global.css`. Otherwise it rots as dead code.

### Design tokens (defined in `@theme`)

Colors use semantic names. When writing new Tailwind:
- Backgrounds: `bg-bg`, `bg-bg-card`, `bg-bg-card-hover`, `bg-bg-input`
- Borders: `border-line`, `border-line-hover`, `border-line-danger`
- Text: `text-fg`, `text-fg-muted`, `text-fg-link`
- Status colors: `text-green`, `bg-red`, `border-yellow`, etc. (also `orange`, `purple`, `blue`)
- Radius: `rounded-sm` (4px), `rounded-md` (8px)

### Spacing scale — IMPORTANT

This project overrides Tailwind's default `--spacing: 0.25rem` to **`--spacing: 4px`**. The numeric scale is identical to stock Tailwind (`p-4` = 16px, `gap-3` = 12px, `h-10` = 40px), but expressed in px instead of rem. This was done because the original CSS was px-based throughout and the root `font-size` is `13px` (not `16px`), so stock rem-based spacing would be off by a factor of 13/16.

**You don't need to think about this most of the time** — stock Tailwind examples work as-is. The only time it matters is if you see an unusual value and want to verify: `p-N = N*4 px`.

### Font size scale

Also overridden to match the app's pixel design:
- `text-xs` = 11px
- `text-sm` = 12px
- `text-base` = 13px (root)
- `text-lg` = 14px
- `text-xl` = 16px
- `text-2xl` = 18px
- `text-3xl` = 20px

### Values off the grid

For values that don't divide evenly by 4 (padding of 18px, gap of 6px, etc.) or don't match the font scale (10px, 15px), use arbitrary utilities:
- `p-[18px]`, `gap-[6px]`, `tracking-[0.05em]`, `w-[360px]`

## Build & run

- `npm run dev` — electron-vite dev server with HMR
- `npm run build` — Vite production build (main + preload + renderer → `out/`)
- `npm run package` — produces unpackaged `.app` bundle in `dist/mac-arm64/` (fast, for local testing)
- `npm run dist` — full DMG + zip distributables

## Artifacts — DO NOT commit

`tsc --build` emits `.js`/`.jsx`/`.d.ts` alongside sources. These are gitignored but will reappear in your working tree if you run `tsc --build` or `npx tsc -b`. Prefer `tsc --noEmit` for type-checking, or `npm run build` for actual artifacts (which go to `out/`).
