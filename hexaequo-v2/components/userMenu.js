/**
 * userMenu.js - Menu hamburger utilisateur (Phase 1)
 * 
 * Responsabilités:
 * - Bouton icône utilisateur en haut à droite du site (hors in-game)
 * - Menu slide-in depuis right
 * - Si non connecté: Sign-in, Register, Settings
 * - Si connecté: Pseudo + ELO, Profile, Settings, Logout
 * 
 * Dépendances:
 * - localStorage: hexaequo_session
 * - Lobby: currentUser, auth functions
 * - i18n.js pour traductions
 */

(function() {
    'use strict';

    // ==================== State ====================
    let isOpen = false;

    // ==================== DOM Elements ====================
    const elements = {
        button: null,
        panel: null,
        overlay: null,
        // User info
        userSection: null,
        userName: null,
        userElo: null,
        // Badge (beside button)
        badge: null,
        badgeName: null,
        badgeElo: null,
        // Menu items
        signInBtn: null,
        registerBtn: null,
        profileBtn: null,
        settingsBtn: null,
        logoutBtn: null,
        // Guest/Logged states
        guestItems: null,
        loggedItems: null
    };

    // ==================== Initialization ====================
    function init() {
        cacheElements();
        setupEventListeners();
        setupHeaderLogoClick();
        updateDisplay();
        // Start in main menu mode (logo hidden in header)
        setMainMenuMode(true);
        console.log('[UserMenu] Initialized');
    }

    function cacheElements() {
        elements.button = document.getElementById('userMenuBtn');
        elements.panel = document.getElementById('userMenuPanel');
        elements.overlay = document.getElementById('userMenuOverlay');
        elements.userSection = document.getElementById('userMenuUserSection');
        elements.userName = document.getElementById('userMenuName');
        elements.userElo = document.getElementById('userMenuElo');
        elements.avatar = document.getElementById('userMenuAvatar');
        // Badge elements
        elements.badge = document.getElementById('userMenuBadge');
        elements.badgeName = document.getElementById('userMenuBadgeName');
        elements.badgeElo = document.getElementById('userMenuBadgeElo');
        // Menu items
        elements.signInBtn = document.getElementById('userMenuSignIn');
        elements.registerBtn = document.getElementById('userMenuRegister');
        elements.profileBtn = document.getElementById('userMenuProfile');
        elements.settingsBtn = document.getElementById('userMenuSettings');
        elements.settingsBtnLogged = document.getElementById('userMenuSettingsLogged');
        elements.logoutBtn = document.getElementById('userMenuLogout');
        elements.guestItems = document.getElementById('userMenuGuestItems');
        elements.loggedItems = document.getElementById('userMenuLoggedItems');
    }

    function setupEventListeners() {
        // Toggle button
        elements.button?.addEventListener('click', toggle);
        
        // Overlay click to close
        elements.overlay?.addEventListener('click', close);
        
        // Menu item clicks
        elements.signInBtn?.addEventListener('click', () => {
            close();
            showAuthSection('login');
        });
        
        elements.registerBtn?.addEventListener('click', () => {
            close();
            showAuthSection('register');
        });
        
        elements.profileBtn?.addEventListener('click', () => {
            close();
            openProfile();
        });
        
        elements.settingsBtn?.addEventListener('click', () => {
            close();
            showSettings();
        });
        
        elements.settingsBtnLogged?.addEventListener('click', () => {
            close();
            showSettings();
        });
        
        elements.logoutBtn?.addEventListener('click', () => {
            close();
            handleLogout();
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) {
                close();
            }
        });
    }

    // ==================== Menu Actions ====================
    function toggle() {
        if (isOpen) {
            close();
        } else {
            open();
        }
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        elements.panel?.classList.add('open');
        elements.overlay?.classList.add('open');
        elements.button?.classList.add('open');
        // Hide badge when menu is open
        elements.badge?.classList.add('hidden');
        updateDisplay();
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        elements.panel?.classList.remove('open');
        elements.overlay?.classList.remove('open');
        elements.button?.classList.remove('open');
        // Show badge when menu is closed (if user is logged in)
        updateBadgeVisibility();
    }

    // ==================== Display Updates ====================
    function updateBadgeVisibility() {
        const user = window.GameLobby?.getUser?.() || null;
        if (user && !isOpen) {
            const displayName = user.pseudo || user.username || 'User';
            if (elements.badgeName) {
                elements.badgeName.textContent = displayName;
            }
            if (elements.badgeElo) {
                elements.badgeElo.textContent = user.elo ? `ELO: ${user.elo}` : '';
            }
            elements.badge?.style.setProperty('display', 'flex');
            elements.badge?.classList.remove('hidden');
        } else {
            elements.badge?.style.setProperty('display', 'none');
        }
    }

    function updateDisplay() {
        const user = window.GameLobby?.getUser?.() || null;
        
        // Update badge visibility
        updateBadgeVisibility();
        
        if (user) {
            // User is logged in
            elements.guestItems?.style.setProperty('display', 'none');
            elements.loggedItems?.style.setProperty('display', 'block');
            elements.userSection?.style.setProperty('display', 'block');
            
            const displayName = user.pseudo || user.username || 'User';
            if (elements.userName) {
                elements.userName.textContent = displayName;
            }
            if (elements.userElo) {
                elements.userElo.textContent = user.elo ? `ELO: ${user.elo}` : '';
            }
            if (elements.avatar) {
                elements.avatar.textContent = displayName.charAt(0).toUpperCase();
            }
        } else {
            // Guest (not logged in)
            elements.guestItems?.style.setProperty('display', 'block');
            elements.loggedItems?.style.setProperty('display', 'none');
            elements.userSection?.style.setProperty('display', 'none');
        }
    }

    // ==================== Action Handlers ====================
    function showAuthSection(tab = 'login') {
        // Use lobby's auth section functionality
        const authSection = document.getElementById('authSection');
        const modeSelection = document.querySelector('.mode-selection');
        const localConfig = document.getElementById('localConfigSection');
        const onlineOptions = document.getElementById('onlineOptions');
        const settingsSection = document.getElementById('lobbySettingsSection');
        const lobbyFooter = document.querySelector('.lobby-footer');
        
        // Hide other sections
        modeSelection?.style.setProperty('display', 'none');
        localConfig?.style.setProperty('display', 'none');
        onlineOptions?.style.setProperty('display', 'none');
        settingsSection?.style.setProperty('display', 'none');
        lobbyFooter?.style.setProperty('display', 'none');
        
        // Show auth section
        authSection?.style.setProperty('display', 'flex');
        
        // Switch to correct tab
        const tabs = document.querySelectorAll('.auth-tab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        
        tabs.forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        
        if (tab === 'login') {
            loginForm?.style.setProperty('display', 'block');
            registerForm?.style.setProperty('display', 'none');
        } else {
            loginForm?.style.setProperty('display', 'none');
            registerForm?.style.setProperty('display', 'block');
        }
    }

    function showSettings() {
        // Use lobby's settings section functionality
        const settingsSection = document.getElementById('lobbySettingsSection');
        const modeSelection = document.querySelector('.mode-selection');
        const localConfig = document.getElementById('localConfigSection');
        const onlineOptions = document.getElementById('onlineOptions');
        const authSection = document.getElementById('authSection');
        const lobbyFooter = document.querySelector('.lobby-footer');
        
        // Hide other sections
        modeSelection?.style.setProperty('display', 'none');
        localConfig?.style.setProperty('display', 'none');
        onlineOptions?.style.setProperty('display', 'none');
        authSection?.style.setProperty('display', 'none');
        lobbyFooter?.style.setProperty('display', 'none');
        
        // Show settings section
        settingsSection?.style.setProperty('display', 'flex');
    }

    function openProfile() {
        // Use lobby's profile modal
        const profileModal = document.getElementById('profileModal');
        if (profileModal) {
            profileModal.style.display = 'flex';
        }
    }

    async function handleLogout() {
        // Call lobby's logout functionality
        if (window.GameLobby?.logout) {
            await window.GameLobby.logout();
        } else {
            // Fallback: manual logout
            const sessionToken = localStorage.getItem('hexaequo_session');
            if (sessionToken) {
                try {
                    const BACKEND_PORT = 3000;
                    const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                        ? `http://localhost:${BACKEND_PORT}`
                        : 'https://hexaequo-server.onrender.com';
                    
                    await fetch(`${SERVER_URL}/api/auth/logout`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${sessionToken}` }
                    });
                } catch (err) {
                    console.error('[UserMenu] Logout error:', err);
                }
            }
            localStorage.removeItem('hexaequo_session');
        }
        updateDisplay();
    }

    // ==================== Helper ====================
    function i18nT(key) {
        return window.i18n?.t(key) || key;
    }

    // ==================== Visibility Control ====================
    function show() {
        const header = document.querySelector('.site-header');
        if (header) {
            header.classList.remove('hidden');
        }
        // Set to main menu mode by default when showing
        setMainMenuMode(true);
    }

    function hide() {
        const header = document.querySelector('.site-header');
        if (header) {
            header.classList.add('hidden');
        }
        // Also close menu if open
        if (isOpen) {
            close();
        }
    }

    function setMainMenuMode(isMainMenu) {
        const header = document.querySelector('.site-header');
        if (header) {
            if (isMainMenu) {
                header.classList.add('main-menu');
            } else {
                header.classList.remove('main-menu');
            }
        }
    }

    // ==================== Header Logo Click Handler ====================
    function setupHeaderLogoClick() {
        const logoLink = document.getElementById('headerLogoLink');
        if (logoLink) {
            logoLink.addEventListener('click', (e) => {
                e.preventDefault();
                handleLogoClick();
            });
        }
    }

    function handleLogoClick() {
        // If in a game, show confirmation modal (like hamburger menu's main menu button)
        const lobbyOverlay = document.getElementById('lobbyOverlay');
        const isInGame = lobbyOverlay && lobbyOverlay.classList.contains('hidden');
        
        if (isInGame) {
            // If there's a confirmation modal system, use it
            const confirmModal = document.getElementById('confirmModal');
            if (confirmModal) {
                confirmModal.style.display = 'flex';
            } else {
                // Fallback: directly go to main menu
                goToMainMenu();
            }
        } else {
            // Not in a game, go directly to main menu
            goToMainMenu();
        }
    }

    function goToMainMenu() {
        // Show lobby and reset to main menu
        const lobbyOverlay = document.getElementById('lobbyOverlay');
        if (lobbyOverlay) {
            lobbyOverlay.classList.remove('hidden');
            lobbyOverlay.style.display = 'flex';
            lobbyOverlay.style.visibility = 'visible';
            lobbyOverlay.style.pointerEvents = 'auto';
            lobbyOverlay.style.opacity = '1';
        }
        
        // Stop timers if running
        if (window.GameTimer) {
            window.GameTimer.stop();
        }
        
        // Show main menu
        if (window.showLobbyMainMenu) {
            window.showLobbyMainMenu();
        }
        
        // Update header to main menu mode
        setMainMenuMode(true);
    }

    // ==================== Public API ====================
    window.UserMenu = {
        init,
        open,
        close,
        toggle,
        updateDisplay,
        isOpen: () => isOpen,
        show,
        hide,
        setMainMenuMode,
        goToMainMenu
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
