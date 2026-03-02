import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getSecret } from "../utils/secureStore";
import {
  getMenuVisibilityPref,
  MENU_VISIBILITY_DEFAULTS,
  MENU_VISIBILITY_PREF_KEYS,
} from "./menuVisibility";

const MENU_ID = `zotero-itemmenu-${config.addonRef}-translate-fulltext`;
const MENU_ID_DEFAULT_PROMPT = `zotero-itemmenu-${config.addonRef}-translate-fulltext-default-prompt`;
const DEEPSEEK_MODEL = "deepseek-reasoner";
const DEEPSEEK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const PREF_KEYS = {
  apiKey: "deepseekAPIKey",
  baseURL: "deepseekBaseURL",
  prompt: "deepseekPrompt",
} as const;

const DEFAULT_PROMPT_TEMPLATE = [
  "# Role: 资深学术翻译专家与 Markdown 排版专家",
  "",
  "## Profile",
  "",
  "您是一位精通英文学术文献翻译与结构化排版的专家。您的核心任务是将用户提供的英文学术内容，精准地转化为符合中文学术写作规范的简体中文，并运用标准的 Markdown 语法进行清晰、专业的排版，确保输出文档可直接用于阅读、编辑与知识整理。",
  "",
  "## Skills",
  "",
  "1. **精准翻译与术语管理**：准确翻译学术文本，对关键术语、材料、方法名称等保持全文译法一致，并在首次出现时附注英文原文。",
  "2. **句子结构与逻辑重组**：擅长处理英文长难句，能将其拆解重组为符合中文表达习惯的流畅句式，同时严格保持原意与逻辑关系。",
  "3. **格式规范与自动化处理**：精通学术文献中的图表引用、文献引用、数学公式等特殊元素的处理规则，并能将其自动化、标准化地转换为目标格式。",
  "4. **Markdown 深度应用**：熟练使用 Markdown 语法进行文档结构化，并严格遵循语法边界规则，确保文档在任何兼容编辑器中都能被正确渲染。",
  "",
  "## Rules",
  "",
  "1. 翻译必须保持客观、严谨的学术语调。",
  "2. 所有输出均为纯 Markdown 文本，不包含任何解释性、寒暄性语言。",
  "3. 必须严格遵循下方“核心工作规范”中的所有格式与内容要求。",
  "",
  "## 核心工作规范",
  "",
  "### 翻译范围",
  "标题",
  "摘要",
  "正文",
  "图表注",
  "",
  "忽略作者、机构以及其他与正文无关的信息。",
  "正文里不要有表图注，表图注全部放在正文后面。",
  "有的文献有方法章节也算作正文。",
  "不需要翻译表格的内容。",
  "",
  "### 翻译与正文排版",
  "1. **术语处理**：关键专业术语、缩写、材料名称或专有名词，在**首次出现**时，其中文译名后需用半角括号附上英文原文，例如：水性聚氨酯 (Waterborne Polyurethane, WPU)。同一术语全文译法必须一致。",
  "2. **句子优化**：自动修复因 OCR 导致的断行、连字符错误。在不改变原意与逻辑的前提下，可拆分或重组超长英文句子，使其符合中文阅读习惯。",
  "3. **文献引用格式（必须严格遵守）**：",
  "   - **数字标号引用** (如 `[1]`, `[3-5]`)：必须渲染为 HTML 上标，格式为 `<sup>[1]</sup>`。",
  "   - **作者-年份引用** (如 `(Smith et al., 2026)`)：保持原样纯文本输出，**不**做上标，**不**翻译括号内的作者名与年份。",
  "   - **全局省略参考文献列表**：若原文末尾有“References”或“Bibliography”章节，请彻底抛弃，不予翻译和输出。",
  "4. **公式处理**：所有数学/物理公式需转换为标准 LaTeX 语法。",
  "   - 行内公式：使用 `$公式$`（符号与公式间无空格）。",
  "   - 独立公式：使用 `$$公式$$`，并可保留原编号 (如 `(1)`)。",
  "5. **图表引用占位符（重要）**：正文翻译中如遇图、表引用 (如 `Figure 1`, `Table 1`)，**不要**留下任何图片/表格占位符或插入语句。仅需准确识别并提取其序号与注释内容，为后续集中处理做准备。",
  "6. **图表引用翻译规范**：",
  "   - **正文中的图表**：`Figure X` / `Table X` 翻译为 **“图 X”** / **“表 X”**。",
  "   - **补充材料中的图表**：`Figure SX` / `Table SX` 翻译为 **“图 SX”** / **“表 SX”**。",
  "",
  "### 文末集中处理图注与表注",
  "1. 在完成全文正文翻译后，**将所有提取到的图注 (Figure Caption) 和表注 (Table Caption) 集中放置在文档末尾**。",
  "2. 按图表类型及序号递增顺序排列。",
  "3. 格式严格如下：",
  "   **图 X：** [此处为图注的完整中文翻译，术语处理原则同正文，不加粗]",
  "   **表 X：** [此处为表注的完整中文翻译，术语处理原则同正文，不加粗]",
  "",
  "### Markdown 格式质检",
  "1. 确保所有 Markdown 标记符边界清晰，内部无多余空格。例如，加粗应为 `**文本**` 而非 `** 文本 **`。",
  "2. 严格保留原文的标题层级结构 (使用 `#`, `##`, `###` 等)。",
  "3. 确保格式化文本与相邻标点符号之间遵循标准语法，避免因空格导致渲染异常。",
  "",
  "",
  "原文如下:",
  "{{content}}",
].join("\n");

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface DeepSeekStreamResponse {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface StreamStatusController {
  onChunk(contentLength: number): void;
  close(): void;
}

export class FullTextTranslateFactory {
  private static menuRegistered = false;
  private static translating = false;

  static registerItemMenu(): void {
    if (this.menuRegistered) {
      return;
    }

    this.menuRegistered = true;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: MENU_ID,
      label: getString("menuitem-translate-fulltext"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.translateFullText,
          MENU_VISIBILITY_DEFAULTS.translateFullText,
        ),
      commandListener: async () => {
        await this.translateSelectedItems();
      },
    });

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: MENU_ID_DEFAULT_PROMPT,
      label: getString("menuitem-translate-fulltext-default-prompt"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.translateFullTextDefaultPrompt,
          MENU_VISIBILITY_DEFAULTS.translateFullTextDefaultPrompt,
        ),
      commandListener: async () => {
        await this.translateSelectedItems({
          forceDefaultPrompt: true,
        });
      },
    });
  }

  static async runSelectedItems(options?: {
    forceDefaultPrompt?: boolean;
  }): Promise<void> {
    await this.translateSelectedItems(options);
  }

  private static getPrefString(prefKey: string, fallback = ""): string {
    const pref = Zotero.Prefs.get(`${config.prefsPrefix}.${prefKey}`, true);
    if (typeof pref === "string") {
      if (!pref.trim()) {
        return fallback;
      }
      return pref;
    }
    if (pref === undefined || pref === null || pref === false) {
      return fallback;
    }
    return String(pref);
  }

  private static async translateSelectedItems(options?: {
    forceDefaultPrompt?: boolean;
  }): Promise<void> {
    const forceDefaultPrompt = Boolean(options?.forceDefaultPrompt);

    if (this.translating) {
      this.showToast(getString("translate-busy"), "default");
      return;
    }

    const apiKey = (
      await getSecret("deepseek-api-key", PREF_KEYS.apiKey)
    ).trim();
    if (!apiKey) {
      this.showToast(getString("translate-error-no-api-key"), "error");
      return;
    }

    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(getString("translate-error-no-selection"), "error");
      return;
    }

    this.translating = true;
    this.showToast(getString("translate-start"), "default");

    const failedItems: string[] = [];
    let successCount = 0;

    try {
      for (const selectedItem of selectedItems) {
        const targetItem = this.resolveTargetItem(selectedItem);
        try {
          const pdfAttachment = await this.getPdfAttachment(targetItem);
          if (!pdfAttachment) {
            throw new Error(getString("translate-error-no-pdf"));
          }

          const rawText = await this.extractPdfText(pdfAttachment);
          if (!rawText.trim()) {
            throw new Error(getString("translate-error-empty-text"));
          }

          const processedText = this.removeReferencesSection(rawText);

          const promptTemplate = forceDefaultPrompt
            ? DEFAULT_PROMPT_TEMPLATE
            : this.getPrefString(PREF_KEYS.prompt, DEFAULT_PROMPT_TEMPLATE);
          const prompt = this.buildPrompt(
            promptTemplate,
            targetItem,
            processedText,
          );

          const targetTitle = targetItem.getDisplayTitle() || targetItem.key;
          const streamStatus = this.startStreamStatus(targetTitle);
          let markdown = "";
          try {
            markdown = await this.requestDeepSeek(
              prompt,
              apiKey,
              (chunkLength) => {
                streamStatus.onChunk(chunkLength);
              },
            );
          } finally {
            streamStatus.close();
          }

          await this.saveMarkdownAsAttachment(targetItem, markdown);
          successCount += 1;
        } catch (error) {
          const reason = this.getErrorMessage(error);
          ztoolkit.log("translate failed", targetItem.id, error);
          this.showToast(
            getString("translate-item-failed", {
              args: {
                title: targetItem.getDisplayTitle() || targetItem.key,
                reason,
              },
            }),
            "error",
          );
          failedItems.push(targetItem.getDisplayTitle());
        }
      }
    } finally {
      this.translating = false;
    }

    if (successCount > 0 && failedItems.length === 0) {
      this.showToast(
        getString("translate-success", {
          args: { count: successCount },
        }),
        "success",
      );
      return;
    }

    if (successCount > 0) {
      this.showToast(
        getString("translate-partial-success", {
          args: {
            success: successCount,
            failed: failedItems.length,
          },
        }),
        "default",
      );
      return;
    }

    this.showToast(getString("translate-error-all-failed"), "error");
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

  private static async extractPdfText(
    attachment: Zotero.Item,
  ): Promise<string> {
    const fullTextApi = Zotero.FullText || Zotero.Fulltext;
    await fullTextApi.indexItems([attachment.id], {
      complete: true,
      ignoreErrors: true,
    });

    const cacheFile = fullTextApi.getItemCacheFile(attachment);
    if (!cacheFile || !cacheFile.exists()) {
      throw new Error(getString("translate-error-extract-failed"));
    }

    const content = await Zotero.File.getContentsAsync(cacheFile, "utf-8");
    if (typeof content === "string") {
      return content;
    }

    throw new Error(getString("translate-error-extract-failed"));
  }

  private static buildPrompt(
    template: string,
    item: Zotero.Item,
    content: string,
  ): string {
    const title = item.getDisplayTitle() || item.key;
    let prompt = template
      .replaceAll("{{title}}", title)
      .replaceAll("{{itemKey}}", item.key)
      .replaceAll("{{content}}", content);

    if (!template.includes("{{content}}")) {
      prompt = `${prompt}\n\n${content}`;
    }

    return prompt;
  }

  private static removeReferencesSection(content: string): string {
    const lines = content.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) =>
      this.isReferencesHeading(line),
    );
    if (headingIndex <= 0) {
      return content;
    }

    const trimmed = lines.slice(0, headingIndex).join("\n").trim();
    return trimmed || content;
  }

  private static isReferencesHeading(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) {
      return false;
    }

    const normalized = trimmed
      .replace(/[[\](){}]/g, "")
      .replace(/[.:：。]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    if (
      normalized === "references" ||
      normalized === "reference" ||
      normalized === "bibliography" ||
      normalized === "works cited" ||
      normalized === "literature cited" ||
      normalized === "参考文献"
    ) {
      return true;
    }

    return /^(\d+|[ivxlcdm]+)\s+(references|bibliography|works cited|literature cited)$/.test(
      normalized,
    );
  }

  private static getDeepSeekBaseURL(): string {
    const baseURL = this.getPrefString(
      PREF_KEYS.baseURL,
      DEFAULT_DEEPSEEK_BASE_URL,
    ).trim();
    return baseURL.replace(/\/+$/, "") || DEFAULT_DEEPSEEK_BASE_URL;
  }

  private static async requestDeepSeek(
    prompt: string,
    apiKey: string,
    onChunk: (chunkLength: number) => void,
  ): Promise<string> {
    const baseURL = this.getDeepSeekBaseURL();
    const requestBody = {
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    };

    let parsedLength = 0;
    let lineBuffer = "";
    let streamDone = false;
    let streamError = "";
    let translatedContent = "";

    const processSSEText = (text: string): void => {
      if (!text) {
        return;
      }

      lineBuffer += text;
      let lineBreakIndex = lineBuffer.indexOf("\n");
      while (lineBreakIndex !== -1) {
        const rawLine = lineBuffer.slice(0, lineBreakIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(lineBreakIndex + 1);
        lineBreakIndex = lineBuffer.indexOf("\n");

        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data) {
          continue;
        }
        if (data === "[DONE]") {
          streamDone = true;
          continue;
        }

        let payload: DeepSeekStreamResponse;
        try {
          payload = JSON.parse(data) as DeepSeekStreamResponse;
        } catch {
          continue;
        }

        const apiError = payload.error?.message?.trim();
        if (apiError) {
          streamError = apiError;
          continue;
        }

        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) {
          translatedContent += delta;
          onChunk(delta.length);
        }
      }
    };

    const response = await Zotero.HTTP.request(
      "POST",
      `${baseURL}/chat/completions`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        timeout: DEEPSEEK_TIMEOUT_MS,
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          xmlhttp.onprogress = (_event: Event) => {
            const responseText = xmlhttp.responseText || "";
            if (responseText.length <= parsedLength) {
              return;
            }
            const sseText = responseText.slice(parsedLength);
            parsedLength = responseText.length;
            processSSEText(sseText);
          };
        },
      },
    );

    const responseText = response.responseText || "";
    if (responseText.length > parsedLength) {
      const tail = responseText.slice(parsedLength);
      parsedLength = responseText.length;
      processSSEText(tail);
    }

    if (lineBuffer.trim()) {
      processSSEText("\n");
    }

    if (streamError) {
      throw new Error(streamError);
    }

    const streamedResult = translatedContent.trim();
    if (streamedResult) {
      return streamedResult;
    }

    const normalizedResponseText = responseText.trim();
    if (normalizedResponseText && !normalizedResponseText.startsWith("data:")) {
      let payload: DeepSeekResponse | undefined;
      try {
        payload = JSON.parse(normalizedResponseText) as DeepSeekResponse;
      } catch (_error) {
        payload = undefined;
      }

      if (payload) {
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (content) {
          return content;
        }

        const apiError = payload.error?.message;
        if (apiError) {
          throw new Error(apiError);
        }
      }
    }

    if (streamDone) {
      throw new Error(getString("translate-error-empty-response"));
    }

    throw new Error(getString("translate-error-empty-response"));
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

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error.trim()) {
      return error;
    }
    return "unknown error";
  }

  private static startStreamStatus(title: string): StreamStatusController {
    const shortTitle = title.length > 60 ? `${title.slice(0, 57)}...` : title;
    const statusPrefix = getString("translate-streaming", {
      args: { title: shortTitle },
    });
    const startAt = Date.now();
    let chunkCount = 0;
    let charCount = 0;
    let frame = 0;
    let closed = false;
    let timerID: ReturnType<typeof setTimeout> | undefined;
    const setTimeoutFn = ztoolkit.getGlobal("setTimeout") as typeof setTimeout;
    const clearTimeoutFn = ztoolkit.getGlobal(
      "clearTimeout",
    ) as typeof clearTimeout;

    const popup = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: false,
      closeTime: -1,
    })
      .createLine({
        text: statusPrefix,
        type: "default",
      })
      .show(-1);

    const render = () => {
      if (closed) {
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - startAt) / 1000);
      const dots = ".".repeat(frame % 4);
      popup.changeLine({
        idx: 0,
        text: `${statusPrefix}${dots} ${elapsedSeconds}s · ${chunkCount} chunks · ${charCount} chars`,
      });
      frame += 1;
      timerID = setTimeoutFn(render, 500);
    };

    timerID = setTimeoutFn(render, 500);

    return {
      onChunk(contentLength: number) {
        chunkCount += 1;
        charCount += contentLength;
      },
      close() {
        if (closed) {
          return;
        }
        closed = true;
        if (timerID !== undefined) {
          clearTimeoutFn(timerID);
        }
        popup.close();
      },
    };
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

  private static async saveMarkdownAsAttachment(
    item: Zotero.Item,
    markdown: string,
  ): Promise<void> {
    const title = item.getDisplayTitle() || item.key;
    const safeTitle = this.sanitizeFileName(title);
    const timestamp = this.formatTimestamp();
    const filename = `${safeTitle}-deepseek-${timestamp}.md`;

    const tempDir = Zotero.getTempDirectory();
    const tempFile = tempDir.clone();
    tempFile.append(filename);

    await Zotero.File.putContentsAsync(tempFile, markdown, "utf-8");

    const importOptions: _ZoteroTypes.Attachments.OptionsFromFile & {
      libraryID?: number;
    } = {
      file: tempFile,
      title: `DeepSeek Translation - ${title}`,
      contentType: "text/markdown",
      charset: "utf-8",
    };

    if (item.isRegularItem()) {
      importOptions.parentItemID = item.id;
    } else {
      importOptions.libraryID = item.libraryID;
    }

    try {
      await Zotero.Attachments.importFromFile(importOptions);
    } finally {
      await Zotero.File.removeIfExists(tempFile.path);
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

export { DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_PROMPT_TEMPLATE, PREF_KEYS };
