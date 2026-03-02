# Changelog

## v3.2.1 - 2026-02-23

- Fixed figure numbering shift caused by front-matter non-body images (e.g., cover overview, author portraits).
- Updated MinerU manifest generation to ignore unnumbered image blocks on early front-matter pages by default.
- Added MinerU markdown output attachment (`MinerU Markdown - ...`) for traceability and debugging.
- Added markdown-assisted image number hints when caption numbers are missing.
- Added markdown-caption gating for figure inclusion: image blocks without nearby `Fig/Figure` captions are excluded.
- Improved PDF export consistency for papers with graphical abstract/author profile pages.

## v3.2.0 - 2026-02-22

- Added one-click end-to-end workflow from item menu: translate -> MinerU extract -> PDF export.
- Added translated PDF export with figure/table image + caption layout and in-body jump links.
- Switched PDF generation to headless Chromium export path for stability across environments.
- Added PDF typography/layout controls in preferences (font family, font size, body width, first-line indent).
- Added optional headless browser executable path in preferences for deterministic export.
- Added context menu visibility toggles in preferences (default: only one-click workflow shown).
- Added formula rendering in exported PDF (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`).
- Added clickable table of contents section in exported PDF and attempted PDF outline generation.
