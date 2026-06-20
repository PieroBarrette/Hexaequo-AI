/**
 * Hexaequo - Internationalization (i18n) Module
 * 
 * Provides translation functionality with support for:
 * - Multiple languages (easily extensible)
 * - Nested translation keys (e.g., 'lobby.localGame')
 * - Template interpolation (e.g., 'Page {current} of {total}')
 * - LocalStorage persistence
 * - Dynamic language switching without page reload
 * 
 * Usage:
 *   import { t, setLanguage, getCurrentLanguage, getAvailableLanguages } from './i18n.js';
 *   
 *   // Get a translation
 *   const text = t('lobby.localGame');
 *   
 *   // With interpolation
 *   const pageText = t('rules.pageOf', { current: 1, total: 10 });
 *   
 *   // Change language
 *   await setLanguage('fr');
 */

// ==================== Configuration ====================
const STORAGE_KEY = 'hexaequo.language';
const DEFAULT_LANGUAGE = 'en';

// Supported languages - Add new languages here
// The key should match the filename in /locales/ (without .json)
const SUPPORTED_LANGUAGES = {
    en: { name: 'English', nativeName: 'English' },
    fr: { name: 'French', nativeName: 'Français' }
    // Add more languages here:
    // de: { name: 'German', nativeName: 'Deutsch' },
    // es: { name: 'Spanish', nativeName: 'Español' },
    // etc.
};

// ==================== State ====================
let currentLanguage = DEFAULT_LANGUAGE;
let translations = {};
let isLoaded = false;

// ==================== Core Functions ====================

/**
 * Load translations for a specific language
 * @param {string} lang - Language code (e.g., 'en', 'fr')
 * @returns {Promise<Object>} - Loaded translations
 */
