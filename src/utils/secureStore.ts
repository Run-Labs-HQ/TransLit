import { config } from "../../package.json";

const SECRET_ORIGIN = `chrome://${config.addonRef}`;
const SECRET_REALM = `${config.addonName} Secure Store`;
const LEGACY_SECRET_ORIGINS =
  config.addonRef === "addontemplate" ? [] : ["chrome://addontemplate"];
const LEGACY_PREFS_PREFIXES =
  config.prefsPrefix === "extensions.zotero.addontemplate"
    ? []
    : ["extensions.zotero.addontemplate"];

function getLoginManager(): nsILoginManager | null {
  const services = ztoolkit.getGlobal("Services") as
    | { logins?: nsILoginManager }
    | undefined;
  return services?.logins || null;
}

function createLoginInfo(username: string, password: string): nsILoginInfo {
  const loginInfo = (Components.classes as any)[
    "@mozilla.org/login-manager/loginInfo;1"
  ].createInstance(Components.interfaces.nsILoginInfo) as nsILoginInfo;
  loginInfo.init(SECRET_ORIGIN, "", SECRET_REALM, username, password, "", "");
  return loginInfo;
}

function getPrefByPrefix(prefPrefix: string, prefKey: string): string {
  const pref = Zotero.Prefs.get(`${prefPrefix}.${prefKey}`, true);
  if (typeof pref === "string" && pref.trim()) {
    return pref.trim();
  }
  return "";
}

function getLegacyPref(prefKey: string): string {
  for (const prefix of LEGACY_PREFS_PREFIXES) {
    const value = getPrefByPrefix(prefix, prefKey);
    if (value) {
      return value;
    }
  }
  return "";
}

function clearLegacyPref(prefKey: string): void {
  for (const prefix of [config.prefsPrefix, ...LEGACY_PREFS_PREFIXES]) {
    Zotero.Prefs.set(`${prefix}.${prefKey}`, "", true);
  }
}

function getSecretByOrigin(
  loginManager: nsILoginManager,
  origin: string,
  secretName: string,
): nsILoginInfo | null {
  const logins = loginManager.findLogins(
    origin,
    "",
    SECRET_REALM,
  ) as nsILoginInfo[];
  return logins.find((it) => it.username === secretName) || null;
}

async function upsertSecret(
  loginManager: nsILoginManager,
  secretName: string,
  secretValue: string,
): Promise<void> {
  const logins = loginManager.findLogins(
    SECRET_ORIGIN,
    "",
    SECRET_REALM,
  ) as nsILoginInfo[];

  for (const login of logins) {
    if (login.username === secretName) {
      try {
        loginManager.removeLogin(login);
      } catch (error) {
        ztoolkit.log("remove old secret login failed", secretName, error);
      }
    }
  }

  if (!secretValue) {
    return;
  }

  await loginManager.addLoginAsync(createLoginInfo(secretName, secretValue));
}

export async function getSecret(
  secretName: string,
  legacyPrefKey: string,
): Promise<string> {
  const loginManager = getLoginManager();
  if (loginManager) {
    try {
      const currentLogin = getSecretByOrigin(
        loginManager,
        SECRET_ORIGIN,
        secretName,
      );
      if (currentLogin?.password) {
        return currentLogin.password;
      }

      for (const legacyOrigin of LEGACY_SECRET_ORIGINS) {
        const legacyLogin = getSecretByOrigin(
          loginManager,
          legacyOrigin,
          secretName,
        );
        const legacyPassword = legacyLogin?.password?.trim();
        if (!legacyPassword) {
          continue;
        }

        await upsertSecret(loginManager, secretName, legacyPassword);
        try {
          loginManager.removeLogin(legacyLogin as nsILoginInfo);
        } catch (error) {
          ztoolkit.log("remove legacy secret login failed", secretName, error);
        }
        return legacyPassword;
      }
    } catch (error) {
      ztoolkit.log("read secret failed", secretName, error);
    }
  }

  const legacyValue = getLegacyPref(legacyPrefKey).trim();
  if (!legacyValue) {
    return "";
  }

  if (loginManager) {
    try {
      await upsertSecret(loginManager, secretName, legacyValue);
      clearLegacyPref(legacyPrefKey);
    } catch (error) {
      ztoolkit.log("migrate legacy secret failed", secretName, error);
    }
  }

  return legacyValue;
}

export async function setSecret(
  secretName: string,
  value: string,
  legacyPrefKey: string,
): Promise<void> {
  const trimmed = value.trim();
  const loginManager = getLoginManager();
  if (loginManager) {
    try {
      await upsertSecret(loginManager, secretName, trimmed);
      clearLegacyPref(legacyPrefKey);
      return;
    } catch (error) {
      ztoolkit.log("write secret failed", secretName, error);
    }
  }

  // Fallback for environments where login manager is unavailable.
  Zotero.Prefs.set(`${config.prefsPrefix}.${legacyPrefKey}`, trimmed, true);
}
