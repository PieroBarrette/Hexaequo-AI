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
        updateDisplay();
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
        updateDisplay();
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        elements.panel?.classList.remove('open');
        elements.overlay?.classList.remove('open');
        elements.button?.classList.remove('open');
    }

    // ==================== Display Updates ====================
    function updateDisplay() {
        const user = window.GameLobby?.getUser?.() || null;
        
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

    // ==================== Public API ====================
    window.UserMenu = {
        init,
        open,
        close,
        toggle,
        updateDisplay,
        isOpen: () => isOpen
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
