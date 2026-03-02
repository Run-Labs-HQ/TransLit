import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getSecret } from "../utils/secureStore";
import {
  getMenuVisibilityPref,
  MENU_VISIBILITY_DEFAULTS,
  MENU_VISIBILITY_PREF_KEYS,
} from "./menuVisibility";

const EXTRACT_MENU_ID = `zotero-itemmenu-${config.addonRef}-mineru-extract`;
const VIEW_MENU_ID = `zotero-itemmenu-${config.addonRef}-mineru-view`;
const ADJUST_MENU_ID = `zotero-itemmenu-${config.addonRef}-mineru-adjust-images`;
const MINERU_TIMEOUT_MS = 10 * 60 * 1000;
const MINERU_POLL_INTERVAL_MS = 3000;
const MINERU_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const MINERU_FRONT_MATTER_MAX_PAGE_IDX = 0;
const PDF_RENDER_HELPER_VERSION = "2";

const MINERU_DEFAULT_BASE_URL = "https://mineru.net/api/v4";
const MINERU_DEFAULT_MODEL_VERSION = "vlm";

const MINERU_PREF_KEYS = {
  token: "mineruAPIToken",
  baseURL: "mineruBaseURL",
  modelVersion: "mineruModelVersion",
  pdfRenderCommand: "mineruPdfRenderCommand",
} as const;

const MINERU_LEGACY_PREF_KEYS = [
  "visualExtractUseLocal",
  "localExtractorPythonPath",
  "localExtractorScriptPath",
  "localExtractorBackend",
  "localExtractorVlmBaseURL",
  "localExtractorVlmModel",
  "localExtractorVlmConcurrency",
  "localExtractorVlmMaxRetries",
  "localExtractorVlmRenderLongEdge",
  "localExtractorVlmMinScore",
  "localExtractorVlmMinAreaRatio",
  "localExtractorVlmMaxObjectsPerPage",
  "localExtractorVlmEnableThinking",
  "localExtractorVlmUseThinking",
  "localExtractorVlmApiKey",
] as const;

interface MinerUApiResponse<T> {
  code?: number;
  msg?: string;
  trace_id?: string;
  data?: T;
}

interface MinerUFileURLBatchData {
  batch_id: string;
  file_urls?: string[];
  files?: string[];
}

interface MinerUExtractProgress {
  extracted_pages?: number;
  total_pages?: number;
  start_time?: string;
}

interface MinerUExtractResultItem {
  file_name?: string;
  data_id?: string;
  state?: string;
  err_msg?: string;
  full_zip_url?: string;
  extract_progress?: MinerUExtractProgress;
}

interface MinerUBatchResultData {
  batch_id: string;
  extract_result?: MinerUExtractResultItem[];
}

interface MinerURawContentItem {
  type?: string;
  img_path?: string;
  image_caption?: string[];
  image_footnote?: string[];
  table_caption?: string[];
  table_footnote?: string[];
  table_body?: string;
  bbox?: number[];
  page_idx?: number;
}

interface MinerUManifestFigure {
  number: number;
  number_source: "caption" | "markdown" | "fallback-sequence";
  page_idx: number | null;
  image_path: string;
  caption_en: string;
  caption_zh: string;
  footnote_en: string;
  bbox: number[];
}

interface MinerUManifestTable {
  number: number;
  number_source: "caption" | "markdown" | "fallback-sequence";
  page_idx: number | null;
  image_path: string;
  caption_en: string;
  caption_zh: string;
  footnote_en: string;
  table_html: string;
  bbox: number[];
}

interface MinerUManifest {
  generated_at: string;
  source_item: {
    id: number;
    key: string;
    title: string;
  };
  mineru: {
    batch_id: string;
    state: string;
    full_zip_url: string;
    data_id: string;
    file_name: string;
  };
  content_list_entry: string;
  source_markdown_entry?: string;
  stats: {
    total_items: number;
    type_counts: Record<string, number>;
    figure_count: number;
    table_count: number;
    ignored_without_figure_caption_count?: number;
    ignored_front_matter_figure_count?: number;
  };
  translation?: {
    source_markdown_attachment_id: number;
    source_markdown_attachment_title: string;
    source_markdown_file_name: string;
    matched_figure_count: number;
    matched_table_count: number;
    matched_figure_numbers: number[];
    matched_table_numbers: number[];
  };
  figures: MinerUManifestFigure[];
  tables: MinerUManifestTable[];
}

interface ZhCaptionIndex {
  sourceAttachmentID: number;
  sourceAttachmentTitle: string;
  sourceAttachmentFileName: string;
  figureCaptions: Map<number, string>;
  tableCaptions: Map<number, string>;
}

interface MinerUViewerEntry {
  kind: "figure" | "table";
  number: number;
  pageIdx: number | null;
  imagePath: string;
  imageURI: string;
  captionZh: string;
  captionEn: string;
  footnoteEn: string;
}

interface ViewerImageExtractionResult {
  imageURIMap: Map<string, string>;
  tempDirPath: string;
}

interface MinerUMarkdownData {
  entryName: string;
  content: string;
}

interface MinerUMarkdownHints {
  figureNumbersByPath: Map<string, number>;
  tableNumbersByPath: Map<string, number>;
  figureCaptionPaths: Set<string>;
  tableCaptionPaths: Set<string>;
}

interface MinerUStatusWindow {
  update(text: string): void;
  close(): void;
}

interface VisualReviewEntry {
  key: string;
  kind: "figure" | "table";
  index: number;
  number: number;
  pageIdx: number | null;
  imagePath: string;
  captionZh: string;
  captionEn: string;
  bbox: number[];
}

interface VisualCountReviewResult {
  selectedFigureIndexes: Set<number>;
  selectedTableIndexes: Set<number>;
  confirmed: boolean;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreRenderedPagesResult {
  pageImageURIByIdx: Map<number, string>;
  tempDirPath: string;
}

interface PdfRenderSession {
  pdfPath: string;
  pageCountHint: number | null;
  pdfDocument: any;
  reader: any;
  close(): void;
}

export class MinerUExtractFactory {
  private static menuRegistered = false;
  private static extracting = false;
  private static adjusting = false;
  private static pdfRenderHelperScriptPath = "";

  static cleanupLegacyPrefs(): void {
    for (const prefKey of MINERU_LEGACY_PREF_KEYS) {
      try {
        Zotero.Prefs.clear(`${config.prefsPrefix}.${prefKey}`, true);
      } catch (error) {
        ztoolkit.log("clear legacy mineru pref failed", prefKey, error);
      }
    }
  }

