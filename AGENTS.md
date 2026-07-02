# UI Design System Rules

These rules guide UI work for this Cloudflare Pages + D1 ticket system.

## Project Shape

- The app uses static HTML, plain JavaScript, and one shared stylesheet at `assets/app.css`.
- Keep behavior in the existing script files under `assets/js/`; avoid adding a frontend framework unless explicitly requested.
- Preserve the current CSP-friendly pattern: no inline styles, no inline event handlers, and no external CDN dependencies.

## Visual Direction

- Build a formal product console for daily operational work, not a marketing page.
- Prioritize dense, scannable, calm interfaces: clear hierarchy, readable tables, restrained cards, and predictable navigation.
- Use the existing CSS variables in `assets/app.css` as design tokens. Add tokens only when they represent reusable product decisions.
- Keep primary surfaces white, backgrounds low-saturation neutral, and status colors limited to primary blue, success green, warning amber, and danger red.
- Use 8px or smaller radius for controls and cards unless an existing component requires otherwise.

## Component Rules

- Reuse existing classes before adding new ones: `card`, `fold-card`, `settings-item`, `button-link`, `pill`, `table-wrap`, and modal classes.
- Add page-level structure with semantic HTML first, then style through reusable classes.
- New repeated UI blocks should have stable class names and be styled in `assets/app.css`.
- Do not place cards inside decorative cards. Repeated data items may be cards; page sections should stay as plain panels or full-width bands.

## Accessibility And Responsive Rules

- Every navigation block needs an `aria-label`.
- Buttons and links must remain keyboard focusable and use visible focus states.
- Text must not depend on viewport-width font scaling. Use fixed/rem sizing and responsive layout changes.
- Mobile layouts must avoid page-level horizontal overflow. Tables may scroll inside `.table-wrap`.

## Verification

- Run `npm.cmd test` after HTML or CSS changes.
- For UI changes, preview at desktop and mobile widths and check for overflow, clipped text, and unreadable controls.
