# TransLit for Zotero

TransLit is a Zotero plugin focused on two workflows for academic PDFs:

1. Full-text translation with DeepSeek (`deepseek-reasoner`)
2. Figure/table extraction with MinerU and visual browsing inside Zotero

This repository is maintained at:

- https://github.com/Run-Labs-HQ/TransLit

## What It Does

- Translate selected paper full text from Zotero item menu and save output as Markdown attachment
- Strip `References/Bibliography` section before translation request to reduce token usage
- Support custom prompt template in Preferences
- Stream translation response with in-progress status feedback
- Extract figures/tables from PDFs through MinerU API
- Save MinerU outputs as Zotero attachments (`zip`, `summary`, `manifest`, `merged-manifest`)
- Merge Chinese captions from DeepSeek markdown into MinerU structured manifest
- Open an in-app visual viewer for figures/tables with:
  - Quick buttons (`f1`, `f2`, `t1`, ...)
  - Mouse wheel zoom
  - Drag-to-pan when zoomed
  - Chinese captions display

## Requirements

- Zotero 7/8
- Node.js LTS (for development)
- A valid DeepSeek API key
- A valid MinerU API token

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

## Preferences

Open Zotero plugin preferences for TransLit and configure:

- DeepSeek API Key
- DeepSeek Base URL
- DeepSeek Prompt Template
- MinerU API Token
- MinerU Base URL
- MinerU Model Version

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

## License

AGPL-3.0-or-later
