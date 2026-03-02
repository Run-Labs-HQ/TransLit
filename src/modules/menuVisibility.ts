import { config } from "../../package.json";

export const MENU_VISIBILITY_PREF_KEYS = {
  oneClickWorkflow: "menu-show-one-click-workflow",
  translateFullText: "menu-show-translate-fulltext",
  translateFullTextDefaultPrompt: "menu-show-translate-fulltext-default-prompt",
  mineruExtract: "menu-show-mineru-extract",
  mineruView: "menu-show-mineru-view",
  exportTranslatedPdf: "menu-show-export-translated-pdf",
} as const;

export const MENU_VISIBILITY_DEFAULTS = {
  oneClickWorkflow: true,
  translateFullText: false,
  translateFullTextDefaultPrompt: false,
  mineruExtract: false,
  mineruView: false,
  exportTranslatedPdf: false,
} as const;

export function getMenuVisibilityPref(
  prefKey: string,
  fallback: boolean,
): boolean {
  const value = Zotero.Prefs.get(`${config.prefsPrefix}.${prefKey}`, true);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return fallback;
}
