interface HeadlessRunResult {
  executable: string;
  flag: string;
  error: string;
}

const OUTPUT_READY_TIMEOUT_MS = 5000;

function getLocalAppDataPath(): string {
  try {
    const env = (Components.classes as any)[
      "@mozilla.org/process/environment;1"
    ].getService(
      (Components.interfaces as any).nsIEnvironment,
    ) as nsIEnvironment;
    return (env.get("LOCALAPPDATA") || "").trim();
  } catch (_error) {
    return "";
  }
}

function getHeadlessBrowserCandidates(preferredPath = ""): string[] {
  const localAppData = getLocalAppDataPath();
  const candidates = [
    preferredPath,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  if (localAppData) {
    candidates.push(
      `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    );
    candidates.push(`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`);
  }

  const unique: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || unique.includes(normalized)) {
      continue;
    }
    unique.push(normalized);
  }

  return unique;
}

function getExistingHeadlessBrowsers(preferredPath = ""): string[] {
  return getHeadlessBrowserCandidates(preferredPath).filter((path) => {
    try {
      const file = Zotero.File.pathToFile(path);
      return file.exists() && file.isFile();
    } catch (_error) {
      return false;
    }
  });
}

async function waitForOutputFile(filePath: string): Promise<void> {
  const timeoutAt = Date.now() + OUTPUT_READY_TIMEOUT_MS;
  while (Date.now() <= timeoutAt) {
    const file = Zotero.File.pathToFile(filePath);
    if (file.exists() && file.fileSize > 0) {
      return;
    }
    await Zotero.Promise.delay(120);
  }
  throw new Error("pdf output file not ready");
}

export async function exportPdfByHeadlessBrowser(
  htmlPath: string,
  outputPath: string,
  preferredBrowserPath = "",
): Promise<void> {
  const executables = getExistingHeadlessBrowsers(preferredBrowserPath);
  if (!executables.length) {
    if (preferredBrowserPath.trim()) {
      throw new Error(
        `configured browser executable not found: ${preferredBrowserPath.trim()}`,
      );
    }
    throw new Error(
      "no chromium browser executable found; set export-pdf-headless-browser-path",
    );
  }

  const sourceURI = Zotero.File.pathToFileURI(htmlPath);
  const errors: HeadlessRunResult[] = [];

  for (const executable of executables) {
    for (const headlessFlag of ["--headless=new", "--headless"]) {
      try {
        await Zotero.File.removeIfExists(outputPath);
      } catch (_error) {
        // Ignore remove errors before each attempt.
      }

      const args = [
        headlessFlag,
        "--disable-gpu",
        "--no-first-run",
        "--allow-file-access-from-files",
        "--disable-extensions",
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        "--generate-pdf-document-outline",
        "--virtual-time-budget=30000",
        `--print-to-pdf=${outputPath}`,
        sourceURI,
      ];

      try {
        const result = await Zotero.Utilities.Internal.exec(executable, args);
        if (result !== true) {
          throw result;
        }
        await waitForOutputFile(outputPath);
        return;
      } catch (error) {
        errors.push({
          executable,
          flag: headlessFlag,
          error:
            error instanceof Error && error.message
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown error",
        });
      }
    }
  }

  throw new Error(
    errors
      .map(
        (item) =>
          `${item.executable} ${item.flag}: ${item.error || "unknown error"}`,
      )
      .join(" | "),
  );
}
