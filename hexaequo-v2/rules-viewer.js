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
            const newLang = e.detail.language;
            if (isOpen) {
                // Rules are open, reload immediately
                loadRules(newLang);
            } else {
                // Rules are closed, invalidate cache so it reloads on next open
                currentLanguage = newLang;
                rulesContent = null; // Invalidate cached content
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
        
        // Initialize animations (legacy placeholders)
        initAnimations();
        
        // Initialize video autoplay system
        initVideos();
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
     * Initialize animation placeholders (legacy - kept for backwards compatibility)
     */
    function initAnimations() {
        const animationPlaceholders = rulesContainer.querySelectorAll('.rules-animation-placeholder');
        
        animationPlaceholders.forEach(placeholder => {
            const animationId = placeholder.dataset.animationId;
            console.log(`[RulesViewer] Animation placeholder found: ${animationId}`);
        });
    }

    /**
     * Initialize video containers with IntersectionObserver for autoplay
     * Videos play automatically when visible and pause when out of view
     */
    function initVideos() {
        const videoContainers = rulesContainer.querySelectorAll('.rules-video-container');
        
        if (videoContainers.length === 0) return;
        
        // Create IntersectionObserver for autoplay on visibility
        const videoObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const container = entry.target;
                const video = container.querySelector('video');
                
                if (!video) return;
                
                if (entry.isIntersecting) {
                    // Video is visible - try to play
                    video.play().catch(err => {
                        // Autoplay might be blocked, that's okay
                        console.log(`[RulesViewer] Video autoplay blocked: ${err.message}`);
                    });
                } else {
                    // Video is not visible - pause to save resources
                    video.pause();
                }
            });
        }, {
            root: rulesContainer.querySelector('.rules-main'),
            rootMargin: '50px',
            threshold: 0.3
        });
        
        videoContainers.forEach(container => {
            const video = container.querySelector('video');
            const videoId = container.dataset.videoId;
            
            if (!video) return;
            
            console.log(`[RulesViewer] Video container found: ${videoId}`);
            
            // Mark container as loading
            container.classList.add('video-loading');
            
            // Handle video load success
            video.addEventListener('loadeddata', () => {
                container.classList.remove('video-loading');
                container.classList.add('video-loaded');
                console.log(`[RulesViewer] Video loaded: ${videoId}`);
            });
            
            // Handle video load error - keep placeholder visible
            video.addEventListener('error', () => {
                container.classList.remove('video-loading');
                console.log(`[RulesViewer] Video failed to load: ${videoId}`);
            });
            
            // Start observing for autoplay
            videoObserver.observe(container);
        });
        
        // Store observer reference for cleanup
        rulesContainer._videoObserver = videoObserver;
    }
    
    /**
     * Cleanup video observers when rules are closed
     */
    function cleanupVideos() {
        if (rulesContainer && rulesContainer._videoObserver) {
            rulesContainer._videoObserver.disconnect();
            rulesContainer._videoObserver = null;
        }
        
        // Pause all videos
        const videos = rulesContainer?.querySelectorAll('video');
        videos?.forEach(video => video.pause());
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
        // Cleanup videos (pause and disconnect observer)
        cleanupVideos();
        
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
