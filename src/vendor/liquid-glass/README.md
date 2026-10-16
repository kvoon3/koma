# liquid-glass (vendored)

- Upstream: https://github.com/shuding/liquid-glass
- Commit: `a2d2e847f793430e3409a52927af815a23f4d372` (file `liquid-glass.js`)
- License: MIT, Copyright (c) 2025 Shu Ding. See `LICENSE` (unchanged copy).

## Adaptations

- Ported to TypeScript ES module exports. Upstream is a console-paste IIFE.
- Removed the DOM container, drag handling, mouse proxy, resize clamping, and `window.liquidGlass`. koma renders the `<filter>` in React (`ToolsDock.tsx`).
- `updateShader` is split in two: `displacementMap()` is pure (unit-tested), and `displacementMapURL()` draws it to a detached canvas.
- Guarded the divide-by-zero when the map has no displacement.
- The default fragment, SDF math, the backdrop-filter recipe, and the shadow are unchanged. The filter id is a parameter.
