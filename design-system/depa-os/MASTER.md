# DEPA OS — Design System Master

This file is the source of truth for every DEPA OS screen. Page-specific files in `pages/` may refine layout, but may not replace the brand palette or typography.

## Direction

- Dark-first, architectural, minimal, calm and operational.
- Large compositional regions, precise grid, thin dividers and restrained surfaces.
- Avoid generic SaaS cards, glassmorphism, decorative gradients, deep rounding and gratuitous charts.
- Brand accent is controlled: one primary orange CTA or key accent per region.

## Semantic palette

| Role | Value | Token |
|---|---:|---|
| Background | `#111111` | `--paper` |
| Surface | `#1B1B1B` | `--surface` |
| Elevated surface | `#222222` | `--surface-2` |
| Hover / selected | `#252524` / `#292928` | `--surface-hover` / `--surface-3` |
| Primary text | `#F5F4F1` | `--text-primary` |
| Secondary text | `#AAA69F` | `--text-secondary` |
| Muted text | `#79766F` | `--text-muted` |
| Brand accent | `#FF5A36` | `--orange` |
| Border | `#373735` | `--border` |
| Success | `#56B98A` | `--green` |
| Warning | `#D9A441` | `--warning` |
| Danger | `#F06A52` | `--red` |

## Typography

- **Unbounded:** DEPA brand, page titles, KPI figures and short display accents.
- **Manrope:** navigation, forms, tables, comments and all long interface copy.
- Mobile inputs are at least 16px to prevent browser zoom. Dense operational labels may be smaller only when contrast and hierarchy remain clear.

## Shape, space and motion

- 4/8px spacing rhythm; standard sections 16/24/32px.
- Borders are 1px. Corner radii are 2–5px except avatars and status dots.
- Shadows only isolate drawers/modals; surfaces use contrast and dividers.
- Interactions transition in 150–250ms and respect `prefers-reduced-motion`.
- Touch targets are at least 44×44px.

## Forms and accessibility

- Every input has a visible label and visible focus ring.
- Password fields include independent show/hide controls.
- Submit controls expose loading, disabled, error and success states.
- Errors are announced with `role="alert"`; success uses a live status region.
- Primary text targets WCAG AA contrast; status color is always paired with text or a symbol.

## Responsive behavior

- Check 375px, 768px, 1024px and 1440px.
- Authentication becomes a focused single-column composition on mobile.
- Profile becomes a full-height mobile sheet with safe gutters and 44px controls.
- Operational tables may scroll only inside their explicit table region; the page itself must not overflow horizontally.
