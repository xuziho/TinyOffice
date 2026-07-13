# TinyOffice Brand Identity

<div class="brand-lockup-preview">
  <img src="../../assets/brand/tinyoffice-lockup.svg" alt="TinyOffice boss mark and wordmark">
</div>

TinyOffice is a one-person-company workbench: one human acts as the boss and works with a persistent office of AI employees. The brand should therefore feel capable without becoming corporate, and playful without becoming childish.

## Mark

The product mark combines `T` and `O` into one cyan monogram. The `O` is the boss character: compact sunglasses communicate confidence, while the crooked toothy grin keeps the personality witty, relaxed, and slightly rebellious.

The mark is a product-level identity. It is not a Company logo, employee avatar, human profile avatar, runtime status, or AI-provider mark.

## Palette

| Role | Value | Use |
| --- | --- | --- |
| Boss cyan | `#32c4df` | Product mark and restrained product-level emphasis. |
| Ink | `#172125` | Mark outline, sunglasses, wordmark, and high-contrast foreground. |
| Warm paper | `#fff8ef` | Tooth detail and compatible light surfaces. |
| Wink pink | `#f16eaf` | The single sunglasses reflection and very small personality accents. |

These colors align with the Soft Neo-Retro UI direction, but the UI's semantic tokens remain authoritative for controls, states, and product surfaces. The logo palette must not be used to recolor warnings, success states, destructive actions, or Company branding.

## Asset set

| Asset | Purpose |
| --- | --- |
| `docs/assets/brand/tinyoffice-lockup.svg` | Transparent product mark plus TinyOffice wordmark for controlled light surfaces. |
| `docs/assets/brand/tinyoffice-lockup-on-paper.svg` | Warm-paper lockup for repositories and other surfaces whose light/dark theme is not controlled by TinyOffice. |
| `docs/assets/brand/tinyoffice-mark.svg` | Product-level source mark without the wordmark. |
| `apps/tinyoffice-web-shadcn/public/favicon.svg` | Browser favicon. |
| `apps/tinyoffice-web-shadcn/public/apple-touch-icon.png` | 180px touch icon. |
| `apps/tinyoffice-web-shadcn/public/brand/icon-16.png` | Small-size inspection and raster fallback. |
| `apps/tinyoffice-web-shadcn/public/brand/icon-32.png` | Small-size inspection and raster fallback. |
| `apps/tinyoffice-web-shadcn/public/brand/icon-192.png` | Medium application icon export. |
| `apps/tinyoffice-web-shadcn/public/brand/icon-512.png` | Large application icon export. |

The SVG assets are the authoritative production artwork. Raster exports are derived from the same flattened four-color geometry.

## Usage boundaries

- Keep clear space around the mark equal to at least the width of one sunglasses lens hinge.
- Do not stretch, rotate, recolor, add a container shape, redraw the mouth, or move the sunglasses across both letters.
- Do not place the full wordmark inside compact navigation controls. Use the mark alone when the available width is constrained.
- At 16px and 32px, prioritize recognition of the `TO` silhouette and sunglasses. The tooth remains a bonus detail and must not be enlarged independently.
- On warm or light surfaces, use the transparent asset directly. On dark surfaces, first verify the ink outline retains sufficient contrast; do not invent a white-outline variant without a new reviewed asset.

## Product identity versus Company identity

TinyOffice supports Company-specific uploaded logos. Those assets identify the current Company and remain authoritative inside the Company switcher and Company configuration surfaces. The TinyOffice product mark identifies the application itself, including the browser tab and repository/manual entry points.

The product mark must not silently replace a missing Company logo with TinyOffice branding. A missing Company logo continues to use the Company's own textual or generated fallback so users do not confuse product ownership with Company identity.

## Repository language editions

The public repository maintains two README editions:

- `README.md` is the English edition and the default GitHub entry point.
- `README.zh-CN.md` is the Simplified Chinese edition.

Both editions must describe the same product status, requirements, setup commands, data boundaries, contribution path, security process, and license. A change to one README's factual content should update the other in the same pull request. Tone may be natural in each language; the two files do not need to be mechanically literal translations.
