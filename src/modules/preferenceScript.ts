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
import { getSecret, setSecret } from "../utils/secureStore";

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

  if (
    !apiKeyInput ||
    !baseURLInput ||
    !promptTextarea ||
    !mineruTokenInput ||
    !mineruBaseURLInput ||
    !mineruModelVersionInput
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

  apiKeyInput.onchange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const secret = target.value.trim();
    target.value = secret;
    await setSecret("deepseek-api-key", secret, DEEPSEEK_PREF_KEYS.apiKey);
  };

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

  mineruTokenInput.onchange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const secret = target.value.trim();
    target.value = secret;
    await setSecret("mineru-api-token", secret, MINERU_PREF_KEYS.token);
  };

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
}
