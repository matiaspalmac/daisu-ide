// Type-safe i18next keys. EN is the master catalog — TS infers the full key
// tree from the JSON import, so `t("settings.design.title")` autocompletes
// and `t("typo")` is a compile error. ES/JA are checked structurally by the
// build step against the EN shape.

import "i18next";
import type en from "../i18n/locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
    };
    returnNull: false;
  }
}
