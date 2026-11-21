import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'

export function resolveLanguage(nav: string | undefined): 'bg' | 'en' {
  return nav?.toLowerCase().startsWith('bg') ? 'bg' : 'en'
}

// Only English ships in Task 17; Task 19 adds the 'bg' resources (fallbackLng covers the gap).
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: resolveLanguage(typeof navigator === 'undefined' ? undefined : navigator.language),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
