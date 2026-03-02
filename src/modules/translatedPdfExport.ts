import katex from "katex";
import { config } from "../../package.json";
import { exportPdfByHeadlessBrowser } from "./pdf/headlessPdfPrinter";
import { getString } from "../utils/locale";
import {
  getMenuVisibilityPref,
  MENU_VISIBILITY_DEFAULTS,
  MENU_VISIBILITY_PREF_KEYS,
} from "./menuVisibility";

const EXPORT_MENU_ID = `zotero-itemmenu-${config.addonRef}-export-translated-pdf`;

const PDF_EXPORT_PREF_KEYS = {
  headlessBrowserPath: "export-pdf-headless-browser-path",
  fontFamily: "export-pdf-font-family",
  fontSizePt: "export-pdf-font-size-pt",
  bodyWidthPercent: "export-pdf-body-width-percent",
  paragraphIndentEm: "export-pdf-paragraph-indent-em",
} as const;

const PDF_STYLE_DEFAULTS = {
  fontFamily: "'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', serif",
  fontSizePt: 12,
  bodyWidthPercent: 95,
  paragraphIndentEm: 0,
} as const;

type VisualKind = "figure" | "table";

interface MergedManifestFigure {
  number?: number;
  page_idx?: number | null;
  image_path?: string;
  caption_zh?: string;
  caption_en?: string;
}

interface MergedManifestTable {
  number?: number;
  page_idx?: number | null;
  image_path?: string;
  caption_zh?: string;
  caption_en?: string;
}

interface MergedManifest {
  figures: MergedManifestFigure[];
  tables: MergedManifestTable[];
}

interface ManifestVisualEntry {
  kind: VisualKind;
  number: number;
  pageIdx: number | null;
  imagePath: string;
  captionZh: string;
  captionEn: string;
}

interface CaptionBlock {
  kind: VisualKind;
  number: number;
  text: string;
}

interface ParsedTranslationMarkdown {
  bodyMarkdown: string;
  captionBlocks: CaptionBlock[];
}

interface ExportVisualEntry {
  kind: VisualKind;
  number: number;
  pageIdx: number | null;
  captionText: string;
  imageURI: string;
}

interface ExportStatusWindow {
  update(text: string): void;
  close(): void;
}

interface PdfStyleOptions {
  fontFamily: string;
  fontSizePt: number;
  bodyWidthPercent: number;
  paragraphIndentEm: number;
}

interface TocEntry {
  level: number;
  title: string;
  anchorId: string;
}

interface RenderedMarkdown {
  html: string;
  tocEntries: TocEntry[];
}

export class TranslatedPdfExportFactory {
  private static menuRegistered = false;
  private static exporting = false;