async function loadTranslations(lang) {
    if (!SUPPORTED_LANGUAGES[lang]) {
        console.warn(`[i18n] Language '${lang}' not supported, falling back to '${DEFAULT_LANGUAGE}'`);
        lang = DEFAULT_LANGUAGE;
    }
    
    try {
        const response = await fetch(`./locales/${lang}.json`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        console.log(`[i18n] Loaded translations for '${lang}'`);
        return data;
    } catch (error) {
        console.error(`[i18n] Failed to load translations for '${lang}':`, error);
        
        // If we failed to load the requested language and it's not the default,
        // try loading the default language
        if (lang !== DEFAULT_LANGUAGE) {
            console.log(`[i18n] Attempting to load fallback language '${DEFAULT_LANGUAGE}'`);
            return loadTranslations(DEFAULT_LANGUAGE);
        }
        
        // Return empty object if even default fails
        return {};
    }
}

/**
 * Get the value at a nested path in an object
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., 'lobby.localGame')
 * @returns {*} - Value at path or undefined
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}

/**
 * Interpolate template variables in a string
 * @param {string} str - String with {variable} placeholders
 * @param {Object} params - Key-value pairs for interpolation
 * @returns {string} - Interpolated string
 */
function interpolate(str, params = {}) {
    if (!params || typeof str !== 'string') return str;
    
    return str.replace(/\{(\w+)\}/g, (match, key) => {
        return params.hasOwnProperty(key) ? params[key] : match;
    });
}

// ==================== Public API ====================

/**
 * Initialize the i18n module
 * Loads saved language preference or uses default
 * @returns {Promise<void>}
 */
async function init() {
    // Check for saved language preference
    const savedLang = localStorage.getItem(STORAGE_KEY);
    
    // Detect system/browser language
    const systemLang = getSystemLanguage();
    
    // Priority: saved > system > default
    let targetLang = DEFAULT_LANGUAGE;
    if (savedLang && SUPPORTED_LANGUAGES[savedLang]) {
        targetLang = savedLang;
    } else if (systemLang && SUPPORTED_LANGUAGES[systemLang]) {
        targetLang = systemLang;
    }
    
    translations = await loadTranslations(targetLang);
    currentLanguage = targetLang;
    isLoaded = true;
    
    // Update the HTML lang attribute
    document.documentElement.lang = currentLanguage;
    
    console.log(`[i18n] Initialized with language: ${currentLanguage}`);
}

/**
 * Detect the system/browser language
 * Returns the language code if supported, otherwise null
 */
function getSystemLanguage() {
    // Get browser language (e.g., 'en-US', 'fr', 'fr-FR')
    const browserLang = navigator.language || navigator.userLanguage;
    if (!browserLang) return null;
    
    // Extract base language code (e.g., 'en' from 'en-US')
    const baseLang = browserLang.split('-')[0].toLowerCase();
    
    // Check if supported
    if (SUPPORTED_LANGUAGES[baseLang]) {
        return baseLang;
    }
    
    return null;
}

/**
 * Get a translated string
 * @param {string} key - Dot-separated translation key (e.g., 'lobby.localGame')
 * @param {Object} [params] - Optional interpolation parameters
 * @returns {string} - Translated string or the key if not found
 */
function t(key, params = {}) {
    if (!isLoaded) {
        console.warn('[i18n] Translations not loaded yet. Call init() first.');
        return key;
    }
    
    const value = getNestedValue(translations, key);
    
    if (value === undefined) {
        console.warn(`[i18n] Missing translation for key: '${key}'`);
        return key;
    }
    
    if (typeof value !== 'string') {
        console.warn(`[i18n] Translation for '${key}' is not a string`);
        return key;
    }
    
    return interpolate(value, params);
}

/**
 * Change the current language
 * @param {string} lang - Language code
 * @returns {Promise<boolean>} - True if language was changed successfully
 */
async function setLanguage(lang) {
    if (!SUPPORTED_LANGUAGES[lang]) {
        console.error(`[i18n] Language '${lang}' is not supported`);
        return false;
    }
    
    if (lang === currentLanguage) {
        console.log(`[i18n] Language '${lang}' is already active`);
        return true;
    }
    
    translations = await loadTranslations(lang);
    currentLanguage = lang;
    
    // Persist preference
    localStorage.setItem(STORAGE_KEY, lang);
    
    // Update HTML lang attribute
    document.documentElement.lang = lang;
    
    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('languageChanged', { 
        detail: { language: lang } 
    }));
    
    console.log(`[i18n] Language changed to: ${lang}`);
    return true;
}

/**
 * Get the current language code
 * @returns {string} - Current language code
 */
function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * Get list of available languages
 * @returns {Array<{code: string, name: string, nativeName: string}>}
 */
function getAvailableLanguages() {
    return Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => ({
        code,
        name: info.name,
        nativeName: info.nativeName
    }));
}

/**
 * Check if the i18n module is ready
 * @returns {boolean}
 */
function isReady() {
    return isLoaded;
}

/**
 * Update all elements with data-i18n attribute
 * Call this after language change to update static text
 */
function updateDOM() {
    // Update elements with data-i18n attribute (text content)
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const params = el.getAttribute('data-i18n-params');
        const parsedParams = params ? JSON.parse(params) : {};
        el.textContent = t(key, parsedParams);
    });
    
    // Update elements with data-i18n-placeholder (input placeholders)
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
    
    // Update elements with data-i18n-title (title attribute/tooltip)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
    
    // Update elements with data-i18n-html (innerHTML - use carefully)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        const params = el.getAttribute('data-i18n-params');
        const parsedParams = params ? JSON.parse(params) : {};
        el.innerHTML = t(key, parsedParams);
    });
}

// ==================== Auto-initialization ====================
// Automatically initialize when the module is loaded
const initPromise = init();

// ==================== Exports ====================
// Make functions available globally for non-module scripts
window.i18n = {
    t,
    setLanguage,
    getCurrentLanguage,
    getAvailableLanguages,
    updateDOM,
    isReady,
    init: () => initPromise // Return the existing promise
};

// ES Module exports (for future module-based code)
export {
    t,
    setLanguage,
    getCurrentLanguage,
    getAvailableLanguages,
    updateDOM,
    isReady,
    initPromise as init
};
