/**
 * router.js - Lightweight Hash Router for Hexaequo PWA
 * 
 * Provides URL-based navigation via hash fragments (#/route).
 * Enables browser back/forward buttons, refresh persistence,
 * and bookmarkable views.
 * 
 * Routes support :param syntax (e.g., #/replay/:id).
 * Guards can redirect unauthenticated users.
 */

(function() {
    'use strict';

    // ==================== State ====================
    const routes = [];       // Registered route definitions
    let currentRoute = null; // Current matched route path
    let currentParams = {};  // Current route params
    let started = false;
    let navigating = false;  // Prevent re-entrant navigation

    // ==================== Route Registration ====================

    /**
     * Register a route handler.
     * @param {string} pattern - Route pattern (e.g., '/', '/online', '/replay/:id')
     * @param {Function} handler - Called with { params, path, query } when route matches
     */
    function on(pattern, handler) {
        const paramNames = [];
        // Convert pattern to regex: '/replay/:id' → /^\/replay\/([^/]+)$/
        const regexStr = pattern
            .replace(/:([a-zA-Z_]+)/g, (_, name) => {
                paramNames.push(name);
                return '([^/]+)';
            })
            .replace(/\//g, '\\/');
        
        routes.push({
            pattern,
            regex: new RegExp('^' + regexStr + '$'),
            paramNames,
            handler
        });
    }

    // ==================== Navigation ====================

    /**
     * Navigate to a hash route.
     * @param {string} hash - Route path (e.g., '#/profile' or '/profile')
     * @param {object} [options] - { replace: boolean } — use replaceState instead of pushState
     */
    function navigate(hash, options = {}) {
        // Normalize: ensure it starts with #/
        if (hash.startsWith('/')) hash = '#' + hash;
        if (!hash.startsWith('#')) hash = '#/' + hash;
        
        if (options.replace) {
            // Replace current history entry
            const url = window.location.pathname + window.location.search + hash;
            window.history.replaceState(null, '', url);
        } else {
            window.location.hash = hash;
            return; // hashchange event will trigger resolve()
        }
        // For replaceState, manually trigger resolve
        resolve();
    }

    /**
     * Go back in browser history.
     */
    function back() {
        window.history.back();
    }

    // ==================== Route Resolution ====================

    /**
     * Parse the current hash and invoke the matching route handler.
     */
    function resolve() {
        if (navigating) return;
        navigating = true;

        try {
            const hash = window.location.hash || '#/';
            // Extract path from hash (strip leading #)
            const path = hash.slice(1) || '/';
            
            for (const route of routes) {
                const match = path.match(route.regex);
                if (match) {
                    // Build params object
                    const params = {};
                    route.paramNames.forEach((name, i) => {
                        params[name] = decodeURIComponent(match[i + 1]);
                    });

                    currentRoute = route.pattern;
                    currentParams = params;

                    route.handler({ params, path, query: getQueryParams() });
                    return;
                }
            }

            // No route matched — fallback to home
            console.warn('[Router] No route matched for:', path, '— redirecting to #/');
            navigate('#/', { replace: true });
        } finally {
            navigating = false;
        }
    }

    // ==================== Query Helpers ====================

    function getQueryParams() {
        return Object.fromEntries(new URLSearchParams(window.location.search));
    }

    // ==================== Public API ====================

    /**
     * Start the router — listen for hash changes and resolve initial route.
     * Should be called after all routes are registered.
     */
    function start() {
        if (started) return;
        started = true;

        window.addEventListener('hashchange', () => {
            resolve();
        });

        // Resolve current hash on startup
        resolve();
    }

    /**
     * Get the current route info.
     * @returns {{ route: string, params: object }}
     */
    function getCurrent() {
        return { route: currentRoute, params: { ...currentParams } };
    }

    /**
     * Check if the current route matches a pattern.
     * @param {string} pattern - e.g., '/game'
     * @returns {boolean}
     */
    function is(pattern) {
        return currentRoute === pattern;
    }

    window.Router = {
        on,
        navigate,
        back,
        start,
        getCurrent,
        is,
        resolve
    };
})();
