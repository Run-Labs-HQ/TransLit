import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { FullTextTranslateFactory } from "./fullTextTranslate";
import { MinerUExtractFactory } from "./mineruExtract";
import {
  getMenuVisibilityPref,
  MENU_VISIBILITY_DEFAULTS,
  MENU_VISIBILITY_PREF_KEYS,
} from "./menuVisibility";
import { TranslatedPdfExportFactory } from "./translatedPdfExport";

const WORKFLOW_MENU_ID = `zotero-itemmenu-${config.addonRef}-one-click-workflow`;

export class OneClickWorkflowFactory {
  private static menuRegistered = false;
  private static running = false;

  static registerItemMenu(): void {
    if (this.menuRegistered) {
      return;
    }

    this.menuRegistered = true;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: WORKFLOW_MENU_ID,
      label: this.t("menuitem-one-click-workflow"),
      isHidden: () =>
        !getMenuVisibilityPref(
          MENU_VISIBILITY_PREF_KEYS.oneClickWorkflow,
          MENU_VISIBILITY_DEFAULTS.oneClickWorkflow,
        ),
      commandListener: async () => {
        await this.runSelectedItems();
      },
    });
  }

  private static async runSelectedItems(): Promise<void> {
    if (this.running) {
      this.showToast(this.t("workflow-busy"), "default");
      return;
    }

    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      this.showToast(getString("translate-error-no-selection"), "error");
      return;
    }

    this.running = true;
    this.showToast(this.t("workflow-start"), "default");

    try {
      await FullTextTranslateFactory.runSelectedItems();
      await MinerUExtractFactory.runSelectedItems();
      await TranslatedPdfExportFactory.runSelectedItems();
      this.showToast(this.t("workflow-success"), "success");
    } catch (error) {
      ztoolkit.log("one-click workflow failed", error);
      this.showToast(
        this.t("workflow-failed", {
          args: {
            reason: this.getErrorMessage(error),
          },
        }),
        "error",
      );
    } finally {
      this.running = false;
    }
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
