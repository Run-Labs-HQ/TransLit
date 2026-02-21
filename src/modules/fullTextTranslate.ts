import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getSecret } from "../utils/secureStore";

const MENU_ID = `zotero-itemmenu-${config.addonRef}-translate-fulltext`;
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
  "## Objective",
  "",
  "将我提供的英文学术文献内容翻译成流畅、准确的简体中文，并使用通用标准 Markdown 进行排版。输出结果需满足直接在任意 Markdown 编辑器中复制、阅读与做笔记的需求。",
  "",
  "## Core Guidelines (核心原则)",
  "",
  "1. **学术严谨与术语一致**",
  "",
  "   - 保持客观、严谨的科学语调，符合中文学术写作规范。",
  "   - 遇到关键专业术语、缩写、材料名称或专有名词，在**首次出现**的中文译名后用半角括号保留英文原文，例如：水性聚氨酯 (Waterborne Polyurethane, WPU)。",
  "   - 同一术语在全文必须保持译法一致。",
  "",
  "2. **长难句与语境处理**",
  "",
  "   - 自动修复因 OCR 导致的断行、连字符断词等轻微错误。",
  "   - 在不改变原意与逻辑的前提下，拆分或重组超长难句，使其符合中文学术阅读习惯。",
  "",
  "## Formatting Constraints (排版与格式规范)",
  "",
  "1. **图注与表注处理（绝对规则）**",
  "   - 密切关注原文的图注与表注（如 Figure 1, Table 1），**准确提取序号**。",
  "   - **不要**在正文翻译中留下任何图片/表格占位符。",
  "   - **所有图注与表注必须统一集中在全文末尾输出**，按序号递增排列。",
  "   - 文末格式严格如下：",
  "",
  "     **图 1：** [此处为图注中文翻译，如有术语首次出现同样保留英文，字体不用加粗]",
  "     **表 1：** [此处为表注中文翻译，字体不用加粗]",
  "",
  "2. **文献引用格式（红线要求，100% 完整保留）**",
  "",
  "   - **数字标号引用**（如 `[1]`, `[3-5]`）：必须渲染为 HTML 上标，格式为 `<sup>[1]</sup>`。",
  "   - **作者-年份引用**（如 `(Smith et al., 2026)`）：保持原样纯文本输出，**不**做上标，**不**翻译括号内的作者名与年份。",
  "   - 中英文语序调整时，确保引用标号准确锚定在对应核心概念之后，或置于句末标点之前。",
  "   - **全局省略参考文献列表**：如果原文末尾包含 Reference/Bibliography 部分，请在输出时彻底抛弃，不予翻译和输出。",
  "",
  "3. **公式处理**",
  "   - 所有数学/物理公式转换为标准 LaTeX 语法。",
  "   - 行内公式：`$公式$`（符号与公式之间无空格）。",
  "   - 独立公式：`$$公式$$`。",
  "   - 保留原公式符号、上下标、单位与编号（如 `(1)` 放在同行右侧）。",
  "",
  "4. **Markdown 标记符边界（防止渲染失效）**",
  "   - 格式标记符（如 `**加粗**`、`*斜体*`）内部**绝对不能**有空格。错误示范：`** 加粗 **`；正确示范：`**加粗**`。",
  "   - 当格式化文本与常规文本、标点符号相连时，确保遵循标准 Markdown 解析规则，避免在标点符号前异常使用空格。",
  "   - 严格保留原文献的标题层级（`#`、`##`）、公式编号与段落划分。",
  "",
  "## Workflow",
  "",
  "1. 接收输入的英文文献内容。",
  "2. 翻译并排版正文文本，保留正确的引用格式和 LaTeX 公式。",
  "3. 收集所有图注/表注并翻译。",
  "4. **直接输出 Markdown 纯文本结果。不要任何寒暄、不要解释说明、不要包含参考文献列表。正文结束后，紧接着输出集中的图/表注。**",
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
      commandListener: async () => {
        await this.translateSelectedItems();
      },
    });
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

  private static async translateSelectedItems(): Promise<void> {
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

          const promptTemplate = this.getPrefString(
            PREF_KEYS.prompt,
            DEFAULT_PROMPT_TEMPLATE,
          );
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
