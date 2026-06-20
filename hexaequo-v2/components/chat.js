/**
 * chat.js - In-game Chat Widget (Phase 3)
 *
 * Two tabs: Text (free typing) and Quick (preset messages).
 * Visible only during online games. Ephemeral — messages lost on leave.
 */

const GameChat = (function () {
    // State
    let isOpen = false;
    let unreadCount = 0;
    let myPseudo = '';
    let activeTab = 'text'; // 'text' | 'quick'

    // DOM refs (created dynamically)
    let widget = null;
    let toggleBtn = null;
    let badge = null;
    let panel = null;
    let overlay = null;
    let messagesDiv = null;
    let inputField = null;
    let sendBtn = null;
    let rateLimitMsg = null;

    // Quick message keys — must match chatService QUICK_MESSAGE_KEYS
    const QUICK_KEYS = [
        'hello', 'goodLuck', 'thanks', 'oops',
        'goodMove', 'sorry', 'goodGame', 'gottaGo'
    ];

    /**
     * Get localized string. Falls back to key if i18n not available.
     */
    function t(key) {
        if (typeof i18nT === 'function') return i18nT(key);
        if (typeof window.i18nT === 'function') return window.i18nT(key);
        return key;
    }

    /**
     * Initialize chat widget and wire socket listener.
     * @param {string} playerPseudo
     */
    function initChat(playerPseudo) {
        if (widget) return; // already initialized
        myPseudo = playerPseudo || 'Me';
        buildDOM();
        wireSocket();
    }

    /**
     * Destroy the chat widget and clean up.
     */
    function destroyChat() {
        if (widget && widget.parentNode) {
            widget.parentNode.removeChild(widget);
        }
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        document.removeEventListener('keydown', handleEscKey);
        widget = null;
        toggleBtn = null;
        badge = null;
        panel = null;
        overlay = null;
        messagesDiv = null;
        inputField = null;
        sendBtn = null;
        rateLimitMsg = null;
        isOpen = false;
        unreadCount = 0;
        activeTab = 'text';
    }

    // ===== DOM Construction =====

    function buildDOM() {
        // Container
        widget = document.createElement('div');
        widget.className = 'chat-widget';
        widget.id = 'chatWidget';

        // Toggle button
        toggleBtn = document.createElement('button');
        toggleBtn.className = 'chat-toggle';
        toggleBtn.setAttribute('aria-label', t('chat.title'));
        toggleBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
        toggleBtn.addEventListener('click', toggleChat);

        // Badge
        badge = document.createElement('span');
        badge.className = 'chat-badge';
        badge.style.display = 'none';
        toggleBtn.appendChild(badge);

        // Panel
        panel = document.createElement('div');
        panel.className = 'chat-panel';
        panel.style.display = 'none';

        // Tabs
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'chat-tabs';

        const textTab = document.createElement('button');
        textTab.className = 'chat-tab chat-tab-active';
        textTab.textContent = t('chat.textTab');
        textTab.dataset.tab = 'text';
        textTab.addEventListener('click', () => switchTab('text'));

        const quickTab = document.createElement('button');
        quickTab.className = 'chat-tab';
        quickTab.textContent = t('chat.quickTab');
        quickTab.dataset.tab = 'quick';
        quickTab.addEventListener('click', () => switchTab('quick'));

        tabsContainer.appendChild(textTab);
        tabsContainer.appendChild(quickTab);
        panel.appendChild(tabsContainer);

        // Messages area
        messagesDiv = document.createElement('div');
        messagesDiv.className = 'chat-messages';
        panel.appendChild(messagesDiv);

        // Quick messages grid (hidden by default)
        const quickGrid = document.createElement('div');
        quickGrid.className = 'quick-messages';
        quickGrid.id = 'chatQuickGrid';
        quickGrid.style.display = 'none';
        QUICK_KEYS.forEach(key => {
            const btn = document.createElement('button');
            btn.className = 'quick-message-btn';
            btn.textContent = t('chat.' + key);
            btn.addEventListener('click', () => sendQuick(key));
            quickGrid.appendChild(btn);
        });
        panel.appendChild(quickGrid);

        // Input area
        const inputContainer = document.createElement('div');
        inputContainer.className = 'chat-input-container';
        inputContainer.id = 'chatInputContainer';

        inputField = document.createElement('input');
        inputField.className = 'chat-input';
        inputField.type = 'text';
        inputField.maxLength = 200;
        inputField.placeholder = t('chat.placeholder');
        inputField.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Prevent game hotkeys
            if (e.key === 'Enter') sendText();
        });

        sendBtn = document.createElement('button');
        sendBtn.className = 'chat-send-btn';
        sendBtn.textContent = t('chat.send');
        sendBtn.addEventListener('click', sendText);

        inputContainer.appendChild(inputField);
        inputContainer.appendChild(sendBtn);
        panel.appendChild(inputContainer);

        // Rate limit warning
        rateLimitMsg = document.createElement('div');
        rateLimitMsg.className = 'chat-rate-limit';
        rateLimitMsg.textContent = t('chat.rateLimited');
        rateLimitMsg.style.display = 'none';
        panel.appendChild(rateLimitMsg);

        // Overlay for click-outside-to-close
        overlay = document.createElement('div');
        overlay.className = 'chat-overlay';
        overlay.addEventListener('click', closeChat);
        document.body.appendChild(overlay);

        // Escape key to close
        document.addEventListener('keydown', handleEscKey);

        // Assemble
        widget.appendChild(panel);
        widget.appendChild(toggleBtn);
        document.body.appendChild(widget);
    }

    // ===== Tab Switching =====

    function switchTab(tab) {
        activeTab = tab;
        const tabs = panel.querySelectorAll('.chat-tab');
        tabs.forEach(t => t.classList.toggle('chat-tab-active', t.dataset.tab === tab));

        const quickGrid = panel.querySelector('.quick-messages');
        const inputContainer = panel.querySelector('.chat-input-container');

        if (tab === 'quick') {
            quickGrid.style.display = 'grid';
            inputContainer.style.display = 'none';
        } else {
            quickGrid.style.display = 'none';
            inputContainer.style.display = 'flex';
            inputField.focus();
        }
    }

    // ===== Sending Messages =====

    function sendText() {
        const text = inputField.value.trim();
        if (!text) return;
        inputField.value = '';

        // Add own message to UI immediately
        appendMessage(myPseudo, text, 'text', true);

        // Send via socket
        window.Multiplayer.sendChatMessage(text, 'text', handleSendError);
    }

    function sendQuick(key) {
        // Add own message
        appendMessage(myPseudo, t('chat.' + key), 'quick', true);
        window.Multiplayer.sendChatMessage(key, 'quick', handleSendError);
    }

    function handleSendError(error) {
        if (error === 'rate_limited') {
            rateLimitMsg.style.display = 'block';
            setTimeout(() => { rateLimitMsg.style.display = 'none'; }, 3000);
        }
    }

    // ===== Receiving Messages =====

    function wireSocket() {
        window.Multiplayer.onChatMessage = onReceive;
    }

    function onReceive(data) {
        const displayMessage = data.type === 'quick' ? t('chat.' + data.message) : data.message;
        appendMessage(data.pseudo, displayMessage, data.type, false);

        if (!isOpen) {
            unreadCount++;
            updateBadge();
        }
    }

    // ===== UI Helpers =====

    function appendMessage(pseudo, text, type, isOwn) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-message ' + (isOwn ? 'chat-message-own' : 'chat-message-other');
        if (type === 'quick') bubble.classList.add('chat-message-quick');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chat-message-pseudo';
        nameSpan.textContent = pseudo;

        const textSpan = document.createElement('span');
        textSpan.className = 'chat-message-text';
        textSpan.textContent = text;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-message-time';
        const now = new Date();
        timeSpan.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

        bubble.appendChild(nameSpan);
        bubble.appendChild(textSpan);
        bubble.appendChild(timeSpan);
        messagesDiv.appendChild(bubble);

        // Auto-scroll
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function toggleChat() {
        if (isOpen) closeChat(); else openChat();
    }

    function openChat() {
        isOpen = true;
        panel.style.display = 'flex';
        if (overlay) overlay.classList.add('open');
        toggleBtn.classList.add('chat-toggle-active');
        unreadCount = 0;
        updateBadge();
        if (activeTab === 'text') inputField.focus();
    }

    function closeChat() {
        isOpen = false;
        panel.style.display = 'none';
        if (overlay) overlay.classList.remove('open');
        toggleBtn.classList.remove('chat-toggle-active');
    }

    function handleEscKey(e) {
        if (e.key === 'Escape' && isOpen) closeChat();
    }

    function updateBadge() {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.style.display = 'flex';
            badge.classList.add('chat-badge-pulse');
            setTimeout(() => badge.classList.remove('chat-badge-pulse'), 600);
        } else {
            badge.style.display = 'none';
        }
    }

    // Public API
    return {
        initChat,
        destroyChat
    };
})();

window.GameChat = GameChat;
