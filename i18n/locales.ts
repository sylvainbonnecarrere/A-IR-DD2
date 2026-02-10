export const locales = {
    fr: 'Français',
    en: 'English',
    de: 'Deutsch',
    es: 'Español',
    pt: 'Português',
    ua: 'Українська',
};

export const defaultLocale = 'fr';
export type Locale = keyof typeof locales;