  static registerItemMenu(): void {
    if (this.menuRegistered) {
      return;
    }

    this.menuRegistered = true;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: EXTRACT_MENU_ID,
      label: getString("menuitem-mineru-extract"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.mineruExtract,
          MENU_VISIBILITY_DEFAULTS.mineruExtract,
        ),
      commandListener: async () => {
        await this.extractSelectedItems();
      },
    });

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: VIEW_MENU_ID,
      label: getString("menuitem-mineru-view"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.mineruView,
          MENU_VISIBILITY_DEFAULTS.mineruView,
        ),
      commandListener: async () => {
        await this.openViewerForSelectedItem();
      },
    });

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: ADJUST_MENU_ID,
      label: getString("menuitem-mineru-adjust-images" as any),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.mineruView,
          MENU_VISIBILITY_DEFAULTS.mineruView,
        ),
      commandListener: async () => {
        await this.adjustSelectedItems();
      },
    });
  }

  static async runSelectedItems(): Promise<void> {
    await this.extractSelectedItems();
  }

  private static async adjustSelectedItems(): Promise<void> {
    if (this.adjusting) {
      this.showToast(getString("mineru-adjust-busy" as any), "default");
      return;
    }

    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(getString("mineru-error-no-selection"), "error");
      return;
    }

    this.adjusting = true;
    this.showToast(getString("mineru-adjust-start" as any), "default");

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    try {
      for (const selectedItem of selectedItems) {
        const targetItem = this.resolveTargetItem(selectedItem);
        const title = targetItem.getDisplayTitle() || targetItem.key;

        try {
          const loaded = await this.loadLatestMergedManifestAndZip(targetItem);
          const cropOverrides = await this.reviewVisualCropAdjustments(
            targetItem,
            loaded.mergedManifest,
            loaded.zipFile,
          );
          if (!cropOverrides.size) {
            skippedCount += 1;
            continue;
          }

          await this.applyCropOverridesToZip(loaded.zipFile, cropOverrides);
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          ztoolkit.log("mineru manual adjust failed", targetItem.id, error);
          this.showToast(
            getString(
              "mineru-adjust-item-failed" as any,
              {
                args: {
                  title,
                  reason: this.getErrorMessage(error),
                },
              } as any,
            ),
            "error",
          );
        }
      }
    } finally {
      this.adjusting = false;
    }

    if (successCount > 0 && failedCount === 0) {
      this.showToast(
        getString(
          "mineru-adjust-success" as any,
          {
            args: { count: successCount },
          } as any,
        ),
        "success",
      );
      return;
    }

    if (successCount > 0) {
      this.showToast(
        getString(
          "mineru-adjust-partial-success" as any,
          {
            args: {
              success: successCount,
              failed: failedCount,
            },
          } as any,
        ),
        "default",
      );
      return;
    }

    if (failedCount === 0 && skippedCount > 0) {
      this.showToast(
        getString(
          "mineru-adjust-skipped" as any,
          {
            args: { count: skippedCount },
          } as any,
        ),
        "default",
      );
      return;
    }

    this.showToast(getString("mineru-adjust-all-failed" as any), "error");
  }

  private static getPrefString(prefKey: string, fallback = ""): string {
    const pref = Zotero.Prefs.get(`${config.prefsPrefix}.${prefKey}`, true);
    if (typeof pref === "string") {
      return pref;
    }
    if (pref === undefined || pref === null || pref === false) {
      return fallback;
    }
    return String(pref);
  }

  private static getBaseURL(): string {
    const baseURL = this.getPrefString(
      MINERU_PREF_KEYS.baseURL,
      MINERU_DEFAULT_BASE_URL,
    ).trim();
    return baseURL.replace(/\/+$/, "") || MINERU_DEFAULT_BASE_URL;
  }

  private static getModelVersion(): string {
    const modelVersion = this.getPrefString(
      MINERU_PREF_KEYS.modelVersion,
      MINERU_DEFAULT_MODEL_VERSION,
    ).trim();
    return modelVersion || MINERU_DEFAULT_MODEL_VERSION;
  }

  private static async extractSelectedItems(): Promise<void> {
    if (this.extracting) {
      this.showToast(getString("mineru-busy"), "default");
      return;
    }

    const token = (
      await getSecret("mineru-api-token", MINERU_PREF_KEYS.token)
    ).trim();
    if (!token) {
      this.showToast(getString("mineru-error-no-token"), "error");
      return;
    }

    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(getString("mineru-error-no-selection"), "error");
      return;
    }

    this.extracting = true;
    this.showToast(getString("mineru-start"), "default");

    let successCount = 0;
    let failedCount = 0;

    try {
      for (const selectedItem of selectedItems) {
        const targetItem = this.resolveTargetItem(selectedItem);
        const targetTitle = targetItem.getDisplayTitle() || targetItem.key;
        const statusWindow = this.openStatusWindow(targetTitle);

        try {
          const pdfAttachment = await this.getPdfAttachment(targetItem);
          if (!pdfAttachment) {
            throw new Error(getString("mineru-error-no-pdf"));
          }

          const filePath = await pdfAttachment.getFilePathAsync();
          if (!filePath) {
            throw new Error(getString("mineru-error-no-pdf"));
          }

          const fileName =
            pdfAttachment.attachmentFilename ||
            this.getFileNameFromPath(filePath);

          statusWindow.update(getString("mineru-status-apply-upload-url"));
          const uploadData = await this.createUploadURL(
            token,
            fileName,
            targetItem.key,
          );

          const uploadURL =
            uploadData.file_urls?.[0] || uploadData.files?.[0] || "";
          if (!uploadURL) {
            throw new Error(getString("mineru-error-empty-upload-url"));
          }

          statusWindow.update(getString("mineru-status-uploading"));
          await this.uploadFile(uploadURL, filePath);

          let lastState = "";
          const result = await this.pollBatchResult(
            token,
            uploadData.batch_id,
            targetItem.key,
            fileName,
            (state) => {
              if (state !== lastState) {
                lastState = state;
                statusWindow.update(
                  getString("mineru-status-processing", {
                    args: { state },
                  }),
                );
              }
            },
          );

          if (!result.full_zip_url) {
            throw new Error(getString("mineru-error-empty-result-url"));
          }

          const outputBaseName = this.buildOutputBaseName(targetItem);
          statusWindow.update(getString("mineru-status-downloading"));
          const zipFile = await this.downloadZipToTempFile(
            result.full_zip_url,
            `${outputBaseName}.zip`,
          );

          statusWindow.update(getString("mineru-status-saving"));
          await this.saveResultAttachments(
            targetItem,
            zipFile,
            `${outputBaseName}-output.md`,
            `${outputBaseName}-summary.json`,
            `${outputBaseName}-manifest.json`,
            `${outputBaseName}-merged-manifest.json`,
            uploadData.batch_id,
            result,
          );

          successCount += 1;
        } catch (error) {
          failedCount += 1;
          ztoolkit.log("mineru extract failed", targetItem.id, error);
          this.showToast(
            getString("mineru-item-failed", {
              args: {
                title: targetTitle,
                reason: this.getErrorMessage(error),
              },
            }),
            "error",
          );
        } finally {
          statusWindow.close();
        }
      }
    } finally {
      this.extracting = false;
    }

    if (successCount > 0 && failedCount === 0) {
      this.showToast(
        getString("mineru-success", {
          args: { count: successCount },
        }),
        "success",
      );
      return;
    }

    if (successCount > 0) {
      this.showToast(
        getString("mineru-partial-success", {
          args: {
            success: successCount,
            failed: failedCount,
          },
        }),
        "default",
      );
      return;
    }

    this.showToast(getString("mineru-error-all-failed"), "error");
  }

  private static getItemAttachments(item: Zotero.Item): Zotero.Item[] {
    return item
      .getAttachments()
      .map((attachmentID) => Zotero.Items.get(attachmentID))
      .filter((attachment): attachment is Zotero.Item => Boolean(attachment));
  }

  private static isMineruMergedManifestAttachment(
    attachment: Zotero.Item,
  ): boolean {
    if (!attachment.isAttachment()) {
      return false;
    }

    const fileName = (attachment.attachmentFilename || "").toLowerCase();
    const title = (attachment.getDisplayTitle() || "").toLowerCase();
    return (
      fileName.endsWith("-merged-manifest.json") ||
      title.includes("mineru merged manifest")
    );
  }

  private static isMineruZipAttachment(attachment: Zotero.Item): boolean {
    if (!attachment.isAttachment()) {
      return false;
    }

    const fileName = (attachment.attachmentFilename || "").toLowerCase();
    const contentType = (attachment.attachmentContentType || "").toLowerCase();
    const title = (attachment.getDisplayTitle() || "").toLowerCase();

    const looksLikeZip =
      fileName.endsWith(".zip") || contentType.includes("zip");
    const looksLikeMinerU =
      fileName.includes("-mineru-") || title.includes("mineru output");

    return looksLikeZip && looksLikeMinerU;
  }

  private static expectedZipNameFromMergedManifest(
    mergedManifestFileName: string,
  ): string {
    if (
      !mergedManifestFileName.toLowerCase().endsWith("-merged-manifest.json")
    ) {
      return "";
    }
    return (
      mergedManifestFileName.slice(0, -"-merged-manifest.json".length) + ".zip"
    );
  }

  private static async readMergedManifestAttachment(
    attachment: Zotero.Item,
  ): Promise<MinerUManifest> {
    const filePath = await attachment.getFilePathAsync();
    if (!filePath) {
      throw new Error(getString("mineru-viewer-error-no-merged-manifest"));
    }

    const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
    if (typeof content !== "string") {
      throw new Error(getString("mineru-viewer-error-no-merged-manifest"));
    }

    const parsed = JSON.parse(content) as MinerUManifest;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.figures) ||
      !Array.isArray(parsed.tables)
    ) {
      throw new Error(getString("mineru-viewer-error-invalid-manifest"));
    }

    return parsed;
  }

  private static extractViewerImageURIMap(
    zipFile: nsIFile,
    manifest: MinerUManifest,
  ): ViewerImageExtractionResult {
    const zipReader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader) as nsIZipReader;

    const imagePathSet = new Set<string>();
    for (const figure of manifest.figures) {
      if (figure.image_path) {
        imagePathSet.add(figure.image_path);
      }
    }
    for (const table of manifest.tables) {
      if (table.image_path) {
        imagePathSet.add(table.image_path);
      }
    }

    const tempDir = Zotero.getTempDirectory();
    tempDir.append(`${config.addonRef}-mineru-view-${Date.now()}`);
    Zotero.File.createDirectoryIfMissing(tempDir.path);

    const imageURIMap = new Map<string, string>();

    try {
      zipReader.open(zipFile);
      let index = 0;
      for (const imagePath of imagePathSet) {
        if (!zipReader.hasEntry(imagePath)) {
          continue;
        }

        index += 1;
        const baseName = imagePath.split("/").pop() || `image-${index}.jpg`;
        const outputFile = tempDir.clone();
        outputFile.append(baseName);

        zipReader.extract(imagePath, outputFile);
        if (outputFile.exists() && outputFile.fileSize > 0) {
          imageURIMap.set(
            imagePath,
            Zotero.File.pathToFileURI(outputFile.path),
          );
        }
      }
    } finally {
      zipReader.close();
    }

    return {
      imageURIMap,
      tempDirPath: tempDir.path,
    };
  }

  private static removeDirectoryIfExists(dirPath: string): void {
    if (!dirPath) {
      return;
    }

    try {
      const dir = Zotero.File.pathToFile(dirPath);
      if (dir.exists()) {
        dir.remove(true);
      }
    } catch (error) {
      ztoolkit.log("remove temp directory failed", dirPath, error);
    }
  }

  private static buildViewerEntries(
    manifest: MinerUManifest,
    imageURIMap: Map<string, string>,
  ): MinerUViewerEntry[] {
    const figureEntries: MinerUViewerEntry[] = manifest.figures
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((figure) => ({
        kind: "figure",
        number: figure.number,
        pageIdx: figure.page_idx,
        imagePath: figure.image_path,
        imageURI: imageURIMap.get(figure.image_path) || "",
        captionZh: figure.caption_zh,
        captionEn: figure.caption_en,
        footnoteEn: figure.footnote_en,
      }));

    const tableEntries: MinerUViewerEntry[] = manifest.tables
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((table) => ({
        kind: "table",
        number: table.number,
        pageIdx: table.page_idx,
        imagePath: table.image_path,
        imageURI: imageURIMap.get(table.image_path) || "",
        captionZh: table.caption_zh,
        captionEn: table.caption_en,
        footnoteEn: table.footnote_en,
      }));

    return [...figureEntries, ...tableEntries];
  }

  private static openViewerDialog(
    manifest: MinerUManifest,
    entries: MinerUViewerEntry[],
    tempDirPath: string,
  ): void {
    const dialogHelper = new ztoolkit.Dialog(4, 1)
      .addCell(0, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-viewer-meta",
        styles: {
          margin: "0 0 8px 0",
          fontSize: "12px",
        },
      })
      .addCell(2, 0, {
        tag: "div",
        namespace: "html",
        id: "zotero-mineru-viewer-image-container",
        styles: {
          width: "99%",
          height: "500px",
          overflow: "hidden",
          border: "1px solid #c9ccd1",
          background: "#fff",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
        },
        children: [
          {
            tag: "img",
            namespace: "html",
            id: "zotero-mineru-viewer-image",
            attributes: {
              src: "",
              draggable: "false",
            },
            styles: {
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: "translate(0px, 0px) scale(1)",
              transformOrigin: "center center",
            },
          },
        ],
      })
      .addCell(3, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-viewer-caption-zh",
        styles: {
          whiteSpace: "pre-wrap",
          margin: "4px 0",
          fontWeight: "600",
        },
      })
      .addCell(1, 0, {
        tag: "div",
        namespace: "html",
        id: "zotero-mineru-viewer-nav",
        styles: {
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          marginBottom: "6px",
        },
        children: [
          {
            tag: "div",
            namespace: "html",
            id: "zotero-mineru-viewer-shortcuts",
            styles: {
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              maxWidth: "380px",
            },
          },
        ],
      });

    const escapeHTML = (raw: string): string =>
      raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const renderPseudoLatex = (rawExpr: string): string => {
      const greekMap: Record<string, string> = {
        alpha: "α",
        beta: "β",
        gamma: "γ",
        delta: "δ",
        epsilon: "ε",
        varepsilon: "ϵ",
        zeta: "ζ",
        eta: "η",
        theta: "θ",
        vartheta: "ϑ",
        iota: "ι",
        kappa: "κ",
        lambda: "λ",
        mu: "μ",
        nu: "ν",
        xi: "ξ",
        omicron: "ο",
        pi: "π",
        varpi: "ϖ",
        rho: "ρ",
        varrho: "ϱ",
        sigma: "σ",
        varsigma: "ς",
        tau: "τ",
        upsilon: "υ",
        phi: "φ",
        varphi: "ϕ",
        chi: "χ",
        psi: "ψ",
        omega: "ω",
        Gamma: "Γ",
        Delta: "Δ",
        Theta: "Θ",
        Lambda: "Λ",
        Xi: "Ξ",
        Pi: "Π",
        Sigma: "Σ",
        Upsilon: "Υ",
        Phi: "Φ",
        Psi: "Ψ",
        Omega: "Ω",
      };

      let expr = escapeHTML(rawExpr)
        .replace(/\\%/g, "%")
        .replace(/\\left/g, "")
        .replace(/\\right/g, "")
        .replace(/\\cdot/g, " · ")
        .replace(/\\times/g, " × ")
        .replace(
          /\\([A-Za-z]+)/g,
          (match, name: string) => greekMap[name] || match,
        );

      expr = expr
        .replace(/\\(?:mathrm|mathbf|text)\s*\{([^{}]*)\}/g, "$1")
        .replace(/_\s*\{([^{}]*)\}/g, "<sub>$1</sub>")
        .replace(/\^\s*\{([^{}]*)\}/g, "<sup>$1</sup>")
        .replace(/_([A-Za-z0-9+\-./]+)/g, "<sub>$1</sub>")
        .replace(/\^([A-Za-z0-9+\-./]+)/g, "<sup>$1</sup>")
        .replace(/\\([A-Za-z]+)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();

      return `<span style="font-family: 'Times New Roman', serif;">${expr}</span>`;
    };

    const renderSafeInlineHTML = (raw: string): string => {
      const escaped = escapeHTML(raw);
      return escaped
        .replace(/\$\$([^$]+)\$\$/g, (_match, expr: string) =>
          renderPseudoLatex(expr),
        )
        .replace(/\$([^$\n]+)\$/g, (_match, expr: string) =>
          renderPseudoLatex(expr),
        )
        .replace(/&lt;(\/?(?:sub|sup|strong|b|em|i|code))&gt;/gi, "<$1>")
        .replace(/\n/g, "<br>");
    };

    const initViewerUI = () => {
      const doc = dialogHelper.window?.document;
      if (!doc) {
        return false;
      }

      const metaNode = doc.querySelector(
        "#zotero-mineru-viewer-meta",
      ) as HTMLParagraphElement | null;
      const imageContainerNode = doc.querySelector(
        "#zotero-mineru-viewer-image-container",
      ) as HTMLDivElement | null;
      const imageNode = doc.querySelector(
        "#zotero-mineru-viewer-image",
      ) as HTMLImageElement | null;
      const shortcutsNode = doc.querySelector(
        "#zotero-mineru-viewer-shortcuts",
      ) as HTMLDivElement | null;
      const zhNode = doc.querySelector(
        "#zotero-mineru-viewer-caption-zh",
      ) as HTMLParagraphElement | null;

      if (
        !metaNode ||
        !imageContainerNode ||
        !imageNode ||
        !shortcutsNode ||
        !zhNode
      ) {
        return false;
      }

      const figureMatched = manifest.translation?.matched_figure_count || 0;
      const tableMatched = manifest.translation?.matched_table_count || 0;
      metaNode.textContent = `图 ${manifest.stats.figure_count} / 表 ${manifest.stats.table_count} · 中文匹配：图 ${figureMatched}/${manifest.stats.figure_count}，表 ${tableMatched}/${manifest.stats.table_count}`;

      let currentIndex = 0;
      let zoomScale = 1;
      let translateX = 0;
      let translateY = 0;
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragBaseX = 0;
      let dragBaseY = 0;
      let hasVisualImage = false;
      const shortcutButtons: HTMLButtonElement[] = [];

      const clamp = (value: number, min: number, max: number): number =>
        Math.min(max, Math.max(min, value));

      const getPanLimits = () => {
        const width = imageContainerNode.clientWidth || 1;
        const height = imageContainerNode.clientHeight || 1;
        const limitX = Math.max(0, ((zoomScale - 1) * width) / 2);
        const limitY = Math.max(0, ((zoomScale - 1) * height) / 2);
        return {
          limitX,
          limitY,
        };
      };

      const clampPan = () => {
        const { limitX, limitY } = getPanLimits();
        translateX = clamp(translateX, -limitX, limitX);
        translateY = clamp(translateY, -limitY, limitY);
      };

      const applyImageTransform = () => {
        imageNode.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoomScale})`;
        imageNode.style.cursor =
          hasVisualImage && zoomScale > 1
            ? isDragging
              ? "grabbing"
              : "grab"
            : "default";
      };

      const resetZoom = () => {
        zoomScale = 1;
        translateX = 0;
        translateY = 0;
        isDragging = false;
        applyImageTransform();
      };

      const setZoom = (nextScale: number) => {
        if (!hasVisualImage) {
          return;
        }
        zoomScale = clamp(Number(nextScale.toFixed(2)), 1, 5);
        clampPan();
        applyImageTransform();
      };

      while (shortcutsNode.firstChild) {
        shortcutsNode.removeChild(shortcutsNode.firstChild);
      }

      entries.forEach((entry, index) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = `${entry.kind === "figure" ? "f" : "t"}${entry.number}`;
        button.style.padding = "2px 8px";
        button.style.border = "1px solid #c9ccd1";
        button.style.background = "#f6f7f8";
        button.style.cursor = "pointer";
        button.onclick = () => {
          render(index);
        };
        shortcutButtons.push(button);
        shortcutsNode.appendChild(button);
      });

      const render = (entryIndex: number) => {
        currentIndex = Math.max(0, Math.min(entryIndex, entries.length - 1));

        const entry = entries[currentIndex];
        if (!entry) {
          return;
        }

        shortcutButtons.forEach((button, index) => {
          if (index === currentIndex) {
            button.style.background = "#dce9ff";
            button.style.borderColor = "#4a79ff";
          } else {
            button.style.background = "#f6f7f8";
            button.style.borderColor = "#c9ccd1";
          }
        });

        if (entry.imageURI) {
          imageNode.src = entry.imageURI;
          imageNode.style.display = "block";
          hasVisualImage = true;
        } else {
          imageNode.src = "";
          imageNode.style.display = "none";
          hasVisualImage = false;
        }
        resetZoom();

        const kindLabel = entry.kind === "figure" ? "图" : "表";
        const zhText = entry.captionZh || "（未匹配到中文图表注）";
        zhNode.innerHTML = `${kindLabel}${entry.number} 中文：${renderSafeInlineHTML(zhText)}`;
      };

      imageContainerNode.addEventListener(
        "wheel",
        (event: WheelEvent) => {
          if (!hasVisualImage) {
            return;
          }
          event.preventDefault();
          const delta = event.deltaY < 0 ? 0.2 : -0.2;
          setZoom(zoomScale + delta);
        },
        { passive: false },
      );

      imageContainerNode.addEventListener("mousedown", (event: MouseEvent) => {
        if (!hasVisualImage || zoomScale <= 1) {
          return;
        }
        isDragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragBaseX = translateX;
        dragBaseY = translateY;
        applyImageTransform();
        event.preventDefault();
      });

      doc.addEventListener("mousemove", (event: MouseEvent) => {
        if (!isDragging) {
          return;
        }
        const { limitX, limitY } = getPanLimits();
        const dx = event.clientX - dragStartX;
        const dy = event.clientY - dragStartY;
        translateX = clamp(dragBaseX + dx, -limitX, limitX);
        translateY = clamp(dragBaseY + dy, -limitY, limitY);
        applyImageTransform();
      });

      doc.addEventListener("mouseup", () => {
        if (!isDragging) {
          return;
        }
        isDragging = false;
        applyImageTransform();
      });

      render(0);
      return true;
    };

    const retryInit = () => {
      if (initViewerUI()) {
        return;
      }
      const setTimeoutFn = ztoolkit.getGlobal(
        "setTimeout",
      ) as typeof setTimeout;
      setTimeoutFn(retryInit, 60);
    };

    const dialogData = {
      loadCallback: () => {
        retryInit();
      },
      unloadCallback: () => {
        this.removeDirectoryIfExists(tempDirPath);
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
      },
    };

    dialogHelper
      .setDialogData(dialogData)
      .open(getString("mineru-viewer-title"), {
        width: 540,
        height: 460,
        centerscreen: true,
        resizable: true,
        fitContent: false,
        noDialogMode: true,
      });

    addon.data.dialog = dialogHelper;
  }

  private static async loadLatestMergedManifestAndZip(
    targetItem: Zotero.Item,
  ): Promise<{
    mergedManifestAttachment: Zotero.Item;
    mergedManifest: MinerUManifest;
    zipAttachment: Zotero.Item;
    zipFile: nsIFile;
  }> {
    const attachments = this.getItemAttachments(targetItem).sort(
      (a, b) => b.id - a.id,
    );
    const mergedManifestAttachment = attachments.find((attachment) =>
      this.isMineruMergedManifestAttachment(attachment),
    );
    if (!mergedManifestAttachment) {
      throw new Error(getString("mineru-viewer-error-no-merged-manifest"));
    }

    const mergedManifest = await this.readMergedManifestAttachment(
      mergedManifestAttachment,
    );

    const expectedZipName = this.expectedZipNameFromMergedManifest(
      mergedManifestAttachment.attachmentFilename || "",
    ).toLowerCase();
    const zipAttachment =
      attachments.find((attachment) => {
        if (!this.isMineruZipAttachment(attachment)) {
          return false;
        }
        if (!expectedZipName) {
          return false;
        }
        return (
          (attachment.attachmentFilename || "").toLowerCase() ===
          expectedZipName
        );
      }) ||
      attachments.find((attachment) => this.isMineruZipAttachment(attachment));

    if (!zipAttachment) {
      throw new Error(getString("mineru-viewer-error-no-zip"));
    }

    const zipPath = await zipAttachment.getFilePathAsync();
    if (!zipPath) {
      throw new Error(getString("mineru-viewer-error-no-zip"));
    }

    return {
      mergedManifestAttachment,
      mergedManifest,
      zipAttachment,
      zipFile: Zotero.File.pathToFile(zipPath),
    };
  }

  private static async openViewerForSelectedItem(): Promise<void> {
    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(getString("mineru-error-no-selection"), "error");
      return;
    }

    const targetItem = this.resolveTargetItem(selectedItems[0]);
    let tempDirPath = "";

    try {
      const loaded = await this.loadLatestMergedManifestAndZip(targetItem);
      const mergedManifest = loaded.mergedManifest;

      if (!mergedManifest.figures.length && !mergedManifest.tables.length) {
        throw new Error(getString("mineru-viewer-error-no-visual-content"));
      }

      const extractionResult = this.extractViewerImageURIMap(
        loaded.zipFile,
        mergedManifest,
      );
      tempDirPath = extractionResult.tempDirPath;
      const entries = this.buildViewerEntries(
        mergedManifest,
        extractionResult.imageURIMap,
      );
      if (!entries.length) {
        throw new Error(getString("mineru-viewer-error-no-visual-content"));
      }

      this.openViewerDialog(mergedManifest, entries, tempDirPath);
      tempDirPath = "";
    } catch (error) {
      this.removeDirectoryIfExists(tempDirPath);
      ztoolkit.log("open mineru viewer failed", targetItem.id, error);
      this.showToast(
        getString("mineru-item-failed", {
          args: {
            title: targetItem.getDisplayTitle() || targetItem.key,
            reason: this.getErrorMessage(error),
          },
        }),
        "error",
      );
    }
  }

  private static resolveTargetItem(item: Zotero.Item): Zotero.Item {
    if (item.isRegularItem()) {
      return item;
    }
    if (item.parentItemID) {
      const parent = Zotero.Items.get(item.parentItemID);
      if (parent) {
        return parent;
      }
    }
    return item;
  }

  private static async getPdfAttachment(
    item: Zotero.Item,
    preferredFileName = "",
  ): Promise<Zotero.Item | null> {
    const normalizedPreferredFileName = preferredFileName.trim().toLowerCase();

    const matchesPreferredFileName = async (
      attachment: Zotero.Item,
    ): Promise<boolean> => {
      if (!normalizedPreferredFileName || !attachment.isPDFAttachment()) {
        return false;
      }

      try {
        const path = await attachment.getFilePathAsync();
        if (typeof path !== "string" || !path.trim()) {
          return false;
        }
        const leafName = this.getFileNameFromPath(path).toLowerCase();
        return leafName === normalizedPreferredFileName;
      } catch (_error) {
        return false;
      }
    };

    if (item.isPDFAttachment()) {
      if (!normalizedPreferredFileName) {
        return item;
      }
      if (await matchesPreferredFileName(item)) {
        return item;
      }
    }

    if (normalizedPreferredFileName) {
      for (const attachmentID of item.getAttachments()) {
        const attachment = Zotero.Items.get(attachmentID);
        if (!attachment?.isPDFAttachment()) {
          continue;
        }
        if (await matchesPreferredFileName(attachment)) {
          return attachment;
        }
      }
    }

    const bestAttachment = await item.getBestAttachment();
    if (bestAttachment && bestAttachment.isPDFAttachment()) {
      return bestAttachment;
    }

    for (const attachmentID of item.getAttachments()) {
      const attachment = Zotero.Items.get(attachmentID);
      if (attachment?.isPDFAttachment()) {
        return attachment;
      }
    }

    return null;
  }

  private static getAPIHeaders(token: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "*/*",
    };
  }

  private static parseMinerUResponse<T>(responseText: string): T {
    let payload: MinerUApiResponse<T>;
    try {
      payload = JSON.parse(responseText) as MinerUApiResponse<T>;
    } catch (_error) {
      throw new Error(getString("mineru-error-invalid-response"));
    }

    if (payload.code === 0 && payload.data !== undefined) {
      return payload.data;
    }

    throw new Error(payload.msg || getString("mineru-error-api"));
  }

  private static async createUploadURL(
    token: string,
    fileName: string,
    dataID: string,
  ): Promise<MinerUFileURLBatchData> {
    const baseURL = this.getBaseURL();
    const requestBody = {
      files: [{ name: fileName, data_id: dataID }],
      model_version: this.getModelVersion(),
      enable_formula: true,
      enable_table: true,
    };

    const response = await Zotero.HTTP.request(
      "POST",
      `${baseURL}/file-urls/batch`,
      {
        headers: this.getAPIHeaders(token),
        body: JSON.stringify(requestBody),
        timeout: MINERU_TIMEOUT_MS,
      },
    );

    return this.parseMinerUResponse<MinerUFileURLBatchData>(
      response.responseText || "",
    );
  }

  private static binaryStringToUint8Array(binary: string): Uint8Array {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  private static async uploadFile(
    uploadURL: string,
    filePath: string,
  ): Promise<void> {
    const binary = await Zotero.File.getBinaryContentsAsync(filePath);
    if (typeof binary !== "string") {
      throw new Error(getString("mineru-error-read-file"));
    }

    const bytes = this.binaryStringToUint8Array(binary);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadURL, true);
      xhr.timeout = MINERU_TIMEOUT_MS;

      xhr.onload = () => {
        if ([200, 201, 204].includes(xhr.status)) {
          resolve();
          return;
        }

        reject(
          new Error(
            `upload failed with status ${xhr.status}: ${xhr.responseText || ""}`,
          ),
        );
      };

      xhr.onerror = () => {
        reject(new Error("upload request failed"));
      };

      xhr.ontimeout = () => {
        reject(new Error(getString("mineru-error-upload-timeout")));
      };

      // Keep Blob type empty to avoid auto-injecting Content-Type,
      // which can break pre-signed OSS URL signature verification.
      xhr.send(new Blob([bytes]));
    });
  }

  private static pickBatchResult(
    data: MinerUBatchResultData,
    dataID: string,
    fileName: string,
  ): MinerUExtractResultItem | null {
    const list = data.extract_result || [];
    if (!list.length) {
      return null;
    }

    return (
      list.find((item) => item.data_id === dataID) ||
      list.find((item) => item.file_name === fileName) ||
      list[0]
    );
  }

  private static async pollBatchResult(
    token: string,
    batchID: string,
    dataID: string,
    fileName: string,
    onStateChange: (state: string) => void,
  ): Promise<MinerUExtractResultItem> {
    const startAt = Date.now();
    const baseURL = this.getBaseURL();

    while (Date.now() - startAt <= MINERU_POLL_TIMEOUT_MS) {
      const response = await Zotero.HTTP.request(
        "GET",
        `${baseURL}/extract-results/batch/${encodeURIComponent(batchID)}`,
        {
          headers: this.getAPIHeaders(token),
          timeout: MINERU_TIMEOUT_MS,
        },
      );

      const data = this.parseMinerUResponse<MinerUBatchResultData>(
        response.responseText || "",
      );

      const result = this.pickBatchResult(data, dataID, fileName);
      if (!result) {
        await Zotero.Promise.delay(MINERU_POLL_INTERVAL_MS);
        continue;
      }

      const state = (result.state || "unknown").trim();
      onStateChange(state);

      if (state.toLowerCase() === "done") {
        return result;
      }

      if (state.toLowerCase() === "failed") {
        throw new Error(
          result.err_msg || getString("mineru-error-task-failed"),
        );
      }

      await Zotero.Promise.delay(MINERU_POLL_INTERVAL_MS);
    }

    throw new Error(getString("mineru-error-timeout"));
  }

  private static buildOutputBaseName(item: Zotero.Item): string {
    const title = item.getDisplayTitle() || item.key;
    const safeTitle = this.sanitizeFileName(title);
    const timestamp = this.formatTimestamp();
    return `${safeTitle}-mineru-${timestamp}`;
  }

  private static async downloadZipToTempFile(
    fullZipURL: string,
    fileName: string,
  ): Promise<nsIFile> {
    const zipFile = Zotero.getTempDirectory();
    zipFile.append(fileName);

    await Zotero.File.download(fullZipURL, zipFile.path);

    if (!zipFile.exists()) {
      throw new Error(getString("mineru-error-empty-download"));
    }

    if (zipFile.fileSize <= 0) {
      throw new Error(getString("mineru-error-empty-download"));
    }

    return zipFile;
  }

  private static sanitizeFileName(rawName: string): string {
    const fileName = rawName
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    if (!fileName) {
      return "mineru-output";
    }
    return fileName.slice(0, 80);
  }

  private static formatTimestamp(date = new Date()): string {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}${second}`;
  }

  private static getFileNameFromPath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop();
    return fileName || "document.pdf";
  }

  private static async readZipEntryText(
    zipFile: nsIFile,
    entryName: string,
  ): Promise<string> {
    const zipReader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader) as nsIZipReader;

    try {
      zipReader.open(zipFile);
      const inputStream = zipReader.getInputStream(entryName);
      try {
        const content = await Zotero.File.getContentsAsync(
          inputStream,
          "utf-8",
        );
        if (typeof content !== "string") {
          throw new Error("failed to decode zip entry");
        }
        return content;
      } finally {
        inputStream.close();
      }
    } finally {
      zipReader.close();
    }
  }

  private static async readContentListFromZip(zipFile: nsIFile): Promise<{
    entryName: string;
    items: MinerURawContentItem[];
  }> {
    const zipReader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader) as nsIZipReader;

    let entryName = "";
    try {
      zipReader.open(zipFile);
      const entries = zipReader.findEntries("*");
      while (entries.hasMore()) {
        const current = entries.getNext();
        if (current.endsWith("_content_list.json")) {
          entryName = current;
          break;
        }
        if (!entryName && current.toLowerCase().includes("content_list.json")) {
          entryName = current;
        }
      }
    } finally {
      zipReader.close();
    }

    if (!entryName) {
      throw new Error("content_list.json not found in MinerU zip");
    }

    const content = await this.readZipEntryText(zipFile, entryName);
    const parsed = JSON.parse(content) as unknown;

    if (Array.isArray(parsed)) {
      return {
        entryName,
        items: parsed as MinerURawContentItem[],
      };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { content_list?: unknown[] }).content_list)
    ) {
      return {
        entryName,
        items: (parsed as { content_list: MinerURawContentItem[] })
          .content_list,
      };
    }

    throw new Error("invalid content_list format");
  }

  private static async readPrimaryMarkdownFromZip(
    zipFile: nsIFile,
  ): Promise<MinerUMarkdownData | null> {
    const zipReader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader) as nsIZipReader;

    const markdownEntries: string[] = [];
    try {
      zipReader.open(zipFile);
      const entries = zipReader.findEntries("*");
      while (entries.hasMore()) {
        const current = entries.getNext();
        if (current.endsWith("/")) {
          continue;
        }
        if (current.toLowerCase().endsWith(".md")) {
          markdownEntries.push(current);
        }
      }
    } finally {
      zipReader.close();
    }

    if (!markdownEntries.length) {
      return null;
    }

    const scoredEntries = markdownEntries
      .map((entryName) => {
        let score = entryName.length;
        const lower = entryName.toLowerCase();
        if (!entryName.includes("/")) {
          score -= 100;
        }
        if (/(^|\/)(?:output|result|content|index)\.md$/.test(lower)) {
          score -= 60;
        }
        if (lower.includes("mineru")) {
          score -= 10;
        }
        return { entryName, score };
      })
      .sort((a, b) => a.score - b.score);

    const bestEntry = scoredEntries[0]?.entryName;
    if (!bestEntry) {
      return null;
    }

    const content = await this.readZipEntryText(zipFile, bestEntry);
    if (!content.trim()) {
      return null;
    }

    return {
      entryName: bestEntry,
      content,
    };
  }

  private static normalizeZipPath(inputPath: string): string {
    return inputPath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .toLowerCase();
  }

  private static getZipPathBasename(inputPath: string): string {
    const normalized = this.normalizeZipPath(inputPath);
    return normalized.split("/").pop() || normalized;
  }

  private static addMarkdownPathHint(
    map: Map<string, number>,
    rawPath: string,
    number: number,
  ): void {
    const normalized = this.normalizeZipPath(rawPath);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, number);
    }

    const basename = this.getZipPathBasename(rawPath);
    if (basename && !map.has(basename)) {
      map.set(basename, number);
    }
  }

  private static addMarkdownPathTag(set: Set<string>, rawPath: string): void {
    const normalized = this.normalizeZipPath(rawPath);
    if (normalized) {
      set.add(normalized);
    }

    const basename = this.getZipPathBasename(rawPath);
    if (basename) {
      set.add(basename);
    }
  }

  private static hasMarkdownPathTag(
    set: Set<string>,
    rawPath: string,
  ): boolean {
    const normalized = this.normalizeZipPath(rawPath);
    if (normalized && set.has(normalized)) {
      return true;
    }

    const basename = this.getZipPathBasename(rawPath);
    if (basename && set.has(basename)) {
      return true;
    }

    return false;
  }

  private static hasFigureCaptionPattern(text: string): boolean {
    return /\bfig(?:ure)?\.?\s*(?:s)?\s*\d+\b/i.test(text);
  }

  private static hasTableCaptionPattern(text: string): boolean {
    return /\btable\s*(?:s)?\s*\d+\b/i.test(text);
  }

  private static extractImageNumberHintsFromMarkdown(
    markdown: string,
  ): MinerUMarkdownHints {
    const figureNumbersByPath = new Map<string, number>();
    const tableNumbersByPath = new Map<string, number>();
    const figureCaptionPaths = new Set<string>();
    const tableCaptionPaths = new Set<string>();
    const imageRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

    let match = imageRegex.exec(markdown);
    while (match) {
      const imagePath = (match[1] || "").trim();
      if (imagePath) {
        const contextStart = Math.max(0, match.index - 220);
        const contextEnd = Math.min(
          markdown.length,
          match.index + match[0].length + 260,
        );
        const context = markdown.slice(contextStart, contextEnd);

        if (this.hasFigureCaptionPattern(context)) {
          this.addMarkdownPathTag(figureCaptionPaths, imagePath);
        }
        if (this.hasTableCaptionPattern(context)) {
          this.addMarkdownPathTag(tableCaptionPaths, imagePath);
        }

        const figureNumber = this.parseFigureNumber(context);
        if (
          figureNumber &&
          Number.isInteger(figureNumber) &&
          figureNumber > 0
        ) {
          this.addMarkdownPathHint(
            figureNumbersByPath,
            imagePath,
            figureNumber,
          );
        }

        const tableNumber = this.parseTableNumber(context);
        if (tableNumber && Number.isInteger(tableNumber) && tableNumber > 0) {
          this.addMarkdownPathHint(tableNumbersByPath, imagePath, tableNumber);
        }
      }

      match = imageRegex.exec(markdown);
    }

    return {
      figureNumbersByPath,
      tableNumbersByPath,
      figureCaptionPaths,
      tableCaptionPaths,
    };
  }

  private static lookupImageNumberHint(
    imagePath: string,
    hints: Map<string, number>,
  ): number | null {
    if (!imagePath.trim()) {
      return null;
    }

    const normalized = this.normalizeZipPath(imagePath);
    if (hints.has(normalized)) {
      return hints.get(normalized) || null;
    }

    const basename = this.getZipPathBasename(imagePath);
    if (hints.has(basename)) {
      return hints.get(basename) || null;
    }

    return null;
  }

  private static normalizeTextList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  private static joinTextList(parts: string[]): string {
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  private static stripSimpleHTML(input: string): string {
    return input
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static extractTableCaptionFromBody(tableBody: string): string {
    if (!tableBody.trim()) {
      return "";
    }

    const firstCell = tableBody.match(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
    if (firstCell?.[1]) {
      return this.stripSimpleHTML(firstCell[1]);
    }

    const plain = this.stripSimpleHTML(tableBody);
    const match = plain.match(/Table\s*\d+\s*[|:：]?\s*[^\n]+/i);
    return match ? match[0].trim() : "";
  }

  private static parseFigureNumber(caption: string): number | null {
    const match = caption.match(
      /(?:\bfig(?:ure)?\.?\s*(?:s)?|图)\s*([0-9]+)(?:[A-Za-z])?/i,
    );
    if (!match?.[1]) {
      return null;
    }
    return Number(match[1]);
  }

  private static parseTableNumber(caption: string): number | null {
    const match = caption.match(
      /(?:\btable\s*(?:s)?|表)\s*([0-9]+)(?:[A-Za-z])?/i,
    );
    if (!match?.[1]) {
      return null;
    }
    return Number(match[1]);
  }

  private static shouldIgnoreFrontMatterFigure(
    rawItem: MinerURawContentItem,
    hasExplicitNumber: boolean,
  ): boolean {
    const pageIdx =
      typeof rawItem.page_idx === "number" ? rawItem.page_idx : null;
    if (pageIdx === null || pageIdx > MINERU_FRONT_MATTER_MAX_PAGE_IDX) {
      return false;
    }

    // Ignore first-page non-numbered image blocks (e.g., graphical abstract).
    // Keep all non-first-page figures and any explicit "Figure X" entry.
    return !hasExplicitNumber;
  }

  private static asNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((num): num is number => typeof num === "number");
  }

  private static async buildManifestFromZip(
    zipFile: nsIFile,
    item: Zotero.Item,
    batchID: string,
    result: MinerUExtractResultItem,
  ): Promise<MinerUManifest> {
    const { entryName, items } = await this.readContentListFromZip(zipFile);

    const typeCounts: Record<string, number> = {};
    for (const rawItem of items) {
      const type = typeof rawItem.type === "string" ? rawItem.type : "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    const figuresRaw = items.filter((rawItem) => rawItem.type === "image");
    const tablesRaw = items.filter((rawItem) => rawItem.type === "table");

    const markdownData = await this.readPrimaryMarkdownFromZip(zipFile);
    const markdownHints = markdownData
      ? this.extractImageNumberHintsFromMarkdown(markdownData.content)
      : {
          figureNumbersByPath: new Map<string, number>(),
          tableNumbersByPath: new Map<string, number>(),
          figureCaptionPaths: new Set<string>(),
          tableCaptionPaths: new Set<string>(),
        };

    const preparedFigures = figuresRaw.map((rawItem) => {
      const caption = this.joinTextList(
        this.normalizeTextList(rawItem.image_caption),
      );
      const footnote = this.joinTextList(
        this.normalizeTextList(rawItem.image_footnote),
      );

      const captionNumber = this.parseFigureNumber(caption);
      const markdownNumber = this.lookupImageNumberHint(
        rawItem.img_path || "",
        markdownHints.figureNumbersByPath,
      );
      const hasMarkdownFigureCaption = this.hasMarkdownPathTag(
        markdownHints.figureCaptionPaths,
        rawItem.img_path || "",
      );
      const parsedNumber = captionNumber || markdownNumber;
      const numberSource: MinerUManifestFigure["number_source"] = captionNumber
        ? "caption"
        : markdownNumber
          ? "markdown"
          : "fallback-sequence";

      return {
        rawItem,
        caption,
        footnote,
        parsedNumber,
        numberSource,
        hasMarkdownFigureCaption,
      };
    });

    const filteredFigures = preparedFigures.filter(
      (entry) =>
        !this.shouldIgnoreFrontMatterFigure(
          entry.rawItem,
          entry.parsedNumber !== null || entry.hasMarkdownFigureCaption,
        ),
    );

    const ignoredFrontMatterFigureCount =
      preparedFigures.length - filteredFigures.length;

    const figures: MinerUManifestFigure[] = filteredFigures.map(
      (entry, index) => {
        const number = entry.parsedNumber || index + 1;
        return {
          number,
          number_source: entry.numberSource,
          page_idx:
            typeof entry.rawItem.page_idx === "number"
              ? entry.rawItem.page_idx
              : null,
          image_path: entry.rawItem.img_path || "",
          caption_en: entry.caption,
          caption_zh: "",
          footnote_en: entry.footnote,
          bbox: this.asNumberArray(entry.rawItem.bbox),
        };
      },
    );

    const tables: MinerUManifestTable[] = tablesRaw.map((rawItem, index) => {
      const captionFromList = this.joinTextList(
        this.normalizeTextList(rawItem.table_caption),
      );
      const captionFromBody = this.extractTableCaptionFromBody(
        rawItem.table_body || "",
      );
      const caption = captionFromList || captionFromBody;
      const footnote = this.joinTextList(
        this.normalizeTextList(rawItem.table_footnote),
      );
      const captionNumber = this.parseTableNumber(
        caption || rawItem.table_body || "",
      );
      const markdownNumber = this.lookupImageNumberHint(
        rawItem.img_path || "",
        markdownHints.tableNumbersByPath,
      );
      const parsedNumber = captionNumber || markdownNumber;
      const number = parsedNumber || index + 1;
      return {
        number,
        number_source: captionNumber
          ? "caption"
          : markdownNumber
            ? "markdown"
            : "fallback-sequence",
        page_idx:
          typeof rawItem.page_idx === "number" ? rawItem.page_idx : null,
        image_path: rawItem.img_path || "",
        caption_en: caption,
        caption_zh: "",
        footnote_en: footnote,
        table_html: rawItem.table_body || "",
        bbox: this.asNumberArray(rawItem.bbox),
      };
    });

    return {
      generated_at: new Date().toISOString(),
      source_item: {
        id: item.id,
        key: item.key,
        title: item.getDisplayTitle() || item.key,
      },
      mineru: {
        batch_id: batchID,
        state: result.state || "",
        full_zip_url: result.full_zip_url || "",
        data_id: result.data_id || "",
        file_name: result.file_name || "",
      },
      content_list_entry: entryName,
      ...(markdownData
        ? { source_markdown_entry: markdownData.entryName }
        : {}),
      stats: {
        total_items: items.length,
        type_counts: typeCounts,
        figure_count: figures.length,
        table_count: tables.length,
        ...(ignoredFrontMatterFigureCount > 0
          ? {
              ignored_front_matter_figure_count: ignoredFrontMatterFigureCount,
            }
          : {}),
      },
      figures,
      tables,
    };
  }

  private static isDeepSeekMarkdownAttachment(
    attachment: Zotero.Item,
  ): boolean {
    if (!attachment.isAttachment()) {
      return false;
    }

    const contentType = (attachment.attachmentContentType || "").toLowerCase();
    const fileName = (attachment.attachmentFilename || "").toLowerCase();
    const title = (attachment.getDisplayTitle() || "").toLowerCase();

    const looksLikeMarkdown =
      contentType.includes("markdown") || fileName.endsWith(".md");
    const looksLikeDeepSeek =
      fileName.includes("deepseek") ||
      title.includes("deepseek translation") ||
      title.includes("deepseek");

    return looksLikeMarkdown && looksLikeDeepSeek;
  }

  private static matchZhCaptionStartLine(
    line: string,
  ): { kind: "图" | "表"; number: number; firstText: string } | null {
    const match = line.match(/^\*\*(图|表)\s*(\d+)\s*[：:]\*\*\s*(.*)$/);
    if (!match) {
      return null;
    }

    const kind = match[1] as "图" | "表";
    const number = Number(match[2]);
    const firstText = (match[3] || "").trim();
    if (!Number.isFinite(number) || number <= 0) {
      return null;
    }

    return {
      kind,
      number,
      firstText,
    };
  }

  private static extractZhCaptionsFromMarkdown(markdown: string): {
    figureCaptions: Map<number, string>;
    tableCaptions: Map<number, string>;
  } {
    const figureCaptions = new Map<number, string>();
    const tableCaptions = new Map<number, string>();
    const lines = markdown.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const start = this.matchZhCaptionStartLine(lines[i]);
      if (!start) {
        continue;
      }

      const parts: string[] = [];
      if (start.firstText) {
        parts.push(start.firstText);
      }

      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (this.matchZhCaptionStartLine(nextLine)) {
          break;
        }

        const trimmed = nextLine.trim();
        if (!trimmed) {
          break;
        }
        if (/^#{1,6}\s/.test(trimmed) || trimmed === "---") {
          break;
        }

        parts.push(trimmed);
        j += 1;
      }

      i = j - 1;

      const caption = parts.join(" ").replace(/\s+/g, " ").trim();
      if (!caption) {
        continue;
      }

      if (start.kind === "图") {
        figureCaptions.set(start.number, caption);
      } else {
        tableCaptions.set(start.number, caption);
      }
    }

    return {
      figureCaptions,
      tableCaptions,
    };
  }

  private static async readLatestZhCaptionIndex(
    item: Zotero.Item,
  ): Promise<ZhCaptionIndex | null> {
    const attachments = item
      .getAttachments()
      .map((attachmentID) => Zotero.Items.get(attachmentID))
      .filter(
        (attachment): attachment is Zotero.Item =>
          Boolean(attachment) &&
          this.isDeepSeekMarkdownAttachment(attachment as Zotero.Item),
      )
      .sort((a, b) => b.id - a.id);

    for (const attachment of attachments) {
      const filePath = await attachment.getFilePathAsync();
      if (!filePath) {
        continue;
      }

      const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
      if (typeof content !== "string") {
        continue;
      }

      const captions = this.extractZhCaptionsFromMarkdown(content);
      if (!captions.figureCaptions.size && !captions.tableCaptions.size) {
        continue;
      }

      return {
        sourceAttachmentID: attachment.id,
        sourceAttachmentTitle: attachment.getDisplayTitle() || "",
        sourceAttachmentFileName: attachment.attachmentFilename || "",
        figureCaptions: captions.figureCaptions,
        tableCaptions: captions.tableCaptions,
      };
    }

    return null;
  }

  private static applyZhCaptionsToManifest(
    manifest: MinerUManifest,
    captionIndex: ZhCaptionIndex,
  ): MinerUManifest {
    const matchedFigureNumbers: number[] = [];
    const matchedTableNumbers: number[] = [];

    const figures = manifest.figures.map((figure) => {
      const caption = captionIndex.figureCaptions.get(figure.number);
      if (!caption) {
        return figure;
      }
      matchedFigureNumbers.push(figure.number);
      return {
        ...figure,
        caption_zh: caption,
      };
    });

    const tables = manifest.tables.map((table) => {
      const caption = captionIndex.tableCaptions.get(table.number);
      if (!caption) {
        return table;
      }
      matchedTableNumbers.push(table.number);
      return {
        ...table,
        caption_zh: caption,
      };
    });

    return {
      ...manifest,
      figures,
      tables,
      translation: {
        source_markdown_attachment_id: captionIndex.sourceAttachmentID,
        source_markdown_attachment_title: captionIndex.sourceAttachmentTitle,
        source_markdown_file_name: captionIndex.sourceAttachmentFileName,
        matched_figure_count: matchedFigureNumbers.length,
        matched_table_count: matchedTableNumbers.length,
        matched_figure_numbers: matchedFigureNumbers,
        matched_table_numbers: matchedTableNumbers,
      },
    };
  }

  private static createHtmlCanvas(doc: Document): HTMLCanvasElement {
    return doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    ) as HTMLCanvasElement;
  }

  private static isCanvasLikelyBlank(canvas: HTMLCanvasElement): boolean {
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      return true;
    }

    const sampleCols = 16;
    const sampleRows = 16;
    const stepX = Math.max(1, Math.floor(canvas.width / sampleCols));
    const stepY = Math.max(1, Math.floor(canvas.height / sampleRows));

    let minLuma = 255;
    let maxLuma = 0;
    let opaqueCount = 0;
    let sampled = 0;

    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        const r = pixel[0] || 0;
        const g = pixel[1] || 0;
        const b = pixel[2] || 0;
        const a = pixel[3] || 0;
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
        if (a > 8) {
          opaqueCount += 1;
        }
        sampled += 1;
      }
    }

    if (!sampled) {
      return true;
    }

    const opaqueRatio = opaqueCount / sampled;
    const lumaRange = maxLuma - minLuma;

    return opaqueRatio < 0.05 || lumaRange < 2.5;
  }

  private static async createCanvasFromImageURI(
    imageURI: string,
    doc: Document,
  ): Promise<HTMLCanvasElement | null> {
    if (!imageURI.trim()) {
      return null;
    }

    const image = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "img",
    ) as HTMLImageElement;

    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = imageURI;
    });
    if (!loaded || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return null;
    }

    const canvas = this.createHtmlCanvas(doc);
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0);
    return canvas;
  }

  private static isCanvasLike(value: unknown): value is HTMLCanvasElement {
    return !!(
      value &&
      typeof (value as any).width === "number" &&
      typeof (value as any).height === "number" &&
      typeof (value as any).getContext === "function"
    );
  }

  private static cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
    const doc = source.ownerDocument || Zotero.getMainWindow().document;
    const canvas = this.createHtmlCanvas(doc);
    canvas.width = Math.max(1, source.width);
    canvas.height = Math.max(1, source.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (context) {
      context.drawImage(source, 0, 0);
    }
    return canvas;
  }

  private static getRenderedCanvasFromPageView(
    pageView: any,
  ): HTMLCanvasElement | null {
    const candidates = [
      pageView?.originalCanvas,
      pageView?.canvas,
      pageView?.actualCanvas,
      pageView?.layer?.originalCanvas,
      pageView?.layer?.canvas,
    ];

    for (const candidate of candidates) {
      if (
        this.isCanvasLike(candidate) &&
        candidate.width > 0 &&
        candidate.height > 0
      ) {
        return candidate;
      }
    }

    return null;
  }

  private static async getCanvasFromReaderView(
    reader: any,
    pageIdx: number,
  ): Promise<HTMLCanvasElement | null> {
    try {
      await reader.navigate?.({ pageIndex: pageIdx });
    } catch (_error) {
      // Ignore navigation errors and continue with best effort.
    }

    const readOnce = async (): Promise<HTMLCanvasElement | null> => {
      const primaryView = reader?._internalReader?._primaryView;

      const pageLists = [
        primaryView?._pages,
        primaryView?.pages,
        primaryView?.layer?.pages,
      ];

      for (const list of pageLists) {
        if (!Array.isArray(list)) {
          continue;
        }
        const pageView = list[pageIdx];
        if (!pageView) {
          continue;
        }

        const redraw = pageView.redrawOriginalPage;
        if (typeof redraw === "function") {
          try {
            await redraw.call(pageView);
          } catch (_error) {
            // Continue to other fallbacks.
          }
        }

        const rendered = this.getRenderedCanvasFromPageView(pageView);
        if (rendered) {
          return this.cloneCanvas(rendered);
        }
      }

      const pdfViewer =
        primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer ||
        reader?._iframeWindow?.PDFViewerApplication?.pdfViewer;
      if (pdfViewer && typeof pdfViewer.getPageView === "function") {
        try {
          const pageView = pdfViewer.getPageView(pageIdx);
          if (pageView) {
            const draw = pageView.draw;
            if (
              typeof draw === "function" &&
              !this.getRenderedCanvasFromPageView(pageView)
            ) {
              try {
                const renderTask = draw.call(pageView);
                if (renderTask?.promise) {
                  await renderTask.promise;
                } else if (renderTask) {
                  await renderTask;
                }
              } catch (_error) {
                // Continue to other fallbacks.
              }
            }

            const rendered = this.getRenderedCanvasFromPageView(pageView);
            if (rendered) {
              return this.cloneCanvas(rendered);
            }
          }
        } catch (_error) {
          // Ignore and let downstream fallbacks run.
        }
      }

      return null;
    };

    const startAt = Date.now();
    while (Date.now() - startAt < 8000) {
      const rendered = await readOnce();
      if (rendered) {
        return rendered;
      }
      await Zotero.Promise.delay(120);
    }

    return null;
  }

  private static getPdfDocumentFromReader(reader: any): any {
    return (
      reader?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication
        ?.pdfDocument ||
      reader?._iframeWindow?.PDFViewerApplication?.pdfDocument ||
      null
    );
  }

  private static async forceReaderRenderPage(
    reader: any,
    pageIdx: number,
  ): Promise<void> {
    if (!reader) {
      return;
    }

    const app =
      reader?._internalReader?._primaryView?._iframeWindow
        ?.PDFViewerApplication || reader?._iframeWindow?.PDFViewerApplication;
    const viewer = app?.pdfViewer;
    const pageNumber = pageIdx + 1;

    try {
      await reader.navigate?.({ pageIndex: pageIdx });
    } catch (_error) {
      // Ignore navigation errors.
    }

    try {
      if (typeof app?.page === "number") {
        app.page = pageNumber;
      }
    } catch (_error) {
      // Ignore application page switch errors.
    }

    try {
      viewer?.scrollPageIntoView?.({ pageNumber });
    } catch (_error) {
      // Ignore scroll errors.
    }

    try {
      app?.forceRendering?.();
    } catch (_error) {
      // Ignore force rendering errors.
    }

    await Zotero.Promise.delay(360);
  }

  private static getEnvironmentVariable(name: string): string {
    try {
      const envService = (Components.classes as any)[
        "@mozilla.org/process/environment;1"
      ].getService(Components.interfaces.nsIEnvironment) as nsIEnvironment;
      const value = envService.get(name);
      return typeof value === "string" ? value.trim() : "";
    } catch (_error) {
      return "";
    }
  }

  private static isPythonCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized === "python" ||
      normalized === "python3" ||
      normalized === "py" ||
      normalized.endsWith("\\python.exe") ||
      normalized.endsWith("/python") ||
      normalized.endsWith("/python3") ||
      normalized.endsWith("python.exe")
    );
  }

  private static normalizeExecutablePath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/^"|"$/g, "");
  }

  private static isAbsolutePath(path: string): boolean {
    const normalized = path.trim();
    if (!normalized) {
      return false;
    }
    if (/^[A-Za-z]:[\\/]/.test(normalized)) {
      return true;
    }
    if (normalized.startsWith("\\\\")) {
      return true;
    }
    return normalized.startsWith("/");
  }

  private static fileExists(path: string): boolean {
    const normalized = this.normalizeExecutablePath(path);
    if (!normalized) {
      return false;
    }

    try {
      const file = Zotero.File.pathToFile(normalized);
      return file.exists() && file.isFile();
    } catch (_error) {
      return false;
    }
  }

  private static splitPathEnvironment(pathValue: string): string[] {
    if (!pathValue.trim()) {
      return [];
    }

    const delimiter = Zotero.isWin ? ";" : ":";
    return pathValue
      .split(delimiter)
      .map((segment) => this.normalizeExecutablePath(segment))
      .filter(Boolean);
  }

  private static parseCommandLine(commandLine: string): {
    command: string;
    args: string[];
  } | null {
    const text = commandLine.trim();
    if (!text) {
      return null;
    }

    const tokens: string[] = [];
    let current = "";
    let inQuote = false;
    for (const char of text) {
      if (char === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (!inQuote && /\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      current += char;
    }
    if (current) {
      tokens.push(current);
    }

    if (!tokens.length) {
      return null;
    }

    return {
      command: tokens[0] || "",
      args: tokens.slice(1),
    };
  }

  private static uniqueStrings(values: string[]): string[] {
    const output: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = value.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(value);
    }
    return output;
  }

  private static resolveExecutableCandidates(command: string): string[] {
    const normalized = this.normalizeExecutablePath(command);
    if (!normalized) {
      return [];
    }

    if (this.isAbsolutePath(normalized)) {
      return this.fileExists(normalized) ? [normalized] : [];
    }

    const candidates: string[] = [];
    const pathEntries = this.splitPathEnvironment(
      this.getEnvironmentVariable("PATH"),
    );
    const hasExtension = /\.[A-Za-z0-9]+$/.test(normalized);
    const lowerCommand = normalized.toLowerCase();

    const extensions = Zotero.isWin
      ? hasExtension
        ? [""]
        : this.splitPathEnvironment(this.getEnvironmentVariable("PATHEXT"))
            .filter((ext) => ext.startsWith("."))
            .map((ext) => ext.toLowerCase())
            .concat([".exe", ".cmd", ".bat", ".com"])
      : [""];

    for (const pathEntry of pathEntries) {
      const base = pathEntry.replace(/[\\/]+$/, "");
      if (!base) {
        continue;
      }

      if (hasExtension || !Zotero.isWin) {
        const fullPath = Zotero.isWin
          ? `${base}\\${normalized}`
          : `${base}/${normalized}`;
        if (this.fileExists(fullPath)) {
          candidates.push(fullPath);
        }
        continue;
      }

      for (const ext of extensions) {
        const fullPath = `${base}\\${normalized}${ext}`;
        if (this.fileExists(fullPath)) {
          candidates.push(fullPath);
        }
      }
    }

    if (Zotero.isWin && ["py", "python", "python3"].includes(lowerCommand)) {
      const winDir = this.getEnvironmentVariable("WINDIR") || "C:\\Windows";
      const pyLauncher = `${winDir.replace(/[\\/]+$/, "")}\\py.exe`;
      if (this.fileExists(pyLauncher)) {
        candidates.push(pyLauncher);
      }
    }

    return this.uniqueStrings(candidates);
  }

  private static getPdfRenderCommandSpecs(): Array<{
    command: string;
    prefixArgs: string[];
    standalone: boolean;
  }> {
    const specs: Array<{
      command: string;
      prefixArgs: string[];
      standalone: boolean;
    }> = [];
    const seen = new Set<string>();

    const pushSpec = (
      command: string,
      prefixArgs: string[] = [],
      standalone = false,
    ) => {
      const trimmed = command.trim();
      if (!trimmed) {
        return;
      }
      const key = `${trimmed.toLowerCase()}|${prefixArgs.join(" ")}|${standalone ? "1" : "0"}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      specs.push({ command: trimmed, prefixArgs, standalone });
    };

    const pushResolvedSpecs = (
      command: string,
      prefixArgs: string[] = [],
      standalone = false,
    ) => {
      const resolved = this.resolveExecutableCandidates(command);
      for (const resolvedCommand of resolved) {
        pushSpec(resolvedCommand, prefixArgs, standalone);
      }
    };

    const configuredPrefCommand = this.getPrefString(
      MINERU_PREF_KEYS.pdfRenderCommand,
      "",
    ).trim();
    if (configuredPrefCommand) {
      pushResolvedSpecs(
        configuredPrefCommand,
        [],
        !this.isPythonCommand(configuredPrefCommand),
      );
    }

    const configured = this.getEnvironmentVariable(
      "TRANSLIT_PDF_RENDER_COMMAND",
    );
    if (configured) {
      const parsed = this.parseCommandLine(configured);
      if (parsed?.command) {
        const standalone = !this.isPythonCommand(parsed.command);
        pushResolvedSpecs(parsed.command, parsed.args, standalone);
      }
    }

    pushResolvedSpecs("python");
    pushResolvedSpecs("python3");
    pushResolvedSpecs("py", ["-3"]);
    pushResolvedSpecs("py");

    return specs;
  }

  private static getPdfRenderHelperScriptContent(): string {
    return [
      "import argparse",
      "import os",
      "import sys",
      "",
      "try:",
      "    import fitz",
      "except Exception as error:",
      "    print(f'IMPORT_ERROR:{error}', file=sys.stderr)",
      "    raise",
      "",
      "",
      "def main():",
      "    parser = argparse.ArgumentParser()",
      "    parser.add_argument('--pdf', required=True)",
      "    parser.add_argument('--page', type=int, default=-1)",
      "    parser.add_argument('--scale', type=float, default=2.0)",
      "    parser.add_argument('--out', default='')",
      "    parser.add_argument('--all-pages-dir', default='')",
      "    parser.add_argument('--page-count', action='store_true')",
      "    args = parser.parse_args()",
      "",
      "    doc = fitz.open(args.pdf)",
      "    try:",
      "        if args.page_count:",
      "            print(len(doc))",
      "            return",
      "",
      "        if args.all_pages_dir:",
      "            os.makedirs(args.all_pages_dir, exist_ok=True)",
      "            total = len(doc)",
      "            for idx in range(total):",
      "                page = doc[idx]",
      "                matrix = fitz.Matrix(args.scale, args.scale)",
      "                pix = page.get_pixmap(matrix=matrix, alpha=False)",
      '                out_path = os.path.join(args.all_pages_dir, f"page-{idx + 1:04d}.png")',
      "                pix.save(out_path)",
      "            print(total)",
      "            return",
      "",
      "        if args.page < 0 or args.page >= len(doc):",
      "            raise RuntimeError(f'page out of range: {args.page}')",
      "        if not args.out:",
      "            raise RuntimeError('missing --out for render mode')",
      "",
      "        page = doc[args.page]",
      "        matrix = fitz.Matrix(args.scale, args.scale)",
      "        pix = page.get_pixmap(matrix=matrix, alpha=False)",
      "        pix.save(args.out)",
      "    finally:",
      "        doc.close()",
      "",
      "",
      "if __name__ == '__main__':",
      "    try:",
      "        main()",
      "    except Exception as error:",
      "        print(str(error), file=sys.stderr)",
      "        sys.exit(1)",
      "",
    ].join("\n");
  }

  private static async ensurePdfRenderHelperScriptPath(): Promise<string> {
    if (this.pdfRenderHelperScriptPath) {
      try {
        const existing = Zotero.File.pathToFile(this.pdfRenderHelperScriptPath);
        if (existing.exists() && existing.isFile()) {
          return this.pdfRenderHelperScriptPath;
        }
      } catch (_error) {
        // Continue to recreate helper script.
      }
    }

    const scriptFile = Zotero.getTempDirectory();
    scriptFile.append(
      `${config.addonRef}-pdf-render-helper-${PDF_RENDER_HELPER_VERSION}.py`,
    );
    await Zotero.File.putContentsAsync(
      scriptFile,
      this.getPdfRenderHelperScriptContent(),
      "utf-8",
    );
    this.pdfRenderHelperScriptPath = scriptFile.path;
    return scriptFile.path;
  }

  private static async renderPdfPageImageWithExternalCommand(
    pdfPath: string,
    pageIdx: number,
    scale: number,
    preferredOutputPath = "",
  ): Promise<string> {
    const commandSpecs = this.getPdfRenderCommandSpecs();
    if (!commandSpecs.length) {
      throw new Error(
        "no runnable PDF renderer command found (configure MinerU PDF renderer executable path in preferences or set TRANSLIT_PDF_RENDER_COMMAND)",
      );
    }

    const helperScriptPath = await this.ensurePdfRenderHelperScriptPath();

    const outputFile = preferredOutputPath
      ? Zotero.File.pathToFile(preferredOutputPath)
      : Zotero.getTempDirectory();
    if (!preferredOutputPath) {
      outputFile.append(
        `${config.addonRef}-pdf-page-${Date.now()}-${Math.floor(Math.random() * 10000)}.png`,
      );
    }

    const errors: string[] = [];
    for (const spec of commandSpecs) {
      await Zotero.File.removeIfExists(outputFile.path);

      const commandArgs = spec.standalone
        ? [
            ...spec.prefixArgs,
            "--pdf",
            pdfPath,
            "--page",
            String(pageIdx),
            "--scale",
            String(scale),
            "--out",
            outputFile.path,
          ]
        : [
            ...spec.prefixArgs,
            helperScriptPath,
            "--pdf",
            pdfPath,
            "--page",
            String(pageIdx),
            "--scale",
            String(scale),
            "--out",
            outputFile.path,
          ];

      try {
        const result = await Zotero.Utilities.Internal.exec(
          spec.command,
          commandArgs,
        );
        if (result !== true) {
          errors.push(
            `${spec.command} ${commandArgs.join(" ")} => ${this.stringifyUnknownValue(result)}`,
          );
          continue;
        }

        if (
          outputFile.exists() &&
          outputFile.isFile() &&
          outputFile.fileSize > 0
        ) {
          return outputFile.path;
        }

        errors.push(
          `${spec.command} ${commandArgs.join(" ")} => output file missing`,
        );
      } catch (error) {
        errors.push(
          `${spec.command} ${commandArgs.join(" ")} => ${this.getErrorMessage(error)}`,
        );
      }
    }

    await Zotero.File.removeIfExists(outputFile.path);
    throw new Error(errors.join(" | "));
  }

  private static getExecOutputText(result: unknown): string {
    if (typeof result === "string") {
      return result.trim();
    }
    const resultAny = result as any;
    return String(
      resultAny?.stdout || resultAny?.output || resultAny?.responseText || "",
    ).trim();
  }

  private static async renderAllPdfPagesWithExternalCommand(
    pdfPath: string,
    scale: number,
    outputDirPath: string,
  ): Promise<number> {
    const commandSpecs = this.getPdfRenderCommandSpecs();
    if (!commandSpecs.length) {
      throw new Error(
        "no runnable PDF renderer command found (configure MinerU PDF renderer executable path in preferences or set TRANSLIT_PDF_RENDER_COMMAND)",
      );
    }

    const helperScriptPath = await this.ensurePdfRenderHelperScriptPath();
    const errors: string[] = [];

    for (const spec of commandSpecs) {
      const commandArgs = spec.standalone
        ? [
            ...spec.prefixArgs,
            "--pdf",
            pdfPath,
            "--scale",
            String(scale),
            "--all-pages-dir",
            outputDirPath,
          ]
        : [
            ...spec.prefixArgs,
            helperScriptPath,
            "--pdf",
            pdfPath,
            "--scale",
            String(scale),
            "--all-pages-dir",
            outputDirPath,
          ];

      try {
        const result = await Zotero.Utilities.Internal.exec(
          spec.command,
          commandArgs,
        );

        const text = this.getExecOutputText(result);
        const parsedCount = Number(text);
        if (Number.isInteger(parsedCount) && parsedCount > 0) {
          return parsedCount;
        }

        if (result === true) {
          return 0;
        }

        errors.push(
          `${spec.command} ${commandArgs.join(" ")} => ${this.stringifyUnknownValue(result)}`,
        );
      } catch (error) {
        errors.push(
          `${spec.command} ${commandArgs.join(" ")} => ${this.getErrorMessage(error)}`,
        );
      }
    }

    throw new Error(errors.join(" | "));
  }

  private static listRenderedPageFiles(
    dirPath: string,
  ): Array<{ pageIdx: number; filePath: string }> {
    const dir = Zotero.File.pathToFile(dirPath);
    if (!dir.exists() || !dir.isDirectory()) {
      return [];
    }

    const files: Array<{ pageIdx: number; filePath: string }> = [];
    const entries = dir.directoryEntries as nsISimpleEnumerator;
    while (entries.hasMoreElements()) {
      const next = entries.getNext() as any;
      const file =
        typeof next?.QueryInterface === "function"
          ? (next.QueryInterface(Components.interfaces.nsIFile) as nsIFile)
          : (next as nsIFile);
      if (!file) {
        continue;
      }

      const exists =
        typeof (file as any).exists === "function"
          ? (file as any).exists()
          : Boolean((file as any).exists);
      const isFile =
        typeof (file as any).isFile === "function"
          ? (file as any).isFile()
          : Boolean((file as any).isFile);

      if (!exists || !isFile) {
        continue;
      }

      const leafName = (file.leafName || "").toLowerCase();
      const match = leafName.match(/^page-(\d+)\.png$/);
      if (!match?.[1]) {
        continue;
      }

      const pageNumber = Number(match[1]);
      if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
        continue;
      }

      files.push({
        pageIdx: pageNumber - 1,
        filePath: file.path,
      });
    }

    return files.sort((a, b) => a.pageIdx - b.pageIdx);
  }

  private static getPageCountFromVisualEntries(
    entries: VisualReviewEntry[],
  ): number {
    let maxPageIdx = -1;
    for (const entry of entries) {
      if (typeof entry.pageIdx !== "number" || entry.pageIdx < 0) {
        continue;
      }
      maxPageIdx = Math.max(maxPageIdx, entry.pageIdx);
    }
    return maxPageIdx >= 0 ? maxPageIdx + 1 : 0;
  }

  private static async preRenderAllPages(
    renderSession: PdfRenderSession,
    pageCount: number,
    scale: number,
    onProgress: (done: number, total: number) => void,
  ): Promise<PreRenderedPagesResult> {
    const pageImageURIByIdx = new Map<number, string>();
    const tempDir = Zotero.getTempDirectory();
    tempDir.append(`${config.addonRef}-pdf-pages-${Date.now()}`);
    Zotero.File.createDirectoryIfMissing(tempDir.path);

    try {
      onProgress(0, pageCount);
      await this.renderAllPdfPagesWithExternalCommand(
        renderSession.pdfPath,
        scale,
        tempDir.path,
      );

      const renderedFiles = this.listRenderedPageFiles(tempDir.path);
      const total = renderedFiles.length || pageCount;

      if (!renderedFiles.length) {
        throw new Error(
          getString("mineru-review-crop-pre-render-empty" as any),
        );
      }

      for (let idx = 0; idx < renderedFiles.length; idx += 1) {
        const renderedFile = renderedFiles[idx];
        if (!renderedFile) {
          continue;
        }
        onProgress(idx + 1, total);
        pageImageURIByIdx.set(
          renderedFile.pageIdx,
          Zotero.File.pathToFileURI(renderedFile.filePath),
        );
      }

      return {
        pageImageURIByIdx,
        tempDirPath: tempDir.path,
      };
    } catch (error) {
      this.removeDirectoryIfExists(tempDir.path);
      throw error;
    }
  }

  private static getRenderSessionPageCount(
    renderSession: PdfRenderSession,
  ): number | null {
    if (
      Number.isInteger(renderSession.pageCountHint) &&
      (renderSession.pageCountHint || 0) > 0
    ) {
      return renderSession.pageCountHint as number;
    }

    const pdfDocument =
      renderSession.pdfDocument ||
      this.getPdfDocumentFromReader(renderSession.reader);
    const numPages = Number(pdfDocument?.numPages);
    if (Number.isInteger(numPages) && numPages > 0) {
      return numPages;
    }

    const primaryView = renderSession.reader?._internalReader?._primaryView;
    const candidates = [
      primaryView?._pages,
      primaryView?.pages,
      primaryView?.layer?.pages,
    ];
    for (const list of candidates) {
      if (Array.isArray(list) && list.length > 0) {
        return list.length;
      }
    }

    return null;
  }

  private static buildVisualReviewEntries(
    manifest: MinerUManifest,
  ): VisualReviewEntry[] {
    const figureEntries = manifest.figures
      .map((figure, index) => ({
        key: `figure:${index}:${figure.number}:${figure.image_path}`,
        kind: "figure" as const,
        index,
        number: figure.number,
        pageIdx: figure.page_idx,
        imagePath: figure.image_path,
        captionZh: figure.caption_zh,
        captionEn: figure.caption_en,
        bbox: figure.bbox,
      }))
      .sort((a, b) => a.number - b.number);

    const tableEntries = manifest.tables
      .map((table, index) => ({
        key: `table:${index}:${table.number}:${table.image_path}`,
        kind: "table" as const,
        index,
        number: table.number,
        pageIdx: table.page_idx,
        imagePath: table.image_path,
        captionZh: table.caption_zh,
        captionEn: table.caption_en,
        bbox: table.bbox,
      }))
      .sort((a, b) => a.number - b.number);

    return [...figureEntries, ...tableEntries];
  }

  private static withUpdatedVisualCounts(
    manifest: MinerUManifest,
    figures: MinerUManifestFigure[],
    tables: MinerUManifestTable[],
  ): MinerUManifest {
    return {
      ...manifest,
      figures,
      tables,
      stats: {
        ...manifest.stats,
        figure_count: figures.length,
        table_count: tables.length,
      },
    };
  }

  private static compareReviewEntryByPage(
    a: VisualReviewEntry,
    b: VisualReviewEntry,
  ): number {
    const pageA =
      typeof a.pageIdx === "number" && a.pageIdx >= 0
        ? a.pageIdx
        : Number.MAX_SAFE_INTEGER;
    const pageB =
      typeof b.pageIdx === "number" && b.pageIdx >= 0
        ? b.pageIdx
        : Number.MAX_SAFE_INTEGER;
    if (pageA !== pageB) {
      return pageA - pageB;
    }
    if (a.kind !== b.kind) {
      return a.kind === "figure" ? -1 : 1;
    }
    if (a.number !== b.number) {
      return a.number - b.number;
    }
    return a.index - b.index;
  }

  private static sortVisualReviewEntriesByPage(
    entries: VisualReviewEntry[],
  ): VisualReviewEntry[] {
    return entries.slice().sort((a, b) => this.compareReviewEntryByPage(a, b));
  }

  private static sortManifestVisualsByPage<
    T extends { page_idx: number | null; number: number },
  >(entries: T[]): T[] {
    return entries.slice().sort((a, b) => {
      const pageA =
        typeof a.page_idx === "number" && a.page_idx >= 0
          ? a.page_idx
          : Number.MAX_SAFE_INTEGER;
      const pageB =
        typeof b.page_idx === "number" && b.page_idx >= 0
          ? b.page_idx
          : Number.MAX_SAFE_INTEGER;
      if (pageA !== pageB) {
        return pageA - pageB;
      }
      return a.number - b.number;
    });
  }

  private static summarizeVisualEntry(entry: VisualReviewEntry): string {
    const pageText =
      entry.pageIdx === null || entry.pageIdx < 0
        ? "p-"
        : `p${entry.pageIdx + 1}`;
    const text = (entry.captionZh || entry.captionEn || "")
      .replace(/\s+/g, " ")
      .trim();
    const shortText =
      text.length > 80 ? `${text.slice(0, 77).trimEnd()}...` : text;
    const prefix = entry.kind === "figure" ? "F" : "T";
    return `${prefix} ${entry.number} · ${pageText}${shortText ? ` · ${shortText}` : ""}`;
  }

  private static async openVisualCountReviewDialog(
    itemTitle: string,
    figureEntries: VisualReviewEntry[],
    tableEntries: VisualReviewEntry[],
    expectedFigureCount: number,
    expectedTableCount: number,
    imageURIMap: Map<string, string>,
  ): Promise<VisualCountReviewResult> {
    const figureMismatch = figureEntries.length !== expectedFigureCount;
    const tableMismatch = tableEntries.length !== expectedTableCount;

    const sortedFigureEntries =
      this.sortVisualReviewEntriesByPage(figureEntries);
    const sortedTableEntries = this.sortVisualReviewEntriesByPage(tableEntries);

    const allFigureIndexes = new Set<number>(
      figureEntries.map((entry) => entry.index),
    );
    const allTableIndexes = new Set<number>(
      tableEntries.map((entry) => entry.index),
    );

    if (!figureMismatch && !tableMismatch) {
      return {
        selectedFigureIndexes: allFigureIndexes,
        selectedTableIndexes: allTableIndexes,
        confirmed: false,
      };
    }

    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const selectedFigureIndexes = new Set<number>(allFigureIndexes);
    const selectedTableIndexes = new Set<number>(allTableIndexes);

    const dialogHelper = new ztoolkit.Dialog(3, 1)
      .addCell(0, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-count-review-meta",
        styles: {
          margin: "0 0 4px 0",
          fontSize: "12px",
          color: "#4b5563",
        },
      })
      .addCell(1, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-count-review-hint",
        styles: {
          margin: "0 0 8px 0",
          fontSize: "12px",
          color: "#111827",
          fontWeight: "600",
        },
      })
      .addCell(2, 0, {
        tag: "div",
        namespace: "html",
        id: "zotero-mineru-count-review-toolbar",
        styles: {
          margin: "0 0 8px 0",
          fontSize: "11px",
          color: "#6b7280",
        },
      })
      .addCell(3, 0, {
        tag: "div",
        namespace: "html",
        id: "zotero-mineru-count-review-list",
        styles: {
          width: "100%",
          maxHeight: "440px",
          overflowY: "auto",
          border: "1px solid #d1d5db",
          borderRadius: "4px",
          padding: "8px",
          background: "#fff",
        },
      })
      .addCell(4, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-count-review-item",
        styles: {
          margin: "8px 0 0 0",
          fontSize: "11px",
          color: "#6b7280",
        },
      })
      .addButton(
        getString("mineru-review-button-select-all" as any),
        "keep-all",
        {
          noClose: true,
          callback: () => {
            const doc = dialogHelper.window?.document;
            if (!doc) {
              return;
            }
            const inputs = doc.querySelectorAll(
              "input[data-mineru-keep='1']",
            ) as NodeListOf<HTMLInputElement>;
            for (const input of inputs) {
              input.checked = true;
            }
          },
        },
      )
      .addButton(getString("mineru-review-button-invert" as any), "invert", {
        noClose: true,
        callback: () => {
          const doc = dialogHelper.window?.document;
          if (!doc) {
            return;
          }
          const inputs = doc.querySelectorAll(
            "input[data-mineru-keep='1']",
          ) as NodeListOf<HTMLInputElement>;
          for (const input of inputs) {
            input.checked = !input.checked;
          }
        },
      })
      .addButton(getString("mineru-review-button-apply" as any), "confirm", {
        callback: () => {
          const doc = dialogHelper.window?.document;
          if (!doc) {
            return;
          }

          if (figureMismatch) {
            selectedFigureIndexes.clear();
          }
          if (tableMismatch) {
            selectedTableIndexes.clear();
          }

          const inputs = doc.querySelectorAll(
            "input[data-mineru-keep='1']",
          ) as NodeListOf<HTMLInputElement>;
          for (const input of inputs) {
            if (!input.checked) {
              continue;
            }
            const kind = input.getAttribute("data-kind") || "";
            const rawIndex = Number(input.getAttribute("data-index") || "");
            if (!Number.isInteger(rawIndex) || rawIndex < 0) {
              continue;
            }
            if (kind === "figure") {
              selectedFigureIndexes.add(rawIndex);
            } else if (kind === "table") {
              selectedTableIndexes.add(rawIndex);
            }
          }
        },
      })
      .addButton(getString("mineru-review-button-skip" as any), "cancel");

    const appendSection = (
      doc: Document,
      container: HTMLDivElement,
      title: string,
      entries: VisualReviewEntry[],
    ) => {
      const section = doc.createElement("section");
      section.style.marginBottom = "10px";

      const heading = doc.createElement("p");
      heading.textContent = title;
      heading.style.margin = "0 0 6px 0";
      heading.style.fontWeight = "700";
      heading.style.fontSize = "12px";
      section.appendChild(heading);

      if (!entries.length) {
        const empty = doc.createElement("p");
        empty.textContent = getString("mineru-review-count-empty" as any);
        empty.style.margin = "0 0 6px 0";
        empty.style.fontSize = "12px";
        empty.style.color = "#6b7280";
        section.appendChild(empty);
        container.appendChild(section);
        return;
      }

      for (const entry of entries) {
        const row = doc.createElement("label");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.margin = "6px 0";
        row.style.padding = "6px";
        row.style.border = "1px solid #e5e7eb";
        row.style.borderRadius = "4px";
        row.style.background = "#fcfcfd";
        row.style.cursor = "pointer";

        const input = doc.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        input.setAttribute("data-mineru-keep", "1");
        input.setAttribute("data-kind", entry.kind);
        input.setAttribute("data-index", String(entry.index));
        input.style.margin = "0 2px 0 0";

        const preview = doc.createElement("img");
        preview.src = imageURIMap.get(entry.imagePath) || "";
        preview.alt = `${entry.kind}-${entry.number}`;
        preview.style.width = "96px";
        preview.style.height = "72px";
        preview.style.objectFit = "contain";
        preview.style.background = "#ffffff";
        preview.style.border = "1px solid #d1d5db";
        preview.style.borderRadius = "3px";
        if (!preview.src) {
          preview.style.display = "none";
        }

        const textWrap = doc.createElement("div");
        textWrap.style.flex = "1";

        const text = doc.createElement("div");
        text.textContent = this.summarizeVisualEntry(entry);
        text.style.fontSize = "12px";
        text.style.lineHeight = "1.35";

        const path = doc.createElement("div");
        path.textContent = entry.imagePath || "-";
        path.style.fontSize = "10px";
        path.style.color = "#6b7280";
        path.style.marginTop = "2px";

        textWrap.appendChild(text);
        textWrap.appendChild(path);

        row.appendChild(input);
        if (preview.src) {
          row.appendChild(preview);
        }
        row.appendChild(textWrap);
        section.appendChild(row);
      }

      container.appendChild(section);
    };

    const dialogData = {
      loadCallback: () => {
        const doc = dialogHelper.window?.document;
        if (!doc) {
          return;
        }

        const metaNode = doc.querySelector(
          "#zotero-mineru-count-review-meta",
        ) as HTMLParagraphElement | null;
        const hintNode = doc.querySelector(
          "#zotero-mineru-count-review-hint",
        ) as HTMLParagraphElement | null;
        const toolbarNode = doc.querySelector(
          "#zotero-mineru-count-review-toolbar",
        ) as HTMLDivElement | null;
        const listNode = doc.querySelector(
          "#zotero-mineru-count-review-list",
        ) as HTMLDivElement | null;
        const itemNode = doc.querySelector(
          "#zotero-mineru-count-review-item",
        ) as HTMLParagraphElement | null;

        if (!metaNode || !hintNode || !toolbarNode || !listNode || !itemNode) {
          return;
        }

        metaNode.textContent = getString("mineru-review-count-meta" as any, {
          args: {
            expectedFigures: expectedFigureCount,
            expectedTables: expectedTableCount,
            currentFigures: figureEntries.length,
            currentTables: tableEntries.length,
          },
        });
        hintNode.textContent = getString("mineru-review-count-hint" as any);
        toolbarNode.textContent = getString(
          "mineru-review-count-sorted-by-page" as any,
        );
        itemNode.textContent = `${itemTitle}`;

        while (listNode.firstChild) {
          listNode.removeChild(listNode.firstChild);
        }

        if (figureMismatch) {
          appendSection(
            doc,
            listNode,
            getString("mineru-review-count-figure-section" as any),
            sortedFigureEntries,
          );
        }
        if (tableMismatch) {
          appendSection(
            doc,
            listNode,
            getString("mineru-review-count-table-section" as any),
            sortedTableEntries,
          );
        }
      },
      unloadCallback: () => {
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
        resolveClosed?.();
      },
    };

    dialogHelper
      .setDialogData(dialogData)
      .open(getString("mineru-review-count-title" as any), {
        width: 760,
        height: 640,
        centerscreen: true,
        resizable: true,
        fitContent: false,
        noDialogMode: true,
      });

    addon.data.dialog = dialogHelper;
    await closedPromise;

    const buttonID = (dialogData as { _lastButtonId?: string })._lastButtonId;
    return {
      selectedFigureIndexes,
      selectedTableIndexes,
      confirmed: buttonID === "confirm",
    };
  }

  private static async reviewVisualCountMismatch(
    itemTitle: string,
    manifest: MinerUManifest,
    captionIndex: ZhCaptionIndex,
    zipFile: nsIFile,
  ): Promise<MinerUManifest> {
    const expectedFigureCount = captionIndex.figureCaptions.size;
    const expectedTableCount = captionIndex.tableCaptions.size;

    const figureEntries = this.buildVisualReviewEntries(manifest).filter(
      (entry) => entry.kind === "figure",
    );
    const tableEntries = this.buildVisualReviewEntries(manifest).filter(
      (entry) => entry.kind === "table",
    );

    const figureMismatch = figureEntries.length !== expectedFigureCount;
    const tableMismatch = tableEntries.length !== expectedTableCount;
    if (!figureMismatch && !tableMismatch) {
      return manifest;
    }

    const extractionResult = this.extractViewerImageURIMap(zipFile, manifest);
    try {
      const reviewResult = await this.openVisualCountReviewDialog(
        itemTitle,
        figureEntries,
        tableEntries,
        expectedFigureCount,
        expectedTableCount,
        extractionResult.imageURIMap,
      );

      if (!reviewResult.confirmed) {
        return manifest;
      }

      const nextFigures = figureMismatch
        ? manifest.figures.filter((_figure, index) => {
            return reviewResult.selectedFigureIndexes.has(index);
          })
        : manifest.figures;
      const nextTables = tableMismatch
        ? manifest.tables.filter((_table, index) => {
            return reviewResult.selectedTableIndexes.has(index);
          })
        : manifest.tables;

      return this.withUpdatedVisualCounts(
        manifest,
        this.sortManifestVisualsByPage(nextFigures),
        this.sortManifestVisualsByPage(nextTables),
      );
    } finally {
      this.removeDirectoryIfExists(extractionResult.tempDirPath);
    }
  }

  private static async openPdfRenderSession(
    attachment: Zotero.Item,
  ): Promise<PdfRenderSession> {
    const pdfPath = await attachment.getFilePathAsync();
    if (!pdfPath || typeof pdfPath !== "string") {
      throw new Error("failed to locate PDF file for crop review");
    }
    const pageCountHint = Number(attachment.getField("numPages"));

    return {
      pdfPath,
      pageCountHint:
        Number.isInteger(pageCountHint) && pageCountHint > 0
          ? pageCountHint
          : null,
      pdfDocument: null,
      reader: null,
      close: () => {
        // External renderer session has no in-app reader handle.
      },
    };
  }

  private static async renderPdfPageToCanvas(
    renderSession: PdfRenderSession,
    pageIdx: number,
    scale = 1.8,
  ): Promise<HTMLCanvasElement> {
    const readerCanvas = renderSession.reader
      ? await this.getCanvasFromReaderView(renderSession.reader, pageIdx)
      : null;
    if (readerCanvas) {
      return readerCanvas;
    }

    const pdfDocument =
      renderSession.pdfDocument ||
      this.getPdfDocumentFromReader(renderSession.reader);
    if (!pdfDocument || typeof pdfDocument.getPage !== "function") {
      const hasPdfDocument = !!pdfDocument;
      const pdfType = hasPdfDocument
        ? Object.prototype.toString.call(pdfDocument)
        : "null";
      throw new Error(
        `pdf document does not support page rendering (hasPdfDocument=${hasPdfDocument}, type=${pdfType})`,
      );
    }

    const rawPage = await pdfDocument.getPage(pageIdx + 1);
    const pageCandidates = [
      rawPage,
      rawPage?.originalPage,
      rawPage?.page,
      rawPage?._page,
      rawPage?.pdfPage,
    ];
    const page = pageCandidates.find(
      (candidate) =>
        candidate &&
        (typeof candidate.getViewport === "function" ||
          typeof candidate.render === "function"),
    );
    if (!page) {
      throw new Error("pdf page object does not expose rendering interface");
    }

    let viewport: any;
    if (typeof page.getViewport === "function") {
      try {
        viewport = page.getViewport({ scale });
      } catch (_error) {
        try {
          viewport = page.getViewport(scale);
        } catch (_error2) {
          viewport = page.getViewport();
        }
      }
    } else {
      viewport = page.viewport || rawPage?.viewport || null;
    }
    if (
      !viewport ||
      typeof viewport.width !== "number" ||
      typeof viewport.height !== "number"
    ) {
      throw new Error("pdf page viewport is unavailable");
    }

    const hostDoc = Zotero.getMainWindow().document;
    const canvas = this.createHtmlCanvas(hostDoc);

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) {
      throw new Error("failed to create canvas context for crop review");
    }

    const renderTarget =
      page && typeof page.render === "function"
        ? page
        : rawPage && typeof rawPage.render === "function"
          ? rawPage
          : null;
    if (!renderTarget) {
      throw new Error("pdf page object does not expose render");
    }

    const renderTask = renderTarget.render({
      canvasContext: context,
      viewport,
    });
    if (renderTask?.promise) {
      await renderTask.promise;
    } else {
      await renderTask;
    }
    return canvas;
  }

  private static normalizeCropRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    height: number,
  ): CropRect | null {
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(width, Math.max(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const bottom = Math.min(height, Math.max(y0, y1));

    const normalizedWidth = Math.floor(right - left);
    const normalizedHeight = Math.floor(bottom - top);
    if (normalizedWidth < 6 || normalizedHeight < 6) {
      return null;
    }

    return {
      x: Math.floor(left),
      y: Math.floor(top),
      width: normalizedWidth,
      height: normalizedHeight,
    };
  }

  private static async openVisualCropReviewDialog(
    itemTitle: string,
    entries: VisualReviewEntry[],
    imageURIMap: Map<string, string>,
    renderSession: PdfRenderSession,
  ): Promise<Map<string, string> | null> {
    if (!entries.length) {
      return new Map();
    }

    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const pageCanvasCache = new Map<number, HTMLCanvasElement>();
    const preRenderedPageImageURIByIdx = new Map<number, string>();
    const selectedRectMap = new Map<string, CropRect>();
    const manualPageIdxByEntryKey = new Map<string, number>();
    const renderedPageIdxByEntryKey = new Map<string, number>();
    const cropSourceCanvasByEntryKey = new Map<string, HTMLCanvasElement>();
    const pageRenderScale = 1.8;
    let pageCount = this.getRenderSessionPageCount(renderSession);
    let preRenderedTempDirPath = "";

    let currentIndex = 0;
    let currentPageCanvas: HTMLCanvasElement | null = null;
    let renderToken = 0;
    let drawing = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let zoomScale = 1;

    let canvasViewportNode: HTMLDivElement | null = null;
    let pageCanvasNode: HTMLCanvasElement | null = null;
    let overlayCanvasNode: HTMLCanvasElement | null = null;
    let currentImageNode: HTMLImageElement | null = null;
    let statusNode: HTMLParagraphElement | null = null;
    let metaNode: HTMLParagraphElement | null = null;
    let captionNode: HTMLParagraphElement | null = null;

    const dialogHelper = new ztoolkit.Dialog(5, 1)
      .addCell(0, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-crop-review-meta",
        styles: {
          margin: "0 0 6px 0",
          fontSize: "12px",
          color: "#374151",
          fontWeight: "600",
        },
      })
      .addCell(1, 0, {
        tag: "p",
        namespace: "html",
        id: "zotero-mineru-crop-review-status",
        styles: {
          margin: "0 0 8px 0",
          fontSize: "12px",
          color: "#4b5563",
        },
      })
      .addCell(2, 0, {
        tag: "div",
        namespace: "html",
        id: "zotero-mineru-crop-review-main",
        styles: {
          width: "100%",
          display: "flex",
          gap: "8px",
          alignItems: "flex-start",
          marginBottom: "6px",
        },
        children: [
          {
            tag: "div",
            namespace: "html",
            styles: {
              flex: "1 1 auto",
              minWidth: "0",
            },
            children: [
              {
                tag: "div",
                namespace: "html",
                id: "zotero-mineru-crop-review-viewport",
                styles: {
                  maxWidth: "1000px",
                  minWidth: "500px",
                  maxHeight: "500px",
                  minHeight: "400px",
                  overflow: "auto",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  background: "#f8fafc",
                },
                children: [
                  {
                    tag: "div",
                    namespace: "html",
                    id: "zotero-mineru-crop-review-stage",
                    styles: {
                      position: "relative",
                      width: "100%",
                    },
                    children: [
                      {
                        tag: "canvas",
                        namespace: "html",
                        id: "zotero-mineru-crop-review-page",
                        styles: {
                          width: "100%",
                          height: "auto",
                          display: "block",
                          background: "#ffffff",
                        },
                      },
                      {
                        tag: "canvas",
                        namespace: "html",
                        id: "zotero-mineru-crop-review-overlay",
                        styles: {
                          position: "absolute",
                          left: "0",
                          top: "0",
                          width: "100%",
                          height: "auto",
                          display: "block",
                          cursor: "crosshair",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            namespace: "html",
            styles: {
              width: "190px",
              flex: "0 0 190px",
              border: "1px solid #e5e7eb",
              borderRadius: "4px",
              padding: "6px",
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              maxHeight: "240px",
            },
            children: [
              {
                tag: "p",
                namespace: "html",
                id: "zotero-mineru-crop-review-current-label",
                styles: {
                  margin: "0",
                  fontSize: "11px",
                  color: "#6b7280",
                },
              },
              {
                tag: "img",
                namespace: "html",
                id: "zotero-mineru-crop-review-current-image",
                attributes: {
                  src: "",
                  draggable: "false",
                },
                styles: {
                  display: "block",
                  width: "100%",
                  maxHeight: "110px",
                  objectFit: "contain",
                  border: "1px solid #e5e7eb",
                  background: "#f8fafc",
                },
              },
              {
                tag: "p",
                namespace: "html",
                id: "zotero-mineru-crop-review-caption",
                styles: {
                  margin: "0",
                  fontSize: "12px",
                  lineHeight: "1.35",
                  color: "#111827",
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  maxHeight: "96px",
                  overflowY: "auto",
                },
              },
            ],
          },
        ],
      });

    let goPrev = () => {};
    let goNext = () => {};
    let clearCurrent = () => {};
    let zoomOut = () => {};
    let zoomReset = () => {};
    let zoomIn = () => {};
    let pageDown = () => {};
    let pageUp = () => {};

    dialogHelper
      .addButton(
        getString("mineru-review-crop-button-zoom-out" as any),
        "zoom-out",
        {
          noClose: true,
          callback: () => {
            zoomOut();
          },
        },
      )
      .addButton(
        getString("mineru-review-crop-button-zoom-reset" as any),
        "zoom-reset",
        {
          noClose: true,
          callback: () => {
            zoomReset();
          },
        },
      )
      .addButton(
        getString("mineru-review-crop-button-zoom-in" as any),
        "zoom-in",
        {
          noClose: true,
          callback: () => {
            zoomIn();
          },
        },
      )
      .addButton(
        getString("mineru-review-crop-button-page-down" as any),
        "page-down",
        {
          noClose: true,
          callback: () => {
            pageDown();
          },
        },
      )
      .addButton(
        getString("mineru-review-crop-button-page-up" as any),
        "page-up",
        {
          noClose: true,
          callback: () => {
            pageUp();
          },
        },
      )
      .addButton(getString("mineru-review-crop-button-prev" as any), "prev", {
        noClose: true,
        callback: () => {
          goPrev();
        },
      })
      .addButton(getString("mineru-review-crop-button-next" as any), "next", {
        noClose: true,
        callback: () => {
          goNext();
        },
      })
      .addButton(getString("mineru-review-crop-button-clear" as any), "clear", {
        noClose: true,
        callback: () => {
          clearCurrent();
        },
      })
      .addButton(
        getString("mineru-review-crop-button-finish" as any),
        "confirm",
      )
      .addButton(getString("mineru-review-crop-button-skip" as any), "cancel");

    const getCurrentEntry = (): VisualReviewEntry | null => {
      if (!entries.length) {
        return null;
      }
      const clamped = Math.min(entries.length - 1, Math.max(0, currentIndex));
      return entries[clamped] || null;
    };

    const clampPageIdx = (value: number): number => {
      if (pageCount && Number.isInteger(pageCount) && pageCount > 0) {
        return Math.min(pageCount - 1, Math.max(0, value));
      }
      return Math.max(0, value);
    };

    const getEffectivePageIdx = (entry: VisualReviewEntry): number | null => {
      const manualPageIdx = manualPageIdxByEntryKey.get(entry.key);
      const basePageIdx =
        typeof entry.pageIdx === "number" && entry.pageIdx >= 0
          ? entry.pageIdx
          : null;

      if (typeof manualPageIdx === "number" && manualPageIdx >= 0) {
        return clampPageIdx(manualPageIdx);
      }
      if (basePageIdx !== null) {
        return clampPageIdx(basePageIdx);
      }
      return null;
    };

    const applyZoom = () => {
      if (!pageCanvasNode || !overlayCanvasNode) {
        return;
      }
      const scaledWidth = Math.max(
        1,
        Math.floor(pageCanvasNode.width * zoomScale),
      );
      pageCanvasNode.style.width = `${scaledWidth}px`;
      overlayCanvasNode.style.width = `${scaledWidth}px`;
    };

    const clampZoom = (value: number): number => {
      return Math.min(3, Math.max(0.1, Number(value.toFixed(2))));
    };

    const drawOverlay = (rect: CropRect | null) => {
      if (!overlayCanvasNode) {
        return;
      }
      const context = overlayCanvasNode.getContext(
        "2d",
      ) as CanvasRenderingContext2D | null;
      if (!context) {
        return;
      }

      context.clearRect(
        0,
        0,
        overlayCanvasNode.width,
        overlayCanvasNode.height,
      );

      if (!rect) {
        return;
      }

      context.strokeStyle = "#ef4444";
      context.lineWidth = 3;
      context.setLineDash([10, 5]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.fillStyle = "rgba(239, 68, 68, 0.15)";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.setLineDash([]);
    };

    const toCanvasPoint = (
      event: MouseEvent,
    ): { x: number; y: number } | null => {
      if (!overlayCanvasNode) {
        return null;
      }

      const rect = overlayCanvasNode.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }

      const x =
        ((event.clientX - rect.left) * overlayCanvasNode.width) / rect.width;
      const y =
        ((event.clientY - rect.top) * overlayCanvasNode.height) / rect.height;
      return {
        x,
        y,
      };
    };

    const ensurePageCanvas = async (
      pageIdx: number,
    ): Promise<HTMLCanvasElement> => {
      const cached = pageCanvasCache.get(pageIdx);
      if (cached) {
        return cached;
      }

      const preRenderedImageURI =
        preRenderedPageImageURIByIdx.get(pageIdx) || "";
      if (preRenderedImageURI) {
        const preRenderedCanvas = await this.createCanvasFromImageURI(
          preRenderedImageURI,
          Zotero.getMainWindow().document,
        );
        if (preRenderedCanvas) {
          pageCanvasCache.set(pageIdx, preRenderedCanvas);
          return preRenderedCanvas;
        }
      }

      if (!renderSession.reader && !renderSession.pdfDocument) {
        throw new Error(
          getString(
            "mineru-review-crop-pre-render-page-missing" as any,
            {
              args: {
                page: pageIdx + 1,
              },
            } as any,
          ),
        );
      }

      const rendered = await this.renderPdfPageToCanvas(
        renderSession,
        pageIdx,
        pageRenderScale,
      );

      if (!this.isCanvasLikelyBlank(rendered)) {
        let settled = rendered;
        try {
          await Zotero.Promise.delay(240);
          const secondPass = await this.renderPdfPageToCanvas(
            renderSession,
            pageIdx,
            pageRenderScale,
          );
          if (!this.isCanvasLikelyBlank(secondPass)) {
            settled = secondPass;
          }
        } catch (_error) {
          // Keep first pass when stabilization render fails.
        }
        pageCanvasCache.set(pageIdx, settled);
        return settled;
      }

      await Zotero.Promise.delay(220);
      const retried = await this.renderPdfPageToCanvas(
        renderSession,
        pageIdx,
        pageRenderScale,
      );
      if (!this.isCanvasLikelyBlank(retried)) {
        pageCanvasCache.set(pageIdx, retried);
        return retried;
      }

      await this.forceReaderRenderPage(renderSession.reader, pageIdx);
      const forced = await this.renderPdfPageToCanvas(
        renderSession,
        pageIdx,
        pageRenderScale,
      );
      if (!this.isCanvasLikelyBlank(forced)) {
        pageCanvasCache.set(pageIdx, forced);
      }
      return forced;
    };

    const renderEntry = async (targetIndex: number) => {
      if (!entries.length) {
        return;
      }

      currentIndex = Math.min(entries.length - 1, Math.max(0, targetIndex));
      const entry = entries[currentIndex];
      if (!entry) {
        return;
      }

      const captionText = (entry.captionZh || entry.captionEn || "")
        .replace(/\s+/g, " ")
        .trim();
      const kindLabel = entry.kind === "figure" ? "F" : "T";
      const effectivePageIdx = getEffectivePageIdx(entry);
      const hasManualPage = manualPageIdxByEntryKey.has(entry.key);
      const pageText =
        effectivePageIdx === null
          ? "-"
          : `${effectivePageIdx + 1}${hasManualPage ? "*" : ""}`;

      if (metaNode) {
        metaNode.textContent = getString("mineru-review-crop-index" as any, {
          args: {
            index: currentIndex + 1,
            total: entries.length,
            kind: kindLabel,
            number: entry.number,
            page: pageText,
          },
        });
      }
      if (captionNode) {
        captionNode.textContent = getString(
          "mineru-review-crop-caption" as any,
          {
            args: {
              text: captionText || "-",
            },
          },
        );
      }
      if (currentImageNode) {
        currentImageNode.src = imageURIMap.get(entry.imagePath) || "";
      }

      if (!statusNode || !pageCanvasNode || !overlayCanvasNode) {
        return;
      }

      const savedRect = selectedRectMap.get(entry.key) || null;

      if (effectivePageIdx === null) {
        currentPageCanvas = null;
        cropSourceCanvasByEntryKey.delete(entry.key);
        renderedPageIdxByEntryKey.delete(entry.key);
        pageCanvasNode.width = 1;
        pageCanvasNode.height = 1;
        overlayCanvasNode.width = 1;
        overlayCanvasNode.height = 1;
        applyZoom();
        drawOverlay(null);
        statusNode.textContent = getString("mineru-review-crop-no-page" as any);
        return;
      }

      const token = ++renderToken;
      statusNode.textContent = getString(
        "mineru-review-crop-loading-page" as any,
      );

      try {
        const sourceCanvas = await ensurePageCanvas(effectivePageIdx);
        if (token !== renderToken) {
          return;
        }
        renderedPageIdxByEntryKey.set(entry.key, effectivePageIdx);

        if (this.isCanvasLikelyBlank(sourceCanvas)) {
          throw new Error(
            getString(
              "mineru-review-crop-pre-render-page-missing" as any,
              {
                args: {
                  page: effectivePageIdx + 1,
                },
              } as any,
            ),
          );
        }

        const canvasToUse = sourceCanvas;

        currentPageCanvas = canvasToUse;
        cropSourceCanvasByEntryKey.set(entry.key, canvasToUse);
        pageCanvasNode.width = canvasToUse.width;
        pageCanvasNode.height = canvasToUse.height;
        overlayCanvasNode.width = canvasToUse.width;
        overlayCanvasNode.height = canvasToUse.height;
        applyZoom();

        const context = pageCanvasNode.getContext(
          "2d",
        ) as CanvasRenderingContext2D | null;
        if (!context) {
          statusNode.textContent = getString(
            "mineru-review-crop-no-page" as any,
          );
          return;
        }
        context.clearRect(0, 0, pageCanvasNode.width, pageCanvasNode.height);
        context.drawImage(canvasToUse, 0, 0);

        drawOverlay(savedRect);
        if (hasManualPage) {
          statusNode.textContent = getString(
            "mineru-review-crop-help-manual-page" as any,
          );
        } else {
          statusNode.textContent = getString("mineru-review-crop-help" as any);
        }
      } catch (error) {
        currentPageCanvas = null;
        cropSourceCanvasByEntryKey.delete(entry.key);
        renderedPageIdxByEntryKey.delete(entry.key);
        drawOverlay(null);
        statusNode.textContent = this.getErrorMessage(error);
      }
    };

    const prepareAllPages = async () => {
      if (preRenderedPageImageURIByIdx.size > 0) {
        return;
      }

      if (statusNode) {
        statusNode.textContent = getString(
          "mineru-review-crop-pre-render-start" as any,
        );
      }

      const entryPageCount = this.getPageCountFromVisualEntries(entries);
      pageCount = Math.max(pageCount || 0, entryPageCount || 0);

      const preRendered = await this.preRenderAllPages(
        renderSession,
        pageCount,
        pageRenderScale,
        (done, total) => {
          if (statusNode) {
            statusNode.textContent = getString(
              "mineru-review-crop-pre-render-progress" as any,
              {
                args: { done, total },
              } as any,
            );
          }
        },
      );

      preRenderedTempDirPath = preRendered.tempDirPath;
      for (const [pageIdx, imageURI] of preRendered.pageImageURIByIdx) {
        preRenderedPageImageURIByIdx.set(pageIdx, imageURI);
      }

      if (statusNode) {
        statusNode.textContent = getString(
          "mineru-review-crop-pre-render-done" as any,
          {
            args: { count: preRenderedPageImageURIByIdx.size },
          } as any,
        );
      }
    };

    const dialogData = {
      loadCallback: () => {
        const doc = dialogHelper.window?.document;
        if (!doc) {
          return;
        }

        metaNode = doc.querySelector(
          "#zotero-mineru-crop-review-meta",
        ) as HTMLParagraphElement | null;
        statusNode = doc.querySelector(
          "#zotero-mineru-crop-review-status",
        ) as HTMLParagraphElement | null;
        captionNode = doc.querySelector(
          "#zotero-mineru-crop-review-caption",
        ) as HTMLParagraphElement | null;
        currentImageNode = doc.querySelector(
          "#zotero-mineru-crop-review-current-image",
        ) as HTMLImageElement | null;
        canvasViewportNode = doc.querySelector(
          "#zotero-mineru-crop-review-viewport",
        ) as HTMLDivElement | null;
        pageCanvasNode = doc.querySelector(
          "#zotero-mineru-crop-review-page",
        ) as HTMLCanvasElement | null;
        overlayCanvasNode = doc.querySelector(
          "#zotero-mineru-crop-review-overlay",
        ) as HTMLCanvasElement | null;

        const currentLabelNode = doc.querySelector(
          "#zotero-mineru-crop-review-current-label",
        ) as HTMLParagraphElement | null;
        if (currentLabelNode) {
          currentLabelNode.textContent = getString(
            "mineru-review-crop-current-image" as any,
          );
        }

        if (
          !metaNode ||
          !statusNode ||
          !captionNode ||
          !currentImageNode ||
          !canvasViewportNode ||
          !pageCanvasNode ||
          !overlayCanvasNode
        ) {
          return;
        }

        goPrev = () => {
          void renderEntry(currentIndex - 1);
        };
        goNext = () => {
          void renderEntry(currentIndex + 1);
        };
        clearCurrent = () => {
          const entry = getCurrentEntry();
          if (!entry) {
            return;
          }
          selectedRectMap.delete(entry.key);
          drawOverlay(null);
        };
        zoomOut = () => {
          zoomScale = clampZoom(zoomScale - 0.2);
          applyZoom();
        };
        zoomReset = () => {
          zoomScale = 1;
          applyZoom();
        };
        zoomIn = () => {
          zoomScale = clampZoom(zoomScale + 0.2);
          applyZoom();
        };
        pageDown = () => {
          const entry = getCurrentEntry();
          if (!entry) {
            return;
          }
          const currentPageIdx = getEffectivePageIdx(entry);
          const basePageIdx = currentPageIdx ?? 0;
          manualPageIdxByEntryKey.set(entry.key, clampPageIdx(basePageIdx - 1));
          void renderEntry(currentIndex);
        };
        pageUp = () => {
          const entry = getCurrentEntry();
          if (!entry) {
            return;
          }
          const currentPageIdx = getEffectivePageIdx(entry);
          const basePageIdx = currentPageIdx ?? 0;
          manualPageIdxByEntryKey.set(entry.key, clampPageIdx(basePageIdx + 1));
          void renderEntry(currentIndex);
        };

        canvasViewportNode.addEventListener(
          "wheel",
          (event: WheelEvent) => {
            if (!event.ctrlKey) {
              return;
            }
            event.preventDefault();
            const delta = event.deltaY < 0 ? 0.15 : -0.15;
            zoomScale = clampZoom(zoomScale + delta);
            applyZoom();
          },
          { passive: false },
        );

        overlayCanvasNode.addEventListener("mousedown", (event: MouseEvent) => {
          const overlay = overlayCanvasNode;
          const entry = getCurrentEntry();
          if (!entry || !currentPageCanvas || !overlay) {
            return;
          }

          const point = toCanvasPoint(event);
          if (!point) {
            return;
          }

          drawing = true;
          dragStartX = point.x;
          dragStartY = point.y;
          const initialRect = this.normalizeCropRect(
            dragStartX,
            dragStartY,
            dragStartX,
            dragStartY,
            overlay.width,
            overlay.height,
          );
          if (initialRect) {
            drawOverlay(initialRect);
          } else {
            drawOverlay(null);
          }

          event.preventDefault();
        });

        overlayCanvasNode.addEventListener("mousemove", (event: MouseEvent) => {
          const overlay = overlayCanvasNode;
          if (!drawing || !overlay) {
            return;
          }
          const point = toCanvasPoint(event);
          if (!point) {
            return;
          }

          const rect = this.normalizeCropRect(
            dragStartX,
            dragStartY,
            point.x,
            point.y,
            overlay.width,
            overlay.height,
          );
          drawOverlay(rect);
        });

        const finalizeDraw = (event: MouseEvent) => {
          const overlay = overlayCanvasNode;
          if (!drawing || !overlay) {
            return;
          }

          drawing = false;
          const entry = getCurrentEntry();
          if (!entry) {
            drawOverlay(null);
            return;
          }

          const point = toCanvasPoint(event);
          if (!point) {
            drawOverlay(selectedRectMap.get(entry.key) || null);
            return;
          }

          const rect = this.normalizeCropRect(
            dragStartX,
            dragStartY,
            point.x,
            point.y,
            overlay.width,
            overlay.height,
          );
          if (!rect) {
            selectedRectMap.delete(entry.key);
            drawOverlay(null);
            return;
          }

          selectedRectMap.set(entry.key, rect);
          drawOverlay(rect);
        };

        overlayCanvasNode.addEventListener("mouseup", finalizeDraw);
        overlayCanvasNode.addEventListener(
          "mouseleave",
          (event: MouseEvent) => {
            finalizeDraw(event);
          },
        );

        if (metaNode) {
          metaNode.textContent = itemTitle;
        }

        void (async () => {
          let preRenderReady = true;
          try {
            await prepareAllPages();
          } catch (error) {
            preRenderReady = false;
            if (statusNode) {
              statusNode.textContent = this.getErrorMessage(error);
            }
          }

          if (!preRenderReady) {
            return;
          }

          await renderEntry(0);
        })();
      },
      unloadCallback: () => {
        this.removeDirectoryIfExists(preRenderedTempDirPath);
        if (addon.data.dialog === dialogHelper) {
          addon.data.dialog = undefined;
        }
        resolveClosed?.();
      },
    };

    dialogHelper
      .setDialogData(dialogData)
      .open(getString("mineru-review-crop-title" as any), {
        width: 860,
        height: 430,
        centerscreen: true,
        resizable: true,
        fitContent: false,
        noDialogMode: true,
      });

    addon.data.dialog = dialogHelper;
    await closedPromise;

    const buttonID = (dialogData as { _lastButtonId?: string })._lastButtonId;
    if (buttonID !== "confirm") {
      return null;
    }

    const dataURLMap = new Map<string, string>();
    for (const entry of entries) {
      const selectedRect = selectedRectMap.get(entry.key);
      if (!selectedRect) {
        continue;
      }

      const renderedPageIdx = renderedPageIdxByEntryKey.get(entry.key);
      const sourcePageIdx =
        typeof renderedPageIdx === "number"
          ? renderedPageIdx
          : getEffectivePageIdx(entry);
      const sourceCanvas =
        cropSourceCanvasByEntryKey.get(entry.key) ||
        (sourcePageIdx === null ? null : pageCanvasCache.get(sourcePageIdx));
      if (!sourceCanvas) {
        continue;
      }

      const x = Math.max(0, Math.min(selectedRect.x, sourceCanvas.width - 1));
      const y = Math.max(0, Math.min(selectedRect.y, sourceCanvas.height - 1));
      const width = Math.max(
        1,
        Math.min(selectedRect.width, sourceCanvas.width - x),
      );
      const height = Math.max(
        1,
        Math.min(selectedRect.height, sourceCanvas.height - y),
      );

      const cropCanvas = this.createHtmlCanvas(
        sourceCanvas.ownerDocument || Zotero.getMainWindow().document,
      );
      cropCanvas.width = width;
      cropCanvas.height = height;
      const cropContext = cropCanvas.getContext(
        "2d",
      ) as CanvasRenderingContext2D | null;
      if (!cropContext) {
        continue;
      }

      cropContext.drawImage(
        sourceCanvas,
        x,
        y,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      dataURLMap.set(entry.imagePath, cropCanvas.toDataURL("image/png"));
    }

    return dataURLMap;
  }

  private static async reviewVisualCropAdjustments(
    item: Zotero.Item,
    manifest: MinerUManifest,
    zipFile: nsIFile,
  ): Promise<Map<string, string>> {
    const entries = this.buildVisualReviewEntries(manifest);
    if (!entries.length) {
      return new Map();
    }

    const preferredPdfFileName = String(manifest.mineru.file_name || "").trim();
    const pdfAttachment = await this.getPdfAttachment(
      item,
      preferredPdfFileName,
    );
    if (!pdfAttachment) {
      return new Map();
    }

    const { imageURIMap, tempDirPath } = this.extractViewerImageURIMap(
      zipFile,
      manifest,
    );

    let renderSession: PdfRenderSession | null = null;
    try {
      renderSession = await this.openPdfRenderSession(pdfAttachment);
      const result = await this.openVisualCropReviewDialog(
        item.getDisplayTitle() || item.key,
        entries,
        imageURIMap,
        renderSession,
      );
      return result || new Map();
    } finally {
      renderSession?.close();
      this.removeDirectoryIfExists(tempDirPath);
    }
  }

  private static decodeBase64DataURL(dataURL: string): {
    extension: string;
    binary: string;
  } {
    const match = dataURL.match(/^data:([^;]+);base64,(.+)$/);
    if (!match?.[1] || !match[2]) {
      throw new Error("invalid crop data URL");
    }

    const mime = match[1].trim().toLowerCase();
    const extension = mime.includes("jpeg") ? "jpg" : "png";
    const atobFn =
      (ztoolkit.getGlobal("atob") as ((input: string) => string) | undefined) ||
      globalThis.atob;
    if (typeof atobFn !== "function") {
      throw new Error("atob is unavailable for base64 decode");
    }

    return {
      extension,
      binary: atobFn(match[2]),
    };
  }

  private static writeBinaryStringToFile(file: nsIFile, binary: string): void {
    const outputStream = (Components.classes as any)[
      "@mozilla.org/network/file-output-stream;1"
    ].createInstance(
      Components.interfaces.nsIFileOutputStream,
    ) as nsIFileOutputStream;

    // WRONLY | CREATE_FILE | TRUNCATE
    outputStream.init(file, 0x02 | 0x08 | 0x20, 0o666, 0);
    try {
      outputStream.write(binary, binary.length);
    } finally {
      outputStream.close();
    }
  }

  private static async applyCropOverridesToZip(
    zipFile: nsIFile,
    dataURLByImagePath: Map<string, string>,
  ): Promise<void> {
    if (!dataURLByImagePath.size) {
      return;
    }

    const zipWriter = (Components.classes as any)[
      "@mozilla.org/zipwriter;1"
    ].createInstance(Components.interfaces.nsIZipWriter) as nsIZipWriter;
    const tempFiles: nsIFile[] = [];
    const ioFlags = 0x04; // RDWR

    try {
      zipWriter.open(zipFile, ioFlags);

      let index = 0;
      for (const [rawImagePath, dataURL] of dataURLByImagePath) {
        const normalizedPath = rawImagePath.replace(/^\/+/, "").trim();
        if (!normalizedPath) {
          continue;
        }

        const targetEntry =
          (zipWriter.hasEntry(rawImagePath) && rawImagePath) ||
          (zipWriter.hasEntry(normalizedPath) && normalizedPath) ||
          normalizedPath;

        const decoded = this.decodeBase64DataURL(dataURL);

        index += 1;
        const tempFile = Zotero.getTempDirectory();
        tempFile.append(
          `${config.addonRef}-crop-${Date.now()}-${index}.${decoded.extension}`,
        );
        this.writeBinaryStringToFile(tempFile, decoded.binary);
        tempFiles.push(tempFile);

        if (zipWriter.hasEntry(targetEntry)) {
          zipWriter.removeEntry(targetEntry, false);
        }

        zipWriter.addEntryFile(
          targetEntry,
          zipWriter.COMPRESSION_DEFAULT || 6,
          tempFile,
          false,
        );
      }
    } finally {
      zipWriter.close();
      for (const tempFile of tempFiles) {
        await Zotero.File.removeIfExists(tempFile.path);
      }
    }
  }

  private static async saveFileAttachment(
    item: Zotero.Item,
    file: nsIFile,
    title: string,
    contentType: string,
  ): Promise<void> {
    const importOptions: _ZoteroTypes.Attachments.OptionsFromFile & {
      libraryID?: number;
    } = {
      file,
      title,
      contentType,
      charset: "utf-8",
    };

    if (item.isRegularItem()) {
      importOptions.parentItemID = item.id;
    } else {
      importOptions.libraryID = item.libraryID;
    }

    await Zotero.Attachments.importFromFile(importOptions);
  }

  private static async saveResultAttachments(
    item: Zotero.Item,
    zipFile: nsIFile,
    markdownFileName: string,
    summaryFileName: string,
    manifestFileName: string,
    mergedManifestFileName: string,
    batchID: string,
    result: MinerUExtractResultItem,
  ): Promise<void> {
    const title = item.getDisplayTitle() || item.key;

    const summaryFile = Zotero.getTempDirectory();
    summaryFile.append(summaryFileName);

    const markdownFile = Zotero.getTempDirectory();
    markdownFile.append(markdownFileName);

    const manifestFile = Zotero.getTempDirectory();
    manifestFile.append(manifestFileName);

    const mergedManifestFile = Zotero.getTempDirectory();
    mergedManifestFile.append(mergedManifestFileName);

    let mineruMarkdown: MinerUMarkdownData | null = null;
    let markdownError = "";
    try {
      mineruMarkdown = await this.readPrimaryMarkdownFromZip(zipFile);
    } catch (error) {
      markdownError = this.getErrorMessage(error);
      ztoolkit.log("read mineru markdown failed", item.id, error);
    }

    let manifest: MinerUManifest | null = null;
    let manifestError = "";
    try {
      manifest = await this.buildManifestFromZip(
        zipFile,
        item,
        batchID,
        result,
      );
    } catch (error) {
      manifestError = this.getErrorMessage(error);
      ztoolkit.log("build mineru manifest failed", item.id, error);
    }

    let mergedManifest: MinerUManifest | null = null;
    let mergedManifestError = "";
    let captionIndex: ZhCaptionIndex | null = null;
    const mergedManifestErrorParts: string[] = [];

    if (manifest) {
      try {
        captionIndex = await this.readLatestZhCaptionIndex(item);
      } catch (error) {
        mergedManifestErrorParts.push(this.getErrorMessage(error));
        ztoolkit.log("read zh caption index failed", item.id, error);
      }

      if (captionIndex) {
        try {
          manifest = await this.reviewVisualCountMismatch(
            title,
            manifest,
            captionIndex,
            zipFile,
          );
        } catch (error) {
          mergedManifestErrorParts.push(this.getErrorMessage(error));
          ztoolkit.log("manual visual count review failed", item.id, error);
        }
      }

      try {
        const cropOverrides = await this.reviewVisualCropAdjustments(
          item,
          manifest,
          zipFile,
        );
        if (cropOverrides.size) {
          await this.applyCropOverridesToZip(zipFile, cropOverrides);
        }
      } catch (error) {
        mergedManifestErrorParts.push(this.getErrorMessage(error));
        ztoolkit.log("manual crop review failed", item.id, error);
      }

      mergedManifest = manifest;
      if (captionIndex) {
        try {
          mergedManifest = this.applyZhCaptionsToManifest(
            manifest,
            captionIndex,
          );
        } catch (error) {
          mergedManifestErrorParts.push(this.getErrorMessage(error));
          ztoolkit.log("merge zh captions failed", item.id, error);
        }
      }
    }

    if (mergedManifestErrorParts.length) {
      mergedManifestError = mergedManifestErrorParts.join(" | ");
    }

    const summary: {
      source_item: {
        id: number;
        key: string;
        title: string;
      };
      mineru: {
        batch_id: string;
        fetched_at: string;
        result: MinerUExtractResultItem;
        manifest?: {
          figure_count: number;
          table_count: number;
          content_list_entry: string;
          source_markdown_entry?: string;
        };
        manifest_error?: string;
        output_markdown?: {
          entry: string;
          saved: boolean;
        };
        output_markdown_error?: string;
        merged_manifest?: {
          figure_zh_matched: number;
          table_zh_matched: number;
          source_markdown_attachment_id?: number;
          source_markdown_file_name?: string;
        };
        merged_manifest_error?: string;
      };
    } = {
      source_item: {
        id: item.id,
        key: item.key,
        title,
      },
      mineru: {
        batch_id: batchID,
        fetched_at: new Date().toISOString(),
        result,
      },
    };

    if (manifest) {
      summary.mineru.manifest = {
        figure_count: manifest.stats.figure_count,
        table_count: manifest.stats.table_count,
        content_list_entry: manifest.content_list_entry,
        ...(manifest.source_markdown_entry
          ? { source_markdown_entry: manifest.source_markdown_entry }
          : {}),
      };
    }
    if (manifestError) {
      summary.mineru.manifest_error = manifestError;
    }
    if (mergedManifest?.translation) {
      summary.mineru.merged_manifest = {
        figure_zh_matched: mergedManifest.translation.matched_figure_count,
        table_zh_matched: mergedManifest.translation.matched_table_count,
        source_markdown_attachment_id:
          mergedManifest.translation.source_markdown_attachment_id,
        source_markdown_file_name:
          mergedManifest.translation.source_markdown_file_name,
      };
    }
    if (mergedManifestError) {
      summary.mineru.merged_manifest_error = mergedManifestError;
    }
    if (mineruMarkdown) {
      summary.mineru.output_markdown = {
        entry: mineruMarkdown.entryName,
        saved: true,
      };
    }
    if (markdownError) {
      summary.mineru.output_markdown_error = markdownError;
    }

    try {
      if (mineruMarkdown) {
        await Zotero.File.putContentsAsync(
          markdownFile,
          mineruMarkdown.content,
          "utf-8",
        );
      }

      await Zotero.File.putContentsAsync(
        summaryFile,
        JSON.stringify(summary, null, 2),
        "utf-8",
      );

      if (manifest) {
        await Zotero.File.putContentsAsync(
          manifestFile,
          JSON.stringify(manifest, null, 2),
          "utf-8",
        );
      }
      if (mergedManifest) {
        await Zotero.File.putContentsAsync(
          mergedManifestFile,
          JSON.stringify(mergedManifest, null, 2),
          "utf-8",
        );
      }

      await this.saveFileAttachment(
        item,
        zipFile,
        `MinerU Output - ${title}`,
        "application/zip",
      );
      await this.saveFileAttachment(
        item,
        summaryFile,
        `MinerU Summary - ${title}`,
        "application/json",
      );
      if (mineruMarkdown) {
        await this.saveFileAttachment(
          item,
          markdownFile,
          `MinerU Markdown - ${title}`,
          "text/markdown",
        );
      }
      if (manifest) {
        await this.saveFileAttachment(
          item,
          manifestFile,
          `MinerU Manifest - ${title}`,
          "application/json",
        );
      }
      if (mergedManifest) {
        await this.saveFileAttachment(
          item,
          mergedManifestFile,
          `MinerU Merged Manifest - ${title}`,
          "application/json",
        );
      }
    } finally {
      await Zotero.File.removeIfExists(zipFile.path);
      await Zotero.File.removeIfExists(markdownFile.path);
      await Zotero.File.removeIfExists(summaryFile.path);
      await Zotero.File.removeIfExists(manifestFile.path);
      await Zotero.File.removeIfExists(mergedManifestFile.path);
    }
  }

  private static openStatusWindow(title: string): MinerUStatusWindow {
    const shortTitle = title.length > 60 ? `${title.slice(0, 57)}...` : title;
    const popup = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: getString("mineru-working", {
          args: { title: shortTitle },
        }),
        type: "default",
      })
      .show(-1);

    return {
      update(text: string) {
        popup.changeLine({
          idx: 0,
          text,
        });
      },
      close() {
        popup.close();
      },
    };
  }

  private static getErrorMessage(error: unknown): string {
    if (error === null) {
      return "null";
    }
    if (error === undefined) {
      return "undefined";
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error.trim()) {
      return error;
    }

    if (typeof error === "object") {
      const errorObject = error as Record<string, unknown>;
      const details: string[] = [];
      for (const field of [
        "message",
        "stderr",
        "stdout",
        "code",
        "status",
        "exitCode",
        "name",
      ]) {
        const value = errorObject[field];
        if (value === undefined || value === null) {
          continue;
        }
        const text = this.stringifyUnknownValue(value);
        if (!text || text === "null" || text === "undefined") {
          continue;
        }
        details.push(`${field}=${text}`);
      }
      if (details.length) {
        return details.join(", ");
      }
    }

    return this.stringifyUnknownValue(error);
  }

  private static stringifyUnknownValue(value: unknown): string {
    if (value === null) {
      return "null";
    }
    if (value === undefined) {
      return "undefined";
    }
    if (typeof value === "string") {
      return value.trim() || "(empty string)";
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }
    if (value instanceof Error) {
      return value.message || value.name || "Error";
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return Object.prototype.toString.call(value);
    }
  }

  private static showToast(
    text: string,
    type: "default" | "success" | "error" = "default",
  ): void {
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text,
        type,
      })
      .show();
  }
}

export {
  MINERU_DEFAULT_BASE_URL,
  MINERU_DEFAULT_MODEL_VERSION,
  MINERU_PREF_KEYS,
};
