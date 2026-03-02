# TransLit for Zotero

TransLit is a Zotero plugin focused on two workflows for academic PDFs:

1. Full-text translation with DeepSeek (`deepseek-reasoner`)
2. Figure/table extraction with MinerU and visual browsing inside Zotero

This repository is maintained at:

- https://github.com/Run-Labs-HQ/TransLit

## Latest Release

- Current version: `3.2.1`
- Release notes: `CHANGELOG.md`

## What It Does

- Translate selected paper full text from Zotero item menu and save output as Markdown attachment
- Strip `References/Bibliography` section before translation request to reduce token usage
- Support custom prompt template in Preferences
- Stream translation response with in-progress status feedback
- Extract figures/tables from PDFs through MinerU API
- Save MinerU outputs as Zotero attachments (`zip`, `markdown`, `summary`, `manifest`, `merged-manifest`)
- Merge Chinese captions from DeepSeek markdown into MinerU structured manifest
- Open an in-app visual viewer for figures/tables with:
  - Quick buttons (`f1`, `f2`, `t1`, ...)
  - Mouse wheel zoom
  - Drag-to-pan when zoomed
  - Chinese captions display
- Manually adjust MinerU visual crops against original PDF pages (`调整图表截图（MinerU）`)
  - Uses external PDF page renderer (Python + PyMuPDF) as primary path
  - Supports page override (`页-1` / `页+1`) when source page index is unreliable
- Export a translated PDF that includes:
  - Full translated body text
  - Figure/table image placed directly above each caption entry
  - Clickable in-body links (`图1`, `表1`, `Figure 1`, `Table 1`, etc.) jumping to corresponding caption blocks

## Requirements

- Zotero 7/8
- Node.js LTS (for development)
- A valid DeepSeek API key
- A valid MinerU API token
- Python 3 + PyMuPDF (`pip install pymupdf`) for robust visual crop adjustment

## Install for Development

```bash
npm install
npm start
```

`npm start` launches Zotero with hot-reload development workflow via scaffold.

## Build / Test

```bash
npm run lint:check
npm run build
npm run test -- --no-watch
```

## User Workflow

### 1) Full-Text Translation (DeepSeek)

1. Select a Zotero item (with PDF attachment)
2. Right click and choose: `翻译全文（DeepSeek）`
3. Plugin extracts PDF text via Zotero fulltext cache
4. Plugin sends prompt + content to DeepSeek (`deepseek-reasoner`)
5. Result is saved as a markdown attachment under the item

### 2) Figure/Table Extraction (MinerU)

1. Select a Zotero item (with PDF attachment)
2. Right click and choose: `解析图表资源（MinerU）`
3. Plugin uploads PDF to MinerU and polls processing status
4. Plugin saves these attachments:
   - `MinerU Output - ...` (`.zip`)
   - `MinerU Markdown - ...` (`...-output.md`)
   - `MinerU Summary - ...` (`...-summary.json`)
   - `MinerU Manifest - ...` (`...-manifest.json`)
   - `MinerU Merged Manifest - ...` (`...-merged-manifest.json`)

### 3) Visual Viewer

1. Select a Zotero item with merged manifest + zip
2. Right click and choose: `查看图表结果（MinerU）`
3. In viewer:
   - Click `f1/f2/...` or `t1/...` to switch entries
   - Use mouse wheel to zoom
   - Drag image to inspect zoomed regions

### 4) Export Translated PDF

1. Select a Zotero item with:
   - a DeepSeek markdown translation attachment
   - a MinerU merged manifest attachment
   - the matching MinerU ZIP attachment
2. Right click and choose: `导出译文 PDF（含图表）`
3. Plugin generates a PDF attachment containing:
   - translated body text
   - figures/tables shown one line above corresponding captions
   - internal links from figure/table mentions in body to caption positions
   - a clickable table of contents (body headings + visual caption section)
4. PDF export uses headless Edge/Chrome by default.
   - If auto-detection fails, set `Headless browser executable path` in plugin preferences.

### 4.5) Adjust MinerU Visual Crops (Manual)

1. Select a Zotero item with merged manifest + zip.
2. Right click and choose: `调整图表截图（MinerU）`.
3. In adjustment dialog:
   - Left panel: original PDF page for red-box recrop
   - Right panel: current extracted image + caption reference
   - Pages are pre-rendered in one external renderer run before interaction
   - `页-1` / `页+1` to override source page index when needed
4. Click `完成并应用` to overwrite images in existing MinerU ZIP attachment.

### 5) One-click Workflow

1. Select one or more Zotero items with PDF attachments.
2. Right click and choose: `一键完成（翻译+解析+导出 PDF）`
3. Plugin runs these steps in order:
   - Full text translation (DeepSeek)
   - MinerU figure/table extraction and merge
   - Translated PDF export with visuals

## Preferences

Open Zotero plugin preferences for TransLit and configure:

- DeepSeek API Key
- DeepSeek Base URL
- DeepSeek Prompt Template
- MinerU API Token
- MinerU Base URL
- MinerU Model Version
- PDF page renderer executable path (recommended for visual crop adjustment)
- Headless browser executable path (optional, for PDF export)
- PDF font family
- PDF body font size (pt)
- PDF body width (%)
- PDF first-line indent (em)
- Context menu visibility toggles (default: one-click workflow only)

Optional environment variable:

- `TRANSLIT_PDF_RENDER_COMMAND`
  - Used only when preference `PDF page renderer executable path` is empty
  - Default fallback chain: `python` -> `python3` -> `py -3` -> `py`
  - You can point this to a packaged renderer executable if desired
  - Renderer CLI contract: `--pdf <path> --page <index0> --scale <float> --out <png>`

Prompt placeholders:

- `{{title}}`
- `{{itemKey}}`
- `{{content}}`

If `{{content}}` is omitted, full text is appended automatically.

## Security Notes

- API credentials are stored using login manager secure storage when available
- Legacy plain-text prefs are migrated automatically and cleared
- Do not commit secrets or local environment files

## Project Structure

- `src/modules/fullTextTranslate.ts`: DeepSeek translation flow
- `src/modules/mineruExtract.ts`: MinerU extraction + merged manifest + viewer
- `src/modules/preferenceScript.ts`: preferences UI bindings
- `src/utils/secureStore.ts`: secure credential read/write and migration
- `addon/content/preferences.xhtml`: preferences pane UI

## Current Scope

- Translation output target is Markdown attachment (no HTML export by default)
- Viewer currently focuses on image-based figure/table browsing
- Complex LaTeX rendering in captions uses lightweight inline conversion

## Acknowledgements

TransLit is built on top of the open-source Zotero plugin template:

- https://github.com/windingwind/zotero-plugin-template
- DeepSeek API for translation capabilities: https://platform.deepseek.com/
- MinerU for figure/table extraction pipeline: https://mineru.net/

## License

AGPL-3.0-or-later
