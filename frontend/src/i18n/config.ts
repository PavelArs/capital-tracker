import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import enTranslations from './locales/en.json';
import ruTranslations from './locales/ru.json';

i18n
  .use(LanguageDetector) // Определяет язык браузера автоматически
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      ru: {
        translation: ruTranslations,
      },
    },
    fallbackLng: 'en', // Язык по умолчанию, если системный не поддерживается
    detection: {
      order: ['localStorage', 'navigator'], // Сначала проверяем localStorage, потом системный язык
      caches: ['localStorage'], // Сохраняем выбранный язык в localStorage
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: {
      escapeValue: false, // React уже экранирует значения
    },
  });

export default i18n;
