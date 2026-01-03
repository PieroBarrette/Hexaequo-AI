/**
 * Hexaequo - Rules Viewer Module
 * 
 * Handles loading and displaying HTML-based game rules with:
 * - Dynamic language switching (loads rules based on current i18n language)
 * - Sidebar navigation with smooth scrolling
 * - Scroll-spy to highlight current section in nav
 * - Placeholder for future animation system
 * 
 * Usage:
 *   RulesViewer.init() - Initialize the rules viewer
 *   RulesViewer.open() - Open the rules modal
 *   RulesViewer.close() - Close the rules modal
 */

(function() {
    'use strict';

    // ==================== Configuration ====================
    const RULES_BASE_PATH = './rules';
    const SCROLL_OFFSET = 20; // Offset for scroll-to-section
    const SCROLL_SPY_OFFSET = 100; // Offset for determining active section

    // ==================== State ====================
    let isInitialized = false;
    let currentLanguage = 'en';
    let rulesContent = null;
    let isOpen = false;

    // ==================== DOM Elements ====================
    let rulesOverlay = null;
    let rulesContainer = null;
    let closeBtn = null;

    // ==================== Core Functions ====================

    /**
     * Initialize the rules viewer
     */
    function init() {
        if (isInitialized) return;

        // Cache DOM elements
        rulesOverlay = document.getElementById('rulesOverlay');
        rulesContainer = document.getElementById('pdfContainer'); // We'll repurpose this container
        closeBtn = document.getElementById('closeRulesBtn');

        if (!rulesOverlay || !rulesContainer) {
            console.error('[RulesViewer] Required DOM elements not found');
            return;
        }

        // Set up event listeners
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        rulesOverlay.addEventListener('click', (e) => {
            if (e.target === rulesOverlay) {
                close();
            }
        });

        // Listen for language changes
        window.addEventListener('languageChanged', (e) => {
            if (isOpen) {
                loadRules(e.detail.language);
            } else {
                currentLanguage = e.detail.language;
            }
        });

        // Get initial language
        if (window.i18n && window.i18n.getCurrentLanguage) {
            currentLanguage = window.i18n.getCurrentLanguage();
        }

        isInitialized = true;
        console.log('[RulesViewer] Initialized');
    }

    /**
     * Load rules HTML for the specified language
     * @param {string} lang - Language code (e.g., 'en', 'fr')
     */
    async function loadRules(lang) {
        try {
            const response = await fetch(`${RULES_BASE_PATH}/${lang}/rules.html`);
            
            if (!response.ok) {
                // Fallback to English if requested language not available
                if (lang !== 'en') {
                    console.warn(`[RulesViewer] Rules not found for '${lang}', falling back to English`);
                    return loadRules('en');
                }
                throw new Error(`HTTP ${response.status}`);
            }

            rulesContent = await response.text();
            currentLanguage = lang;
            
            // Update the container
            updateContainer();
            
            console.log(`[RulesViewer] Loaded rules for '${lang}'`);
        } catch (error) {
            console.error('[RulesViewer] Failed to load rules:', error);
            rulesContainer.innerHTML = `
                <div class="rules-error">
                    <p>Failed to load rules. Please try again later.</p>
                </div>
            `;
        }
    }

    /**
     * Update the rules container with loaded content
     */
    function updateContainer() {
        if (!rulesContent) return;

        // Replace PDF container content with HTML rules
        rulesContainer.innerHTML = rulesContent;
        rulesContainer.classList.add('rules-html-container');
        rulesContainer.classList.remove('pdf-container');

        // Hide PDF navigation footer (we use sidebar navigation now)
        const rulesFooter = document.querySelector('.rules-footer');
        if (rulesFooter) {
            rulesFooter.style.display = 'none';
        }

        // Set up navigation
        setupNavigation();
        
        // Set up scroll spy
        setupScrollSpy();
        
        // Initialize animations (placeholder for future implementation)
        initAnimations();
    }

    /**
     * Set up sidebar navigation click handlers
     */
    function setupNavigation() {
        const navLinks = rulesContainer.querySelectorAll('.rules-nav-link');
        
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                const targetId = link.getAttribute('href').substring(1);
                const targetSection = document.getElementById(targetId);
                
                if (targetSection) {
                    const rulesMain = rulesContainer.querySelector('.rules-main');
                    if (rulesMain) {
                        const targetPosition = targetSection.offsetTop - SCROLL_OFFSET;
                        rulesMain.scrollTo({
                            top: targetPosition,
                            behavior: 'smooth'
                        });
                    }
                    
                    // Update active state
                    navLinks.forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                }
            });
        });
    }

    /**
     * Set up scroll spy to update nav highlighting on scroll
     */
    function setupScrollSpy() {
        const rulesMain = rulesContainer.querySelector('.rules-main');
        const sections = rulesContainer.querySelectorAll('.rules-section');
        const navLinks = rulesContainer.querySelectorAll('.rules-nav-link');
        
        if (!rulesMain || sections.length === 0) return;

        rulesMain.addEventListener('scroll', () => {
            let currentSection = '';
            const scrollPosition = rulesMain.scrollTop + SCROLL_SPY_OFFSET;

            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                const sectionHeight = section.offsetHeight;
                
                if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                    currentSection = section.getAttribute('id');
                }
            });

            // Update active nav link
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${currentSection}`) {
                    link.classList.add('active');
                }
            });
        });
    }

    /**
     * Initialize animation placeholders
     * This is a stub for future animation implementation
     */
    function initAnimations() {
        const animationPlaceholders = rulesContainer.querySelectorAll('.rules-animation-placeholder');
        
        animationPlaceholders.forEach(placeholder => {
            const animationId = placeholder.dataset.animationId;
            
            // TODO: Future implementation will:
            // 1. Load animation sequence from animations.js
            // 2. Create a mini canvas using graphics.js
            // 3. Play the animation on loop when visible
            // 4. Use IntersectionObserver to play only when in viewport
            
            console.log(`[RulesViewer] Animation placeholder found: ${animationId}`);
            
            // For now, just add a click handler that logs
            placeholder.addEventListener('click', () => {
                console.log(`[RulesViewer] Animation '${animationId}' clicked (not yet implemented)`);
            });
        });
    }

    /**
     * Open the rules modal
     */
    function open() {
        if (!isInitialized) {
            init();
        }

        // Get current language from i18n if available
        if (window.i18n && window.i18n.getCurrentLanguage) {
            const lang = window.i18n.getCurrentLanguage();
            if (lang !== currentLanguage || !rulesContent) {
                loadRules(lang);
            } else {
                updateContainer();
            }
        } else if (!rulesContent) {
            loadRules('en');
        } else {
            updateContainer();
        }

        rulesOverlay.classList.add('open');
        isOpen = true;
    }

    /**
     * Close the rules modal
     */
    function close() {
        rulesOverlay.classList.remove('open');
        isOpen = false;
    }

    // ==================== Expose Public API ====================
    window.RulesViewer = {
        init,
        open,
        close,
        loadRules
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
