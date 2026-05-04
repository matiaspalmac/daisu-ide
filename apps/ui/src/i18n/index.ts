import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";

export type AppLanguage = "en" | "es" | "ja";

export const SUPPORTED_LANGUAGES: AppLanguage[] = ["en", "es", "ja"];

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ja: { translation: ja },
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export default i18n;
