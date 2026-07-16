# Interface themes

TinyOffice provides a curated Owner-level color theme preference. Themes change the interface character without changing product meaning or creating Company-specific branding forks.

## Product model

- The available themes are Sakura, Ocean, Forest, Violet, and Neutral.
- Sakura is the default and preserves the original TinyOffice palette.
- The preference belongs to the Owner profile and applies across Companies.
- TinyOffice does not expose an arbitrary color picker. Curated palettes keep contrast and state semantics reviewable.
- Success, warning, and danger colors retain their meanings in every theme. Themes change action, selection, information, tab, brand, and neutral surface roles.

## Implementation boundary

Product components consume semantic CSS variables such as `--tiny-action-surface`, `--tiny-selected-surface`, and `--tiny-info-surface`. They must not depend directly on color names such as pink or cyan.

The frontend applies the profile's `uiTheme` as `data-theme` on the document root. The PostgreSQL `user_profiles.ui_theme` column is authoritative; browser-local storage is not a second preference source.

New themes must define readable action, selection, tab, and surface roles and pass the theme coverage tests before they are exposed in Settings.
