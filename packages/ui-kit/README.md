# @orbit/ui-kit

Orbit's shared visual foundation. The package provides the selected navy, blue, and cyan theme, CSS foundation styles, and small reusable visual primitives.

## Use

Import the complete foundation once at the application entrypoint:

```css
@import "@orbit/ui-kit/styles.css";
```

Import only the token contract when a consumer supplies its own reset and base styles:

```css
@import "@orbit/ui-kit/tokens.css";
```

The first React primitive is the responsive Orbit brand lockup:

```tsx
import { OrbitBrand } from "@orbit/ui-kit";

<OrbitBrand tagline="Healthcare performance platform" />;
```

## Governance classes

- `.is-illustrative` marks a displayed number as illustrative.
- `.chip-illustrative` renders a visible illustrative label.
- `.orbit-disclosure-banner` presents the disclosure string supplied through the approved contract.
- `.orbit-status[data-state]` styles a visible state label. Supported states include `ready`, `fresh`, `stale`, `late`, `unreconciled`, `missing`, `missing_target`, `missing_denominator`, `forbidden`, `out_of_scope`, `critical`, `unavailable`, `empty`, and `illustrative`.

These classes provide presentation only. Consumers must render meaningful text; color or styling alone must never communicate status, provenance, authorization, or data quality.

## Foundation conventions

- Use semantic HTML before adding behavior abstractions.
- Keep literal colors in `src/tokens/tokens.css`; consuming styles use custom properties.
- Use `.orbit-visually-hidden` only for content that should remain available to assistive technology.
- Apply `aria-invalid="true"` and connect field messages with `aria-describedby`; CSS does not provide form semantics.
- Do not remove illustrative labels or disclosure banners for screenshots.

## Current boundary

This package does not yet include Recharts, Radix, automated component tests, or published artifacts. The current palette is a documented implementation approximation of the approved visual reference; replace token values if exact brand assets or values are supplied. Adding another production dependency requires the repository's dependency review and approval process.