  static registerItemMenu(): void {
    if (this.menuRegistered) {
      return;
    }

    this.menuRegistered = true;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: EXPORT_MENU_ID,
      label: this.t("menuitem-export-translated-pdf"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.exportTranslatedPdf,
          MENU_VISIBILITY_DEFAULTS.exportTranslatedPdf,
        ),
      commandListener: async () => {
        await this.exportSelectedItems();
      },
    });
  }

  static async runSelectedItems(): Promise<void> {
    await this.exportSelectedItems();
  }

  private static async exportSelectedItems(): Promise<void> {
    if (this.exporting) {
      this.showToast(this.t("export-pdf-busy"), "default");
      return;
    }

    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(this.t("export-pdf-error-no-selection"), "error");
      return;
    }

    this.exporting = true;
    this.showToast(this.t("export-pdf-start"), "default");

    let successCount = 0;
    let failedCount = 0;

    try {
      for (const selectedItem of selectedItems) {
        const targetItem = this.resolveTargetItem(selectedItem);
        const targetTitle = targetItem.getDisplayTitle() || targetItem.key;
        const statusWindow = this.openStatusWindow(targetTitle);
        let tempDirPath = "";

        try {
          statusWindow.update(this.t("export-pdf-status-build"));
          const tempDir = this.createTempDirectory();
          tempDirPath = tempDir.path;

          const pdfFile = await this.buildTranslatedPDF(
            targetItem,
            tempDir,
            statusWindow,
          );

          statusWindow.update(this.t("export-pdf-status-save"));
          await this.savePdfAttachment(targetItem, pdfFile);
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          ztoolkit.log("export translated pdf failed", targetItem.id, error);
          this.showToast(
            this.t("export-pdf-item-failed", {
              args: {
                title: targetTitle,
                reason: this.getErrorMessage(error),
              },
            }),
            "error",
          );
        } finally {
          statusWindow.close();
          this.removeDirectoryIfExists(tempDirPath);
        }
      }
    } finally {
      this.exporting = false;
    }

    if (successCount > 0 && failedCount === 0) {
      this.showToast(
        this.t("export-pdf-success", {
          args: { count: successCount },
        }),
        "success",
      );
      return;
    }

    if (successCount > 0) {
      this.showToast(
        this.t("export-pdf-partial-success", {
          args: {
            success: successCount,
            failed: failedCount,
          },
        }),
        "default",
      );
      return;
    }

    this.showToast(this.t("export-pdf-error-all-failed"), "error");
  }

  private static async buildTranslatedPDF(
    item: Zotero.Item,
    tempDir: nsIFile,
    statusWindow: ExportStatusWindow,
  ): Promise<nsIFile> {
    const attachments = this.getItemAttachments(item).sort(
      (a, b) => b.id - a.id,
    );
    const markdownAttachment = attachments.find((attachment) =>
      this.isDeepSeekMarkdownAttachment(attachment),
    );
    if (!markdownAttachment) {
      throw new Error(this.t("export-pdf-error-no-markdown"));
    }

    const mergedManifestAttachment = attachments.find((attachment) =>
      this.isMineruMergedManifestAttachment(attachment),
    );
    if (!mergedManifestAttachment) {
      throw new Error(this.t("export-pdf-error-no-merged-manifest"));
    }

    const mergedManifest = await this.readMergedManifestAttachment(
      mergedManifestAttachment,
    );

    const expectedZipName = this.expectedZipNameFromMergedManifest(
      mergedManifestAttachment.attachmentFilename || "",
    ).toLowerCase();

    const zipAttachment =
      attachments.find((attachment) => {
        if (!this.isMineruZipAttachment(attachment) || !expectedZipName) {
          return false;
        }
        return (
          (attachment.attachmentFilename || "").toLowerCase() ===
          expectedZipName
        );
      }) ||
      attachments.find((attachment) => this.isMineruZipAttachment(attachment));

    if (!zipAttachment) {
      throw new Error(this.t("export-pdf-error-no-zip"));
    }

    const zipPath = await zipAttachment.getFilePathAsync();
    if (!zipPath) {
      throw new Error(this.t("export-pdf-error-no-zip"));
    }

    const markdown = await this.readAttachmentText(
      markdownAttachment,
      "export-pdf-error-read-markdown",
    );
    const manifestVisualMap = this.buildManifestVisualMap(mergedManifest);
    const parsedMarkdown = this.parseTranslationMarkdown(
      markdown,
      manifestVisualMap,
    );

    const availableTargetKeys = new Set(
      parsedMarkdown.captionBlocks.map((block) =>
        this.buildVisualKey(block.kind, block.number),
      ),
    );
    const linkedBodyMarkdown = this.injectReferenceLinks(
      parsedMarkdown.bodyMarkdown,
      availableTargetKeys,
    );

    const imagePathSet = new Set<string>();
    for (const block of parsedMarkdown.captionBlocks) {
      const key = this.buildVisualKey(block.kind, block.number);
      const visual = manifestVisualMap.get(key);
      if (visual?.imagePath) {
        imagePathSet.add(visual.imagePath);
      }
    }

    const imageURIByPath = this.extractImageURIMap(
      Zotero.File.pathToFile(zipPath),
      imagePathSet,
      tempDir,
    );

    const exportEntries: ExportVisualEntry[] = parsedMarkdown.captionBlocks.map(
      (block) => {
        const key = this.buildVisualKey(block.kind, block.number);
        const visual = manifestVisualMap.get(key);
        const imageURI = visual?.imagePath
          ? imageURIByPath.get(visual.imagePath) || ""
          : "";
        const captionText =
          block.text ||
          visual?.captionZh ||
          visual?.captionEn ||
          this.t("export-pdf-empty-caption");

        return {
          kind: block.kind,
          number: block.number,
          pageIdx: visual?.pageIdx ?? null,
          captionText,
          imageURI,
        };
      },
    );
    exportEntries.sort((a, b) => this.compareVisualOrder(a, b));

    const title = item.getDisplayTitle() || item.key;
    const styleOptions = this.getPdfStyleOptions();
    const html = this.buildExportHTML(
      title,
      linkedBodyMarkdown,
      exportEntries,
      styleOptions,
    );

    const htmlFile = tempDir.clone();
    htmlFile.append("translated-export.html");
    await Zotero.File.putContentsAsync(htmlFile, html, "utf-8");

    const pdfFile = tempDir.clone();
    pdfFile.append(`translit-export-${item.key}-${this.formatTimestamp()}.pdf`);

    statusWindow.update(this.t("export-pdf-status-render"));
    await this.printHTMLToPDF(htmlFile.path, pdfFile.path);

    if (!pdfFile.exists() || pdfFile.fileSize <= 0) {
      throw new Error(this.t("export-pdf-error-print-failed"));
    }

    return pdfFile;
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

  private static getItemAttachments(item: Zotero.Item): Zotero.Item[] {
    return item
      .getAttachments()
      .map((attachmentID) => Zotero.Items.get(attachmentID))
      .filter((attachment): attachment is Zotero.Item => Boolean(attachment));
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

  private static async readAttachmentText(
    attachment: Zotero.Item,
    errorKey: string,
  ): Promise<string> {
    const filePath = await attachment.getFilePathAsync();
    if (!filePath) {
      throw new Error(this.t(errorKey));
    }

    const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
    if (typeof content !== "string") {
      throw new Error(this.t(errorKey));
    }
    return content;
  }

  private static async readMergedManifestAttachment(
    attachment: Zotero.Item,
  ): Promise<MergedManifest> {
    const filePath = await attachment.getFilePathAsync();
    if (!filePath) {
      throw new Error(this.t("export-pdf-error-no-merged-manifest"));
    }

    const content = await Zotero.File.getContentsAsync(filePath, "utf-8");
    if (typeof content !== "string") {
      throw new Error(this.t("export-pdf-error-invalid-manifest"));
    }

    let parsed: MergedManifest;
    try {
      parsed = JSON.parse(content) as MergedManifest;
    } catch (_error) {
      throw new Error(this.t("export-pdf-error-invalid-manifest"));
    }

    if (
      !parsed ||
      !Array.isArray(parsed.figures) ||
      !Array.isArray(parsed.tables)
    ) {
      throw new Error(this.t("export-pdf-error-invalid-manifest"));
    }

    return parsed;
  }

  private static buildVisualKey(kind: VisualKind, number: number): string {
    return `${kind}:${number}`;
  }

  private static buildAnchorID(kind: VisualKind, number: number): string {
    return `${kind === "figure" ? "fig" : "tbl"}-${number}`;
  }

  private static compareVisualOrder(
    a: { pageIdx: number | null; kind: VisualKind; number: number },
    b: { pageIdx: number | null; kind: VisualKind; number: number },
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
    return a.number - b.number;
  }

  private static normalizeVisualNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      const number = Number(value.trim());
      if (Number.isInteger(number) && number > 0) {
        return number;
      }
    }
    return null;
  }

  private static buildManifestVisualMap(
    manifest: MergedManifest,
  ): Map<string, ManifestVisualEntry> {
    const visualMap = new Map<string, ManifestVisualEntry>();

    const pushEntry = (
      kind: VisualKind,
      entry: MergedManifestFigure | MergedManifestTable,
    ) => {
      const initialNumber = this.normalizeVisualNumber(entry.number);
      if (!initialNumber) {
        return;
      }

      let number = initialNumber;
      let key = this.buildVisualKey(kind, number);
      while (visualMap.has(key)) {
        number += 1;
        key = this.buildVisualKey(kind, number);
      }

      visualMap.set(key, {
        kind,
        number,
        pageIdx: typeof entry.page_idx === "number" ? entry.page_idx : null,
        imagePath: (entry.image_path || "").trim(),
        captionZh: (entry.caption_zh || "").trim(),
        captionEn: (entry.caption_en || "").trim(),
      });
    };

    for (const figure of manifest.figures) {
      pushEntry("figure", figure);
    }
    for (const table of manifest.tables) {
      pushEntry("table", table);
    }

    return visualMap;
  }

  private static matchCaptionStartLine(
    line: string,
  ): { kind: VisualKind; number: number; firstText: string } | null {
    const match = line.match(
      /^\s*(?:\*\*)?\s*(图|表|figure|fig(?:ure)?\.?|table)\s*(\d+)\s*[：:]\s*(?:\*\*)?\s*(.*)$/i,
    );
    if (!match?.[1] || !match[2]) {
      return null;
    }

    const rawKind = match[1].toLowerCase();
    const kind: VisualKind =
      rawKind === "图" || rawKind.startsWith("fig") ? "figure" : "table";

    const number = Number(match[2]);
    if (!Number.isInteger(number) || number <= 0) {
      return null;
    }

    return {
      kind,
      number,
      firstText: (match[3] || "").trim(),
    };
  }

  private static buildFallbackCaptionText(entry: ManifestVisualEntry): string {
    return (
      entry.captionZh || entry.captionEn || this.t("export-pdf-empty-caption")
    );
  }

  private static buildFallbackCaptionBlocks(
    visualMap: Map<string, ManifestVisualEntry>,
  ): CaptionBlock[] {
    return Array.from(visualMap.values())
      .sort((a, b) => this.compareVisualOrder(a, b))
      .map((entry) => ({
        kind: entry.kind,
        number: entry.number,
        text: this.buildFallbackCaptionText(entry),
      }));
  }

  private static collectVisualReferencesFromBody(
    markdown: string,
  ): Set<string> {
    const refs = new Set<string>();
    const lines = markdown.split(/\r?\n/);
    let inCodeBlock = false;

    const collectByRegex = (line: string, regex: RegExp, kind: VisualKind) => {
      let match = regex.exec(line);
      while (match) {
        const number = Number(match[1]);
        if (Number.isInteger(number) && number > 0) {
          refs.add(this.buildVisualKey(kind, number));
        }
        match = regex.exec(line);
      }
      regex.lastIndex = 0;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) {
        continue;
      }

      const protectedLine = this.protectMarkdownLinks(line).text;
      collectByRegex(protectedLine, /图\s*(\d+)/g, "figure");
      collectByRegex(protectedLine, /表\s*(\d+)/g, "table");
      collectByRegex(protectedLine, /\bfig(?:ure)?\.?\s*(\d+)/gi, "figure");
      collectByRegex(protectedLine, /\btable\s*(\d+)/gi, "table");
    }

    return refs;
  }

  private static parseTranslationMarkdown(
    markdown: string,
    visualMap: Map<string, ManifestVisualEntry>,
  ): ParsedTranslationMarkdown {
    const lines = markdown.split(/\r?\n/);
    let firstCaptionStart = -1;

    for (let i = 0; i < lines.length; i++) {
      if (this.matchCaptionStartLine(lines[i])) {
        firstCaptionStart = i;
        break;
      }
    }

    const bodyMarkdown = (
      firstCaptionStart >= 0 ? lines.slice(0, firstCaptionStart) : lines
    )
      .join("\n")
      .trim();

    const captionBlocks: CaptionBlock[] = [];
    const seenKeys = new Set<string>();

    if (firstCaptionStart >= 0) {
      let cursor = firstCaptionStart;
      while (cursor < lines.length) {
        const start = this.matchCaptionStartLine(lines[cursor]);
        if (!start) {
          cursor += 1;
          continue;
        }

        const parts: string[] = [];
        if (start.firstText) {
          parts.push(start.firstText);
        }

        let next = cursor + 1;
        while (next < lines.length) {
          if (this.matchCaptionStartLine(lines[next])) {
            break;
          }

          const trimmed = lines[next].trim();
          if (!trimmed) {
            if (parts.length) {
              next += 1;
              break;
            }
            next += 1;
            continue;
          }

          if (/^#{1,6}\s/.test(trimmed) || trimmed === "---") {
            break;
          }

          parts.push(trimmed);
          next += 1;
        }

        const key = this.buildVisualKey(start.kind, start.number);
        if (!seenKeys.has(key)) {
          const mergedText = parts.join(" ").replace(/\s+/g, " ").trim();
          captionBlocks.push({
            kind: start.kind,
            number: start.number,
            text: mergedText,
          });
          seenKeys.add(key);
        }

        cursor = next;
      }
    }

    const blocks = captionBlocks.length
      ? captionBlocks
      : this.buildFallbackCaptionBlocks(visualMap);
    for (const block of blocks) {
      seenKeys.add(this.buildVisualKey(block.kind, block.number));
    }

    const refKeys = this.collectVisualReferencesFromBody(bodyMarkdown);
    for (const refKey of refKeys) {
      if (seenKeys.has(refKey)) {
        continue;
      }

      const visual = visualMap.get(refKey);
      if (!visual) {
        continue;
      }

      blocks.push({
        kind: visual.kind,
        number: visual.number,
        text: this.buildFallbackCaptionText(visual),
      });
      seenKeys.add(refKey);
    }

    const missingVisuals = Array.from(visualMap.values())
      .filter(
        (visual) =>
          !seenKeys.has(this.buildVisualKey(visual.kind, visual.number)),
      )
      .sort((a, b) => this.compareVisualOrder(a, b));
    for (const visual of missingVisuals) {
      blocks.push({
        kind: visual.kind,
        number: visual.number,
        text: this.buildFallbackCaptionText(visual),
      });
      seenKeys.add(this.buildVisualKey(visual.kind, visual.number));
    }

    return {
      bodyMarkdown,
      captionBlocks: blocks,
    };
  }

  private static protectMarkdownLinks(line: string): {
    text: string;
    tokens: string[];
  } {
    const tokens: string[] = [];
    const text = line.replace(/\[[^\]]+\]\([^)]+\)/g, (matched) => {
      const token = `@@LINK_${tokens.length}@@`;
      tokens.push(matched);
      return token;
    });

    return {
      text,
      tokens,
    };
  }

  private static restoreMarkdownLinks(line: string, tokens: string[]): string {
    let restored = line;
    for (let i = 0; i < tokens.length; i++) {
      restored = restored.replace(`@@LINK_${i}@@`, tokens[i]);
    }
    return restored;
  }

  private static injectReferenceLinks(
    bodyMarkdown: string,
    availableTargets: Set<string>,
  ): string {
    const lines = bodyMarkdown.split(/\r?\n/);
    const output: string[] = [];
    let inCodeBlock = false;

    const linkByRegex = (
      line: string,
      regex: RegExp,
      kind: VisualKind,
    ): string => {
      return line.replace(regex, (fullMatch: string, numberText: string) => {
        const number = Number(numberText);
        if (!Number.isInteger(number) || number <= 0) {
          return fullMatch;
        }

        const key = this.buildVisualKey(kind, number);
        if (!availableTargets.has(key)) {
          return fullMatch;
        }

        return `[${fullMatch.trim()}](#${this.buildAnchorID(kind, number)})`;
      });
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inCodeBlock = !inCodeBlock;
        output.push(line);
        continue;
      }

      if (inCodeBlock) {
        output.push(line);
        continue;
      }

      const protectedLine = this.protectMarkdownLinks(line);
      let linked = protectedLine.text;
      linked = linkByRegex(linked, /图\s*(\d+)/g, "figure");
      linked = linkByRegex(linked, /表\s*(\d+)/g, "table");
      linked = linkByRegex(linked, /\bFig(?:ure)?\.?\s*(\d+)/gi, "figure");
      linked = linkByRegex(linked, /\bTable\s*(\d+)/gi, "table");
      output.push(this.restoreMarkdownLinks(linked, protectedLine.tokens));
    }

    return output.join("\n");
  }

  private static extractImageURIMap(
    zipFile: nsIFile,
    imagePaths: Set<string>,
    outputDir: nsIFile,
  ): Map<string, string> {
    const imageURIMap = new Map<string, string>();
    if (!imagePaths.size) {
      return imageURIMap;
    }

    const zipReader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader) as nsIZipReader;

    try {
      zipReader.open(zipFile);
      let index = 0;

      for (const imagePath of imagePaths) {
        const normalizedPath = imagePath.replace(/^\/+/, "");
        const entryName =
          (zipReader.hasEntry(imagePath) && imagePath) ||
          (zipReader.hasEntry(normalizedPath) && normalizedPath) ||
          "";

        if (!entryName) {
          continue;
        }

        index += 1;
        const baseName = entryName.split("/").pop() || `image-${index}.png`;
        const ext = this.getFileExtension(baseName) || ".png";
        const pureName =
          baseName.slice(0, baseName.length - ext.length) || "image";
        const outputName = `${String(index).padStart(3, "0")}-${this.sanitizeFileName(pureName)}${ext}`;

        const outputFile = outputDir.clone();
        outputFile.append(outputName);

        zipReader.extract(entryName, outputFile);
        if (!outputFile.exists() || outputFile.fileSize <= 0) {
          continue;
        }

        const imageURI = Zotero.File.pathToFileURI(outputFile.path);
        imageURIMap.set(imagePath, imageURI);
        imageURIMap.set(normalizedPath, imageURI);
        imageURIMap.set(entryName, imageURI);
      }
    } finally {
      zipReader.close();
    }

    return imageURIMap;
  }

  private static getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
      return "";
    }
    return fileName.slice(lastDot);
  }

  private static stripHTMLTags(rawHTML: string): string {
    return rawHTML
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

  private static createAnchorIDFromText(
    text: string,
    usedIDs: Set<string>,
  ): string {
    const base = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\- ]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const initial = base || "section";
    let anchorID = initial;
    let suffix = 1;
    while (usedIDs.has(anchorID)) {
      suffix += 1;
      anchorID = `${initial}-${suffix}`;
    }
    usedIDs.add(anchorID);
    return anchorID;
  }

  private static buildTocHTML(entries: TocEntry[]): string {
    if (!entries.length) {
      return `<p>${this.escapeHTML(this.t("export-pdf-empty-body"))}</p>`;
    }

    return [
      '<ul class="toc-list">',
      ...entries.map((entry) => {
        const indent = Math.max(0, Math.min(5, entry.level - 1)) * 4;
        return `<li class="toc-item" style="padding-left: ${indent}mm"><a href="#${this.escapeAttribute(entry.anchorId)}">${this.escapeHTML(entry.title)}</a></li>`;
      }),
      "</ul>",
    ].join("\n");
  }

  private static buildExportHTML(
    title: string,
    bodyMarkdown: string,
    visuals: ExportVisualEntry[],
    styleOptions: PdfStyleOptions,
  ): string {
    const renderedBody = this.renderSimpleMarkdown(bodyMarkdown);
    const bodyHTML = renderedBody.html;
    const visualHTML = visuals
      .map((entry) => {
        const label = entry.kind === "figure" ? "图" : "表";
        const anchorID = this.buildAnchorID(entry.kind, entry.number);
        const captionText =
          entry.captionText.trim() || this.t("export-pdf-empty-caption");

        const mediaHTML = entry.imageURI
          ? `<div class="visual-media"><img src="${this.escapeAttribute(entry.imageURI)}" alt="${this.escapeAttribute(`${label}${entry.number}`)}" /></div>`
          : `<div class="visual-missing">${this.escapeHTML(this.t("export-pdf-missing-image"))}</div>`;

        return [
          `<section class="visual-entry" id="${this.escapeAttribute(anchorID)}">`,
          mediaHTML,
          `<p class="visual-caption"><strong>${label} ${entry.number}：</strong>${this.renderInlineMarkdown(captionText)}</p>`,
          "</section>",
        ].join("\n");
      })
      .join("\n");

    const tocEntries: TocEntry[] = [
      {
        level: 1,
        title: this.t("export-pdf-toc-body"),
        anchorId: "body-start",
      },
      ...renderedBody.tocEntries,
      {
        level: 1,
        title: this.t("export-pdf-toc-visual"),
        anchorId: "visual-section",
      },
    ];
    const tocHTML = this.buildTocHTML(tocEntries);

    const emptyBody = `<p>${this.escapeHTML(this.t("export-pdf-empty-body"))}</p>`;
    const emptyVisual = `<p>${this.escapeHTML(this.t("export-pdf-empty-visual"))}</p>`;

    return [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<head>",
      '<meta charset="utf-8" />',
      `<title>${this.escapeHTML(title)}</title>`,
      "<style>",
      "@page { size: A4; margin: 16mm 14mm; }",
      "* { box-sizing: border-box; }",
      `body { margin: 0; color: #111827; font-family: ${styleOptions.fontFamily}; font-size: ${styleOptions.fontSizePt}pt; line-height: 1.8; }`,
      ".paper { width: 100%; }",
      ".toc-section { margin: 0 0 8mm; padding: 3mm 4mm; border: 0.2mm solid #d1d5db; border-radius: 1.5mm; background: #f9fafb; }",
      ".toc-title { margin: 0 0 3mm; font-size: 13pt; }",
      ".toc-list { margin: 0; padding-left: 5mm; }",
      ".toc-item { margin: 0 0 1.2mm; list-style: none; }",
      ".toc-item a { text-decoration: none; }",
      `.body-section { width: ${styleOptions.bodyWidthPercent}%; margin: 0 auto; }`,
      ".body-section { text-align: justify; text-justify: inter-ideograph; }",
      ".body-section h1, .body-section h2, .body-section h3, .body-section h4, .body-section h5, .body-section h6 { text-align: left; }",
      `.body-section p { text-indent: ${styleOptions.paragraphIndentEm}em; }`,
      ".body-section li p, .body-section blockquote p { text-indent: 0; }",
      "h1 { margin: 0 0 10mm; font-size: 20pt; line-height: 1.3; }",
      "h2 { margin: 10mm 0 5mm; font-size: 16pt; line-height: 1.4; }",
      "h3,h4,h5,h6 { margin: 6mm 0 3mm; line-height: 1.4; }",
      "p { margin: 0 0 3.5mm; word-break: break-word; }",
      "ul,ol { margin: 0 0 4mm 6mm; padding-left: 5mm; }",
      "li { margin-bottom: 1.5mm; }",
      "blockquote { margin: 0 0 4mm; padding: 2mm 3mm; border-left: 1mm solid #cbd5e1; background: #f8fafc; }",
      "code { font-family: 'Consolas', 'Courier New', monospace; font-size: 10.5pt; background: #f3f4f6; padding: 0 1mm; border-radius: 1mm; }",
      "pre { margin: 0 0 4mm; padding: 3mm; background: #f3f4f6; border-radius: 1.5mm; white-space: pre-wrap; word-break: break-word; }",
      "hr { border: 0; border-top: 0.4mm solid #d1d5db; margin: 5mm 0; }",
      "a { color: #0f4aa1; text-decoration: underline; }",
      ".visual-section { margin-top: 6mm; }",
      ".visual-entry { margin: 0 0 10mm; page-break-inside: avoid; break-inside: avoid; }",
      ".visual-media { width: 100%; margin: 0 0 2.5mm; text-align: center; }",
      ".visual-media img { display: block; width: auto; max-width: 80%; margin: 0 auto; height: auto; border: 0.2mm solid #d1d5db; }",
      ".visual-caption { margin: 0; }",
      ".visual-missing { margin: 0 0 2.5mm; padding: 2.5mm; border: 0.2mm dashed #9ca3af; color: #4b5563; background: #f9fafb; }",
      ".math-block { margin: 0 0 4mm; text-align: center; }",
      ".math-inline { display: inline-block; vertical-align: middle; }",
      ".math-fallback { font-family: 'Consolas', 'Courier New', monospace; }",
      "</style>",
      "</head>",
      "<body>",
      '<main class="paper">',
      `<h1>${this.escapeHTML(title)}</h1>`,
      `<section class="toc-section"><h2 class="toc-title">${this.escapeHTML(this.t("export-pdf-toc-title"))}</h2>${tocHTML}</section>`,
      `<section id="body-start" class="body-section">${bodyHTML || emptyBody}</section>`,
      `<section id="visual-section" class="visual-section"><h2>${this.escapeHTML(this.t("export-pdf-visual-section-title"))}</h2>${visualHTML || emptyVisual}</section>`,
      "</main>",
      "<script>",
      "(function(){",
      "  var applyScale = function(img){",
      "    if (!img || !img.naturalWidth) return;",
      "    img.style.width = (img.naturalWidth * 2 / 3).toFixed(2) + 'px';",
      "  };",
      "  var setup = function(){",
      "    var images = document.querySelectorAll('.visual-media img');",
      "    images.forEach(function(img){",
      "      if (img.complete) {",
      "        applyScale(img);",
      "      } else {",
      "        img.addEventListener('load', function(){ applyScale(img); }, { once: true });",
      "      }",
      "    });",
      "  };",
      "  if (document.readyState === 'loading') {",
      "    document.addEventListener('DOMContentLoaded', setup, { once: true });",
      "  } else {",
      "    setup();",
      "  }",
      "})();",
      "</script>",
      "</body>",
      "</html>",
    ].join("\n");
  }

  private static renderSimpleMarkdown(markdown: string): RenderedMarkdown {
    const lines = markdown.split(/\r?\n/);
    const html: string[] = [];
    const tocEntries: TocEntry[] = [];
    const usedAnchorIDs = new Set<string>();
    let paragraphLines: string[] = [];
    let codeLines: string[] = [];
    let mathLines: string[] = [];
    let inCodeBlock = false;
    let inMathBlock = false;
    let listType: "ul" | "ol" | null = null;

    const flushParagraph = () => {
      if (!paragraphLines.length) {
        return;
      }
      const content = paragraphLines
        .map((line) => this.renderInlineMarkdown(line))
        .join("<br>");
      html.push(`<p>${content}</p>`);
      paragraphLines = [];
    };

    const closeList = () => {
      if (!listType) {
        return;
      }
      html.push(`</${listType}>`);
      listType = null;
    };

    const flushMathBlock = () => {
      if (!mathLines.length) {
        return;
      }

      const expression = mathLines.join("\n").trim();
      mathLines = [];
      if (!expression) {
        return;
      }

      html.push(
        `<div class="math-block">${this.renderMathExpression(expression, true)}</div>`,
      );
    };

    const appendListItem = (type: "ul" | "ol", content: string) => {
      flushParagraph();
      if (listType !== type) {
        closeList();
        html.push(`<${type}>`);
        listType = type;
      }
      html.push(`<li>${this.renderInlineMarkdown(content)}</li>`);
    };

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        flushParagraph();
        closeList();
        if (inCodeBlock) {
          html.push(
            `<pre><code>${this.escapeHTML(codeLines.join("\n"))}</code></pre>`,
          );
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (inMathBlock) {
        const closingIndex = line.indexOf("$$");
        if (closingIndex >= 0) {
          const before = line.slice(0, closingIndex).trim();
          if (before) {
            mathLines.push(before);
          }

          flushMathBlock();
          inMathBlock = false;

          const trailing = line.slice(closingIndex + 2).trim();
          if (trailing) {
            paragraphLines.push(trailing);
          }
        } else {
          mathLines.push(line.trim());
        }

        continue;
      }

      const blockMathStart = line.match(/^\s*\$\$(.*)$/);
      if (blockMathStart) {
        flushParagraph();
        closeList();

        const rest = blockMathStart[1] || "";
        const endIndex = rest.indexOf("$$");
        if (endIndex >= 0) {
          const expression = rest.slice(0, endIndex).trim();
          if (expression) {
            html.push(
              `<div class="math-block">${this.renderMathExpression(expression, true)}</div>`,
            );
          }

          const trailing = rest.slice(endIndex + 2).trim();
          if (trailing) {
            paragraphLines.push(trailing);
          }
        } else {
          inMathBlock = true;
          const firstLine = rest.trim();
          if (firstLine) {
            mathLines.push(firstLine);
          }
        }

        continue;
      }

      if (!trimmed) {
        flushParagraph();
        closeList();
        continue;
      }

      if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
        flushParagraph();
        closeList();
        html.push("<hr>");
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (heading?.[1] && heading[2]) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        const headingHTML = this.renderInlineMarkdown(heading[2].trim());
        const headingText =
          this.stripHTMLTags(headingHTML) || `section-${level}`;
        const headingAnchorID = this.createAnchorIDFromText(
          headingText,
          usedAnchorIDs,
        );
        tocEntries.push({
          level,
          title: headingText,
          anchorId: headingAnchorID,
        });
        html.push(
          `<h${level} id="${this.escapeAttribute(headingAnchorID)}">${headingHTML}</h${level}>`,
        );
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered?.[1]) {
        appendListItem("ul", unordered[1].trim());
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered?.[1]) {
        appendListItem("ol", ordered[1].trim());
        continue;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push(
          `<blockquote><p>${this.renderInlineMarkdown(quote[1].trim())}</p></blockquote>`,
        );
        continue;
      }

      closeList();
      paragraphLines.push(trimmed);
    }

    if (inCodeBlock) {
      html.push(
        `<pre><code>${this.escapeHTML(codeLines.join("\n"))}</code></pre>`,
      );
    }

    if (inMathBlock) {
      flushMathBlock();
    }

    flushParagraph();
    closeList();
    return {
      html: html.join("\n"),
      tocEntries,
    };
  }

  private static renderInlineMarkdown(text: string): string {
    if (!text) {
      return "";
    }

    let output = text;
    const codeTokens: string[] = [];
    const mathTokens: string[] = [];

    output = output.replace(/`([^`]+)`/g, (_match, codeText: string) => {
      const token = `@@CODE_${codeTokens.length}@@`;
      codeTokens.push(`<code>${this.escapeHTML(codeText)}</code>`);
      return token;
    });

    output = this.replaceBracketMath(output, mathTokens);
    output = this.replaceDollarInlineMath(output, mathTokens);

    output = this.escapeHTML(output);

    output = output.replace(
      /\[([^\]]+)\]\(([^\s)]+)\)/g,
      (_match, label: string, href: string) => {
        const safeHref = href.trim();
        if (!this.isAllowedHref(safeHref)) {
          return `${label} (${safeHref})`;
        }
        return `<a href="${this.escapeAttribute(safeHref)}">${label}</a>`;
      },
    );

    output = output
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/&lt;(\/?(?:sup|sub|strong|b|em|i|code|br))&gt;/gi, "<$1>");

    for (let i = 0; i < mathTokens.length; i++) {
      output = output.replace(`@@MATH_${i}@@`, mathTokens[i]);
    }

    for (let i = 0; i < codeTokens.length; i++) {
      output = output.replace(`@@CODE_${i}@@`, codeTokens[i]);
    }

    return output;
  }

  private static renderMathExpression(
    expression: string,
    displayMode: boolean,
  ): string {
    const latex = expression.trim();
    if (!latex) {
      return "";
    }

    try {
      const mathHTML = katex.renderToString(latex, {
        throwOnError: false,
        displayMode,
        strict: "ignore",
        output: "mathml",
      });
      if (displayMode) {
        return mathHTML;
      }
      return `<span class="math-inline">${mathHTML}</span>`;
    } catch (_error) {
      const fallback = this.escapeHTML(latex);
      if (displayMode) {
        return `<div class="math-fallback">$$${fallback}$$</div>`;
      }
      return `<span class="math-fallback">$${fallback}$</span>`;
    }
  }

  private static pushMathToken(
    tokens: string[],
    expression: string,
    displayMode: boolean,
  ): string {
    const token = `@@MATH_${tokens.length}@@`;
    tokens.push(this.renderMathExpression(expression, displayMode));
    return token;
  }

  private static replaceBracketMath(text: string, tokens: string[]): string {
    let output = text;
    output = output.replace(/\\\((.+?)\\\)/g, (_match, expression: string) =>
      this.pushMathToken(tokens, expression, false),
    );
    output = output.replace(/\\\[(.+?)\\\]/g, (_match, expression: string) =>
      this.pushMathToken(tokens, expression, true),
    );
    return output;
  }

  private static replaceDollarInlineMath(
    text: string,
    tokens: string[],
  ): string {
    let result = "";
    let cursor = 0;

    while (cursor < text.length) {
      const start = text.indexOf("$", cursor);
      if (start < 0) {
        result += text.slice(cursor);
        break;
      }

      if (start > 0 && text[start - 1] === "\\") {
        result += text.slice(cursor, start - 1);
        result += "$";
        cursor = start + 1;
        continue;
      }

      if (start + 1 < text.length && text[start + 1] === "$") {
        result += text.slice(cursor, start + 2);
        cursor = start + 2;
        continue;
      }

      let end = start + 1;
      let found = false;
      while (end < text.length) {
        if (text[end] === "$" && text[end - 1] !== "\\") {
          if (end + 1 < text.length && text[end + 1] === "$") {
            end += 1;
            continue;
          }
          found = true;
          break;
        }
        end += 1;
      }

      if (!found) {
        result += text.slice(cursor);
        break;
      }

      const expression = text.slice(start + 1, end).trim();
      if (!expression) {
        result += text.slice(cursor, end + 1);
        cursor = end + 1;
        continue;
      }

      result += text.slice(cursor, start);
      result += this.pushMathToken(tokens, expression, false);
      cursor = end + 1;
    }

    return result;
  }

  private static isAllowedHref(href: string): boolean {
    return href.startsWith("#") || /^https?:\/\//i.test(href);
  }

  private static escapeHTML(raw: string): string {
    return raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private static escapeAttribute(raw: string): string {
    return this.escapeHTML(raw).replace(/\n/g, " ");
  }

  private static createTempDirectory(): nsIFile {
    const dir = Zotero.getTempDirectory();
    dir.append(
      `${config.addonRef}-translated-pdf-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    );
    Zotero.File.createDirectoryIfMissing(dir.path);
    return dir;
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
      ztoolkit.log("remove export temp directory failed", dirPath, error);
    }
  }

  private static getAddonPrefString(prefKey: string, fallback = ""): string {
    const value = Zotero.Prefs.get(`${config.prefsPrefix}.${prefKey}`, true);
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized || fallback;
    }
    if (value === undefined || value === null || value === false) {
      return fallback;
    }
    return String(value).trim() || fallback;
  }

  private static getAddonPrefNumber(
    prefKey: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.getAddonPrefString(prefKey, String(fallback));
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return fallback;
    }
    const clamped = Math.min(max, Math.max(min, value));
    return Math.round(clamped * 100) / 100;
  }

  private static sanitizeCSSValue(raw: string, fallback: string): string {
    const cleaned = raw.replace(/[{};<>\n\r]/g, " ").trim();
    if (!cleaned) {
      return fallback;
    }
    return cleaned.slice(0, 300);
  }

  private static getPdfStyleOptions(): PdfStyleOptions {
    const fontFamilyRaw = this.getAddonPrefString(
      PDF_EXPORT_PREF_KEYS.fontFamily,
      PDF_STYLE_DEFAULTS.fontFamily,
    );

    return {
      fontFamily: this.sanitizeCSSValue(
        fontFamilyRaw,
        PDF_STYLE_DEFAULTS.fontFamily,
      ),
      fontSizePt: this.getAddonPrefNumber(
        PDF_EXPORT_PREF_KEYS.fontSizePt,
        PDF_STYLE_DEFAULTS.fontSizePt,
        8,
        24,
      ),
      bodyWidthPercent: this.getAddonPrefNumber(
        PDF_EXPORT_PREF_KEYS.bodyWidthPercent,
        PDF_STYLE_DEFAULTS.bodyWidthPercent,
        60,
        100,
      ),
      paragraphIndentEm: this.getAddonPrefNumber(
        PDF_EXPORT_PREF_KEYS.paragraphIndentEm,
        PDF_STYLE_DEFAULTS.paragraphIndentEm,
        0,
        6,
      ),
    };
  }

  private static getConfiguredHeadlessBrowserPath(): string {
    return this.getAddonPrefString(
      PDF_EXPORT_PREF_KEYS.headlessBrowserPath,
      "",
    );
  }

  private static async printHTMLToPDF(
    htmlPath: string,
    outputPath: string,
  ): Promise<void> {
    try {
      await Zotero.File.removeIfExists(outputPath);
    } catch (error) {
      ztoolkit.log("remove old pdf output failed", outputPath, error);
    }
    try {
      await exportPdfByHeadlessBrowser(
        htmlPath,
        outputPath,
        this.getConfiguredHeadlessBrowserPath(),
      );
      return;
    } catch (headlessError) {
      const reason = this.getErrorMessage(headlessError);
      throw new Error(
        `${this.t("export-pdf-error-print-failed")}: headless-browser=${reason}`,
      );
    }
  }

  private static sanitizeFileName(rawName: string): string {
    const fileName = rawName
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    if (!fileName) {
      return "translation";
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
    const millisecond = String(date.getMilliseconds()).padStart(3, "0");
    return `${year}${month}${day}-${hour}${minute}${second}${millisecond}`;
  }

  private static async savePdfAttachment(
    item: Zotero.Item,
    file: nsIFile,
  ): Promise<void> {
    const title = item.getDisplayTitle() || item.key;
    const importOptions: _ZoteroTypes.Attachments.OptionsFromFile & {
      libraryID?: number;
    } = {
      file,
      title: `Translated PDF - ${title}`,
      contentType: "application/pdf",
    };

    if (item.isRegularItem()) {
      importOptions.parentItemID = item.id;
    } else {
      importOptions.libraryID = item.libraryID;
    }

    await Zotero.Attachments.importFromFile(importOptions);
  }

  private static t(
    key: string,
    options?: {
      args?: Record<string, unknown>;
      branch?: string;
    },
  ): string {
    if (options) {
      return getString(key as any, options as any);
    }
    return getString(key as any);
  }

  private static openStatusWindow(title: string): ExportStatusWindow {
    const shortTitle = title.length > 60 ? `${title.slice(0, 57)}...` : title;
    const popup = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: this.t("export-pdf-working", {
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

    if (typeof error === "number" && Number.isFinite(error)) {
      return `error code ${error}`;
    }

    if (typeof error === "string" && error.trim()) {
      return error;
    }

    if (error && typeof error === "object") {
      const payload = error as Record<string, unknown>;
      const parts: string[] = [];

      if (typeof payload.name === "string" && payload.name.trim()) {
        parts.push(payload.name.trim());
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        parts.push(payload.message.trim());
      }
      if (
        typeof payload.result === "number" &&
        Number.isFinite(payload.result)
      ) {
        parts.push(`nsresult 0x${(payload.result >>> 0).toString(16)}`);
      }
      if (typeof payload.code === "number" && Number.isFinite(payload.code)) {
        parts.push(`code ${payload.code}`);
      }
      if (parts.length) {
        return parts.join(": ");
      }

      if (typeof (payload as { toString?: unknown }).toString === "function") {
        const rendered = String(error);
        if (rendered && rendered !== "[object Object]") {
          return rendered;
        }
      }

      try {
        const json = JSON.stringify(payload);
        if (json && json !== "{}") {
          return json;
        }
      } catch (_jsonError) {
        // Ignore serialization errors.
      }
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
