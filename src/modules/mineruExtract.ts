import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getSecret } from "../utils/secureStore";

const EXTRACT_MENU_ID = `zotero-itemmenu-${config.addonRef}-mineru-extract`;
const VIEW_MENU_ID = `zotero-itemmenu-${config.addonRef}-mineru-view`;
const MINERU_TIMEOUT_MS = 10 * 60 * 1000;
const MINERU_POLL_INTERVAL_MS = 3000;
const MINERU_POLL_TIMEOUT_MS = 20 * 60 * 1000;

const MINERU_DEFAULT_BASE_URL = "https://mineru.net/api/v4";
const MINERU_DEFAULT_MODEL_VERSION = "vlm";

const MINERU_PREF_KEYS = {
  token: "mineruAPIToken",
  baseURL: "mineruBaseURL",
  modelVersion: "mineruModelVersion",
} as const;

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
  number_source: "caption" | "fallback-sequence";
  page_idx: number | null;
  image_path: string;
  caption_en: string;
  caption_zh: string;
  footnote_en: string;
  bbox: number[];
}

interface MinerUManifestTable {
  number: number;
  number_source: "caption" | "fallback-sequence";
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
  stats: {
    total_items: number;
    type_counts: Record<string, number>;
    figure_count: number;
    table_count: number;
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

interface MinerUStatusWindow {
  update(text: string): void;
  close(): void;
}

export class MinerUExtractFactory {
  private static menuRegistered = false;
  private static extracting = false;

  static registerItemMenu(): void {
    if (this.menuRegistered) {
      return;
    }

    this.menuRegistered = true;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: EXTRACT_MENU_ID,
      label: getString("menuitem-mineru-extract"),
      commandListener: async () => {
        await this.extractSelectedItems();
      },
    });

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: VIEW_MENU_ID,
      label: getString("menuitem-mineru-view"),
      commandListener: async () => {
        await this.openViewerForSelectedItem();
      },
    });
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

      if (!mergedManifest.figures.length && !mergedManifest.tables.length) {
        throw new Error(getString("mineru-viewer-error-no-visual-content"));
      }

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
        attachments.find((attachment) =>
          this.isMineruZipAttachment(attachment),
        );

      if (!zipAttachment) {
        throw new Error(getString("mineru-viewer-error-no-zip"));
      }

      const zipPath = await zipAttachment.getFilePathAsync();
      if (!zipPath) {
        throw new Error(getString("mineru-viewer-error-no-zip"));
      }

      const zipFile = Zotero.File.pathToFile(zipPath);
      const extractionResult = this.extractViewerImageURIMap(
        zipFile,
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
  ): Promise<Zotero.Item | null> {
    if (item.isPDFAttachment()) {
      return item;
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
    const match = caption.match(/\bfig(?:ure)?\.?\s*(\d+)\b/i);
    if (!match?.[1]) {
      return null;
    }
    return Number(match[1]);
  }

  private static parseTableNumber(caption: string): number | null {
    const match = caption.match(/\btable\s*(\d+)\b/i);
    if (!match?.[1]) {
      return null;
    }
    return Number(match[1]);
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

    const figures: MinerUManifestFigure[] = figuresRaw.map((rawItem, index) => {
      const caption = this.joinTextList(
        this.normalizeTextList(rawItem.image_caption),
      );
      const footnote = this.joinTextList(
        this.normalizeTextList(rawItem.image_footnote),
      );
      const parsedNumber = this.parseFigureNumber(caption);
      const number = parsedNumber || index + 1;
      return {
        number,
        number_source: parsedNumber ? "caption" : "fallback-sequence",
        page_idx:
          typeof rawItem.page_idx === "number" ? rawItem.page_idx : null,
        image_path: rawItem.img_path || "",
        caption_en: caption,
        caption_zh: "",
        footnote_en: footnote,
        bbox: this.asNumberArray(rawItem.bbox),
      };
    });

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
      const parsedNumber = this.parseTableNumber(
        caption || rawItem.table_body || "",
      );
      const number = parsedNumber || index + 1;
      return {
        number,
        number_source: parsedNumber ? "caption" : "fallback-sequence",
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
      stats: {
        total_items: items.length,
        type_counts: typeCounts,
        figure_count: figures.length,
        table_count: tables.length,
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
    summaryFileName: string,
    manifestFileName: string,
    mergedManifestFileName: string,
    batchID: string,
    result: MinerUExtractResultItem,
  ): Promise<void> {
    const title = item.getDisplayTitle() || item.key;

    const summaryFile = Zotero.getTempDirectory();
    summaryFile.append(summaryFileName);

    const manifestFile = Zotero.getTempDirectory();
    manifestFile.append(manifestFileName);

    const mergedManifestFile = Zotero.getTempDirectory();
    mergedManifestFile.append(mergedManifestFileName);

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
    if (manifest) {
      mergedManifest = manifest;
      try {
        const captionIndex = await this.readLatestZhCaptionIndex(item);
        if (captionIndex) {
          mergedManifest = this.applyZhCaptionsToManifest(
            manifest,
            captionIndex,
          );
        }
      } catch (error) {
        mergedManifestError = this.getErrorMessage(error);
        ztoolkit.log("merge zh captions failed", item.id, error);
      }
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
        };
        manifest_error?: string;
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

    try {
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
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error.trim()) {
      return error;
    }
    return "unknown error";
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
