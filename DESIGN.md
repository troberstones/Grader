# Design System Document: The Editorial Gallery

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
The objective of this design system is to transform a standard web interface into a high-end, editorial experience that mirrors the atmosphere of a private contemporary art gallery. We are moving away from the "app-like" feel of heavy borders and rigid grids. Instead, we embrace **The Digital Curator**—a philosophy where the interface recedes to let the artwork breathe, using intentional asymmetry, generous white space (negative space), and tonal depth to guide the user’s eye. 

The experience must feel premium, quiet, and authoritative. We achieve this by prioritizing content over container, using our vibrant orange accent sparingly but with high impact, like a neon sign in a dimly lit hall.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, neutral dark to ensure the maximum "pop" of curated artwork. 

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. In this system, boundaries are defined strictly through background color shifts. Use `surface-container-low` (#131313) against the primary `background` (#0e0e0e) to create a change in zone. If a visual break is needed, use vertical white space from the Spacing Scale (e.g., `12` or `16`).

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Each "inner" container should utilize a higher tier to define its importance:
*   **Base Layer:** `surface` (#0e0e0e)
*   **Sectioning:** `surface-container-low` (#131313)
*   **Interactive Cards:** `surface-container` (#1a1919)
*   **Elevated Overlays:** `surface-container-highest` (#262626)

### The "Glass & Gradient" Rule
To avoid a flat, "template" look, floating navigation or modal headers must use **Glassmorphism**. Apply `surface-container-highest` at 70% opacity with a `20px` backdrop-blur. 
*   **Signature Texture:** Use a subtle linear gradient for primary CTAs: `primary` (#ff9069) to `primary-container` (#ff7948). This adds a "glow" effect that flat hex codes cannot replicate.

---

## 3. Typography
We use **Manrope**, a contemporary sans-serif that balances geometric precision with human warmth.

*   **Display (lg/md):** Used for art titles or featured artist names. These should be treated as hero elements. Use `display-lg` (3.5rem) with tighter letter-spacing (-0.02em) to create a bold, editorial impact.
*   **Headlines:** Used for section headers. Ensure `headline-sm` (1.5rem) has ample top-padding to maintain the "spacious" requirement.
*   **Body (lg/md):** All reviews and descriptions use `body-lg`. The line height must be generous (1.6+) to ensure readability against the dark background.
*   **Labels:** Use `label-md` in `on-surface-variant` (#adaaaa) for metadata (e.g., "Date Published," "Medium").

---

## 4. Elevation & Depth
We eschew traditional drop shadows in favor of **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-high` card placed on a `surface-container-low` background creates a sophisticated, natural lift.
*   **Ambient Shadows:** If an element must "float" (like a global action button), use an extra-diffused shadow: `box-shadow: 0 20px 40px rgba(0,0,0,0.4)`. The shadow should feel like a soft bloom, not a harsh edge.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke (e.g., input fields), use the `outline-variant` (#494847) at **15% opacity**. High-contrast borders are strictly forbidden as they break the premium "gallery" immersion.

---

## 5. Components

### Buttons
*   **Primary:** Solid `primary` gradient. Roundedness: `md` (0.375rem). No border. Text: `on-primary-fixed` (#000000).
*   **Secondary:** Ghost style. No background. `Ghost Border` (15% opacity `outline-variant`). Text: `on-surface`.
*   **Tertiary:** Text-only with `primary` color for the label.

### Input Fields
*   **Styling:** Use `surface-container-lowest` (#000000) for the input well to create a "sunken" feel. 
*   **State:** On focus, transition the `Ghost Border` to 50% opacity `primary`.

### Cards & Art Tiles
*   **Rule:** Forbid divider lines.
*   **Layout:** Use `surface-container` (#1a1919). Images should have a `0.25rem` (DEFAULT) corner radius. Use the spacing scale `4` (1.4rem) for internal padding.
*   **Asymmetry:** In art grids, vary the aspect ratio of tiles (e.g., some 4:5, some 1:1) to mimic a physical gallery wall.

### Art Review "Critique" Chips
*   **Design:** Small, pill-shaped (`full` roundedness). Use `surface-variant` with `on-surface-variant` text. When active/highlighted, switch to `primary-container` with `on-primary-container` text.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical margins. If the left margin is `20`, try making the right margin `24` for a customized, editorial feel.
*   **Do** prioritize imagery. The UI exists only to support the art.
*   **Do** use `primary` (#ff9069) for micro-interactions (hover states, progress bars) to create a sense of life.

### Don’t:
*   **Don’t** use pure white (#ffffff) for long-form body text; use `on-surface-variant` (#adaaaa) to reduce eye strain in dark mode.
*   **Don’t** use standard 1px borders to separate list items. Use a `1.5` (0.5rem) vertical gap instead.
*   **Don’t** crowd the interface. If you feel you need more content, you probably need more spacing (`spacing-12` or `16`) instead.

---
*Document produced for the junior design team. Adherence to tonal layering and the "No-Line" rule is mandatory for all high-fidelity prototypes.*