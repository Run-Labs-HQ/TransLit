import { config } from "../../package.json";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_PROMPT_TEMPLATE,
  PREF_KEYS as DEEPSEEK_PREF_KEYS,
} from "./fullTextTranslate";
import {
  MINERU_DEFAULT_BASE_URL,
  MINERU_DEFAULT_MODEL_VERSION,
  MINERU_PREF_KEYS,
} from "./mineruExtract";
import {
  getMenuVisibilityPref,
  MENU_VISIBILITY_DEFAULTS,
  MENU_VISIBILITY_PREF_KEYS,
} from "./menuVisibility";
import { getSecret, setSecret } from "../utils/secureStore";

const PDF_EXPORT_PREF_KEYS = {
  headlessBrowserPath: "export-pdf-headless-browser-path",
  fontFamily: "export-pdf-font-family",
  fontSizePt: "export-pdf-font-size-pt",
  bodyWidthPercent: "export-pdf-body-width-percent",
  paragraphIndentEm: "export-pdf-paragraph-indent-em",
} as const;

const PDF_STYLE_DEFAULTS = {
  fontFamily: "'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', serif",
  fontSizePt: "12",
  bodyWidthPercent: "100",
  paragraphIndentEm: "2",
} as const;

function getPrefString(prefKey: string, fallback = ""): string {
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

function setPrefString(prefKey: string, value: string): void {
  Zotero.Prefs.set(`${config.prefsPrefix}.${prefKey}`, value, true);
}

function getPrefBoolean(prefKey: string, fallback: boolean): boolean {
  return getMenuVisibilityPref(prefKey, fallback);
}

function setPrefBoolean(prefKey: string, value: boolean): void {
  Zotero.Prefs.set(`${config.prefsPrefix}.${prefKey}`, value, true);
}

export async function registerPrefsScripts(win: Window): Promise<void> {
  const doc = win.document;
  const apiKeyInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-deepseek-api-key`,
  ) as HTMLInputElement | null;
  const baseURLInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-deepseek-base-url`,
  ) as HTMLInputElement | null;
  const promptTextarea = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-deepseek-prompt`,
  ) as HTMLTextAreaElement | null;
  const mineruTokenInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-mineru-api-token`,
  ) as HTMLInputElement | null;
  const mineruBaseURLInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-mineru-base-url`,
  ) as HTMLInputElement | null;
  const mineruModelVersionInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-mineru-model-version`,
  ) as HTMLInputElement | null;
  const mineruPdfRenderCommandInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-mineru-pdf-render-command`,
  ) as HTMLInputElement | null;
  const exportHeadlessBrowserPathInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-export-headless-browser-path`,
  ) as HTMLInputElement | null;
  const exportFontFamilyInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-export-font-family`,
  ) as HTMLInputElement | null;
  const exportFontSizePtInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-export-font-size-pt`,
  ) as HTMLInputElement | null;
  const exportBodyWidthPercentInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-export-body-width-percent`,
  ) as HTMLInputElement | null;
  const exportParagraphIndentEmInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-export-paragraph-indent-em`,
  ) as HTMLInputElement | null;
  const menuShowOneClickInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-one-click-workflow`,
  ) as HTMLInputElement | null;
  const menuShowTranslateInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-translate-fulltext`,
  ) as HTMLInputElement | null;
  const menuShowTranslateDefaultPromptInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-translate-fulltext-default-prompt`,
  ) as HTMLInputElement | null;
  const menuShowMineruExtractInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-mineru-extract`,
  ) as HTMLInputElement | null;
  const menuShowMineruViewInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-mineru-view`,
  ) as HTMLInputElement | null;
  const menuShowExportPdfInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-menu-show-export-translated-pdf`,
  ) as HTMLInputElement | null;

  if (
    !apiKeyInput ||
    !baseURLInput ||
    !promptTextarea ||
    !mineruTokenInput ||
    !mineruBaseURLInput ||
    !mineruModelVersionInput ||
    !mineruPdfRenderCommandInput ||
    !exportHeadlessBrowserPathInput ||
    !exportFontFamilyInput ||
    !exportFontSizePtInput ||
    !exportBodyWidthPercentInput ||
    !exportParagraphIndentEmInput ||
    !menuShowOneClickInput ||
    !menuShowTranslateInput ||
    !menuShowTranslateDefaultPromptInput ||
    !menuShowMineruExtractInput ||
    !menuShowMineruViewInput ||
    !menuShowExportPdfInput
  ) {
    ztoolkit.log("Preference elements not found");
    return;
  }

  apiKeyInput.value = await getSecret(
    "deepseek-api-key",
    DEEPSEEK_PREF_KEYS.apiKey,
  );
  baseURLInput.value = getPrefString(
    DEEPSEEK_PREF_KEYS.baseURL,
    DEFAULT_DEEPSEEK_BASE_URL,
  );
  promptTextarea.value = getPrefString(
    DEEPSEEK_PREF_KEYS.prompt,
    DEFAULT_PROMPT_TEMPLATE,
  );
  mineruTokenInput.value = await getSecret(
    "mineru-api-token",
    MINERU_PREF_KEYS.token,
  );
  mineruBaseURLInput.value = getPrefString(
    MINERU_PREF_KEYS.baseURL,
    MINERU_DEFAULT_BASE_URL,
  );
  mineruModelVersionInput.value = getPrefString(
    MINERU_PREF_KEYS.modelVersion,
    MINERU_DEFAULT_MODEL_VERSION,
  );
  mineruPdfRenderCommandInput.value = getPrefString(
    MINERU_PREF_KEYS.pdfRenderCommand,
    "",
  );
  exportHeadlessBrowserPathInput.value = getPrefString(
    PDF_EXPORT_PREF_KEYS.headlessBrowserPath,
    "",
  );
  exportFontFamilyInput.value = getPrefString(
    PDF_EXPORT_PREF_KEYS.fontFamily,
    PDF_STYLE_DEFAULTS.fontFamily,
  );
  exportFontSizePtInput.value = getPrefString(
    PDF_EXPORT_PREF_KEYS.fontSizePt,
    PDF_STYLE_DEFAULTS.fontSizePt,
  );
  exportBodyWidthPercentInput.value = getPrefString(
    PDF_EXPORT_PREF_KEYS.bodyWidthPercent,
    PDF_STYLE_DEFAULTS.bodyWidthPercent,
  );
  exportParagraphIndentEmInput.value = getPrefString(
    PDF_EXPORT_PREF_KEYS.paragraphIndentEm,
    PDF_STYLE_DEFAULTS.paragraphIndentEm,
  );
  menuShowOneClickInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.oneClickWorkflow,
    MENU_VISIBILITY_DEFAULTS.oneClickWorkflow,
  );
  menuShowTranslateInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.translateFullText,
    MENU_VISIBILITY_DEFAULTS.translateFullText,
  );
  menuShowTranslateDefaultPromptInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.translateFullTextDefaultPrompt,
    MENU_VISIBILITY_DEFAULTS.translateFullTextDefaultPrompt,
  );
  menuShowMineruExtractInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.mineruExtract,
    MENU_VISIBILITY_DEFAULTS.mineruExtract,
  );
  menuShowMineruViewInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.mineruView,
    MENU_VISIBILITY_DEFAULTS.mineruView,
  );
  menuShowExportPdfInput.checked = getPrefBoolean(
    MENU_VISIBILITY_PREF_KEYS.exportTranslatedPdf,
    MENU_VISIBILITY_DEFAULTS.exportTranslatedPdf,
  );

  const bindSecretInputHandlers = (
    input: HTMLInputElement,
    secretName: string,
    legacyPrefKey: string,
  ) => {
    let debounceTimer: number | null = null;

    const persist = async () => {
      const secret = input.value.trim();
      input.value = secret;
      await setSecret(secretName, secret, legacyPrefKey);
    };

    const schedulePersist = () => {
      if (debounceTimer !== null) {
        win.clearTimeout(debounceTimer);
      }
      debounceTimer = win.setTimeout(() => {
        debounceTimer = null;
        void persist();
      }, 300);
    };

    input.oninput = () => {
      schedulePersist();
    };

    input.onchange = () => {
      void persist();
    };
  };

  bindSecretInputHandlers(
    apiKeyInput,
    "deepseek-api-key",
    DEEPSEEK_PREF_KEYS.apiKey,
  );

  baseURLInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const baseURL = target.value.trim() || DEFAULT_DEEPSEEK_BASE_URL;
    target.value = baseURL;
    setPrefString(DEEPSEEK_PREF_KEYS.baseURL, baseURL);
  };

  promptTextarea.onchange = (event: Event) => {
    const target = event.target as HTMLTextAreaElement;
    const promptTemplate = target.value.trim() || DEFAULT_PROMPT_TEMPLATE;
    target.value = promptTemplate;
    setPrefString(DEEPSEEK_PREF_KEYS.prompt, promptTemplate);
  };

  bindSecretInputHandlers(
    mineruTokenInput,
    "mineru-api-token",
    MINERU_PREF_KEYS.token,
  );

  mineruBaseURLInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const baseURL = target.value.trim() || MINERU_DEFAULT_BASE_URL;
    target.value = baseURL;
    setPrefString(MINERU_PREF_KEYS.baseURL, baseURL);
  };

  mineruModelVersionInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const modelVersion = target.value.trim() || MINERU_DEFAULT_MODEL_VERSION;
    target.value = modelVersion;
    setPrefString(MINERU_PREF_KEYS.modelVersion, modelVersion);
  };

  mineruPdfRenderCommandInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const command = target.value.trim();
    target.value = command;
    setPrefString(MINERU_PREF_KEYS.pdfRenderCommand, command);
  };

  exportHeadlessBrowserPathInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const browserPath = target.value.trim();
    target.value = browserPath;
    setPrefString(PDF_EXPORT_PREF_KEYS.headlessBrowserPath, browserPath);
  };

  exportFontFamilyInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const fontFamily = target.value.trim() || PDF_STYLE_DEFAULTS.fontFamily;
    target.value = fontFamily;
    setPrefString(PDF_EXPORT_PREF_KEYS.fontFamily, fontFamily);
  };

  exportFontSizePtInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value.trim());
    const fontSize = Number.isFinite(value)
      ? String(Math.min(24, Math.max(8, value)))
      : PDF_STYLE_DEFAULTS.fontSizePt;
    target.value = fontSize;
    setPrefString(PDF_EXPORT_PREF_KEYS.fontSizePt, fontSize);
  };

  exportBodyWidthPercentInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value.trim());
    const width = Number.isFinite(value)
      ? String(Math.min(100, Math.max(60, value)))
      : PDF_STYLE_DEFAULTS.bodyWidthPercent;
    target.value = width;
    setPrefString(PDF_EXPORT_PREF_KEYS.bodyWidthPercent, width);
  };

  exportParagraphIndentEmInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value.trim());
    const indent = Number.isFinite(value)
      ? String(Math.min(6, Math.max(0, value)))
      : PDF_STYLE_DEFAULTS.paragraphIndentEm;
    target.value = indent;
    setPrefString(PDF_EXPORT_PREF_KEYS.paragraphIndentEm, indent);
  };

  menuShowOneClickInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(MENU_VISIBILITY_PREF_KEYS.oneClickWorkflow, target.checked);
  };

  menuShowTranslateInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(MENU_VISIBILITY_PREF_KEYS.translateFullText, target.checked);
  };

  menuShowTranslateDefaultPromptInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(
      MENU_VISIBILITY_PREF_KEYS.translateFullTextDefaultPrompt,
      target.checked,
    );
  };

  menuShowMineruExtractInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(MENU_VISIBILITY_PREF_KEYS.mineruExtract, target.checked);
  };

  menuShowMineruViewInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(MENU_VISIBILITY_PREF_KEYS.mineruView, target.checked);
  };

  menuShowExportPdfInput.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    setPrefBoolean(
      MENU_VISIBILITY_PREF_KEYS.exportTranslatedPdf,
      target.checked,
    );
  };
}
