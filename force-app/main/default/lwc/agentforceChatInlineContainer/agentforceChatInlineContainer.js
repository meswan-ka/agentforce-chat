import { LightningElement, api, track } from 'lwc';

/**
 * @description Agentforce Chat Inline Container
 * A target container for projecting the Agentforce chat UI.
 *
 * Place this component on any page where you want the chat to appear inline.
 * The main agentforceChat component will detect this container and project
 * the chat UI into it.
 *
 * If no container exists on the page, the chat will appear in floating (FAB) mode.
 *
 * CONFIGURATION:
 * Configure via the Custom Property Editor (CPE) in Experience Builder.
 * The CPE provides full configuration for display, appearance, branding, and search settings.
 */
export default class AgentforceChatInlineContainer extends LightningElement {
    // Use Light DOM so the projected chat content can be styled
    static renderMode = 'light';

    // ==================== CPE CONFIGURATION ====================

    _configJson = '';

    @api
    get configJson() {
        return this._configJson;
    }

    set configJson(val) {
        this._configJson = val;
        this._configApplied = false;
        this._applyConfig();
    }

    // Default configuration values
    static DEFAULTS = {
        height: 600,
        widthPercent: 100,
        showWelcomeScreen: true,
        gradientStartColor: '#e8f4fd',
        gradientMidColor: '#f5f9fc',
        gradientEndColor: '#ffffff',
        welcomeTitle: 'How can Agentforce help?',
        welcomeTitleColor: '#032d60',
        calloutWord: 'Agentforce',
        calloutColor: '#0176d3',
        calloutBold: true,
        calloutItalic: false,
        calloutFontWeight: '700',
        welcomeMessage: 'Ask questions, get personalized answers, and take action with Agentforce.',
        agentPrimaryColor: '#0176d3',
        sendButtonColor: '#0176d3',
        autoDetectSearchQuery: false,
        searchPagePath: '/global-search',
        searchQueryParam: 'term',
        searchStartsNewChat: true
    };

    // Internal tracked config (merged from CPE or @api properties)
    @track _config = { ...AgentforceChatInlineContainer.DEFAULTS };
    _configApplied = false;

    // Internal state
    _containerId = null;
    _isWelcomeVisible = true;
    _inputMessage = '';

    // ==================== LIFECYCLE ====================

    connectedCallback() {
        // Apply configuration (from CPE or @api properties)
        this._applyConfig();

        // Generate unique container ID
        this._containerId = 'agentforce-inline-container-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

        // Register this container globally so the core component can find it
        window.__agentforceChatInlineContainer = {
            id: this._containerId,
            element: null, // Will be set in renderedCallback
            showChat: () => this._showChat(),
            hideWelcome: () => this._hideWelcome(),
            showWelcome: () => this._showWelcome(),
            reset: () => this._reset(),
            getInputMessage: () => this._inputMessage,
            // Share search config so core component can auto-detect
            searchConfig: {
                autoDetectSearchQuery: this._config.autoDetectSearchQuery,
                searchPagePath: this._config.searchPagePath,
                searchQueryParam: this._config.searchQueryParam,
                searchStartsNewChat: this._config.searchStartsNewChat
            }
        };

        console.log('[AgentforceChatInlineContainer] Registered container:', this._containerId);

        // Check if there's already an active conversation to display
        // This handles navigation from FAB mode or other inline pages
        this._checkForActiveConversation();

        // Check for search query if on search page
        this._detectSearchQuery();
    }

    renderedCallback() {
        // Update the element reference
        const container = document.getElementById(this._containerId);
        if (container && window.__agentforceChatInlineContainer) {
            window.__agentforceChatInlineContainer.element = container;
        }
    }

    disconnectedCallback() {
        // Clean up global registration
        if (window.__agentforceChatInlineContainer?.id === this._containerId) {
            window.__agentforceChatInlineContainer = null;
            console.log('[AgentforceChatInlineContainer] Unregistered container');
        }
    }

    // ==================== CONFIGURATION ====================

    /**
     * Apply configuration from CPE (configJson)
     */
    _applyConfig() {
        if (this._configApplied) {
            return;
        }

        // Start with defaults
        let config = { ...AgentforceChatInlineContainer.DEFAULTS };

        // Apply configJson from CPE if provided
        if (this.configJson) {
            try {
                const parsed = typeof this.configJson === 'string'
                    ? JSON.parse(this.configJson)
                    : this.configJson;
                config = { ...config, ...parsed };
                console.log('[AgentforceChatInlineContainer] Applied config from CPE:', config);
            } catch (e) {
                console.error('[AgentforceChatInlineContainer] Failed to parse configJson:', e);
            }
        }

        this._config = config;
        this._configApplied = true;
    }

    // ==================== ACTIVE CONVERSATION DETECTION ====================

    /**
     * Check if there's already an active conversation that should be displayed
     * This handles navigation from FAB mode or between inline pages
     */
    _checkForActiveConversation() {
        // Short delay to let the page settle
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            this._detectAndProjectActiveConversation();
        }, 300);
    }

    /**
     * Detect if embedded-messaging has an active conversation and project it
     */
    _detectAndProjectActiveConversation() {
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (!embeddedMessaging) {
            console.log('[AgentforceChatInlineContainer] No embedded-messaging element found');
            return;
        }

        // Check if chat iframe exists and is maximized (active conversation)
        const iframe = embeddedMessaging.querySelector('iframe[name="embeddedMessagingFrame"]');
        const isMaximized = iframe?.classList.contains('isMaximized');

        // Also check for any chat content as backup indicator
        const hasContent = embeddedMessaging.querySelector('[class*="conversation"]') ||
                          embeddedMessaging.querySelector('[class*="message"]') ||
                          (iframe && iframe.offsetHeight > 0);

        console.log('[AgentforceChatInlineContainer] Active conversation check:', {
            hasEmbeddedMessaging: true,
            hasIframe: !!iframe,
            isMaximized,
            hasContent
        });

        if (isMaximized || hasContent) {
            console.log('[AgentforceChatInlineContainer] Active conversation detected, hiding welcome and projecting');

            // Hide welcome screen
            this._hideWelcome();

            // Dispatch event to trigger projection from core component
            // Use a custom event that the core component listens for
            document.dispatchEvent(new CustomEvent('agentforceProjectChat', {
                detail: { containerId: this._containerId },
                bubbles: true,
                composed: true
            }));
        }
    }

    // ==================== SEARCH DETECTION ====================

    /**
     * Detect if on a search page and extract the search query
     */
    _detectSearchQuery() {
        if (!this._config.autoDetectSearchQuery) {
            return;
        }

        const searchPath = this._config.searchPagePath;
        const queryParam = this._config.searchQueryParam;
        const currentPath = window.location.pathname;
        const isSearchPage = currentPath.includes(searchPath);

        console.log('[AgentforceChatInlineContainer] Checking for search query:', {
            currentPath,
            searchPagePath: searchPath,
            isSearchPage
        });

        if (isSearchPage) {
            // Try to get query from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            let searchQuery = urlParams.get(queryParam);

            // Also check for path-based search (e.g., /global-search/my%20query)
            if (!searchQuery && currentPath.includes(searchPath + '/')) {
                const pathParts = currentPath.split(searchPath + '/');
                if (pathParts.length > 1) {
                    searchQuery = decodeURIComponent(pathParts[1].split('/')[0]);
                }
            }

            if (searchQuery) {
                console.log('[AgentforceChatInlineContainer] Found search query:', searchQuery);
                this._inputMessage = searchQuery;

                // Auto-send after a short delay to let chat initialize
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => {
                    this._autoSendSearchQuery(searchQuery);
                }, 1500);
            }
        }
    }

    /**
     * Auto-send the search query to the chat
     */
    _autoSendSearchQuery(query) {
        console.log('[AgentforceChatInlineContainer] Auto-sending search query:', query);

        // Dispatch chatstart event with the search query
        this.dispatchEvent(new CustomEvent('chatstart', {
            detail: {
                message: query,
                isSearchQuery: true,
                searchStartsNewChat: this._config.searchStartsNewChat
            },
            bubbles: true,
            composed: true
        }));

        // Hide welcome screen
        this._hideWelcome();
    }

    // ==================== COMPUTED PROPERTIES ====================

    get containerId() {
        return this._containerId;
    }

    get wrapperStyle() {
        const h = this._config.height;
        const w = this._config.widthPercent;
        let style = `height: ${h}px; width: ${w}%;`;
        if (w < 100) {
            style += ' margin: 0 auto;';
        }
        return style;
    }

    get containerStyle() {
        return `--gradient-start: ${this._config.gradientStartColor}; --gradient-mid: ${this._config.gradientMidColor}; --gradient-end: ${this._config.gradientEndColor};`;
    }

    get isWelcomeVisible() {
        return this._isWelcomeVisible && this._config.showWelcomeScreen !== false;
    }

    get isSendDisabled() {
        return !this._inputMessage || this._inputMessage.trim() === '';
    }

    get inputMessage() {
        return this._inputMessage;
    }

    get welcomeTitleStyle() {
        return `color: ${this._config.welcomeTitleColor};`;
    }

    get calloutStyle() {
        let style = `color: ${this._config.calloutColor};`;
        if (this._config.calloutBold) {
            style += ` font-weight: ${this._config.calloutFontWeight || '700'};`;
        }
        if (this._config.calloutItalic) {
            style += ' font-style: italic;';
        }
        return style;
    }

    get agentIconStyle() {
        const color = this._config.agentPrimaryColor;
        return `background: linear-gradient(135deg, ${color} 0%, ${this._darkenColor(color, 40)} 100%);`;
    }

    get sendButtonStyle() {
        if (this.isSendDisabled) {
            return '';
        }
        return `background-color: ${this._config.sendButtonColor};`;
    }

    /**
     * Parses the welcome title and splits it into parts for rendering
     */
    get titleParts() {
        const title = this._config.welcomeTitle || '';
        const callout = this._config.calloutWord || '';

        if (!callout) {
            return [{ text: title, isCallout: false }];
        }

        const lowerTitle = title.toLowerCase();
        const lowerCallout = callout.toLowerCase();
        const index = lowerTitle.indexOf(lowerCallout);

        if (index === -1) {
            return [{ text: title, isCallout: false }];
        }

        const parts = [];
        if (index > 0) {
            parts.push({ text: title.substring(0, index), isCallout: false });
        }
        parts.push({
            text: title.substring(index, index + callout.length),
            isCallout: true
        });
        if (index + callout.length < title.length) {
            parts.push({
                text: title.substring(index + callout.length),
                isCallout: false
            });
        }
        return parts;
    }

    get displayWelcomeMessage() {
        return this._config.welcomeMessage;
    }

    // ==================== EVENT HANDLERS ====================

    handleInputChange(event) {
        this._inputMessage = event.target.value;
    }

    handleKeyUp(event) {
        if (event.key === 'Enter' && !this.isSendDisabled) {
            this.handleSendMessage();
        }
    }

    handleSendMessage() {
        if (this.isSendDisabled) {
            return;
        }

        const messageText = this._inputMessage.trim();
        console.log('[AgentforceChatInlineContainer] User sent message:', messageText);

        // Dispatch event to notify the core component
        this.dispatchEvent(new CustomEvent('chatstart', {
            detail: { message: messageText },
            bubbles: true,
            composed: true
        }));

        // Hide welcome screen
        this._hideWelcome();
    }

    // ==================== INTERNAL METHODS ====================

    _hideWelcome() {
        console.log('[AgentforceChatInlineContainer] _hideWelcome called, setting _isWelcomeVisible = false');
        this._isWelcomeVisible = false;
        this._inputMessage = '';
    }

    _showWelcome() {
        this._isWelcomeVisible = true;
        this._inputMessage = '';
    }

    _showChat() {
        this._isWelcomeVisible = false;
    }

    /**
     * Reset the container to initial state (show welcome screen)
     * Called when chat is ended/minimized in inline mode
     */
    _reset() {
        console.log('[AgentforceChatInlineContainer] Resetting to welcome screen');
        this._isWelcomeVisible = true;
        this._inputMessage = '';
    }

    _darkenColor(hex, percent) {
        hex = hex.replace('#', '');
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);
        r = Math.max(0, Math.floor(r * (1 - percent / 100)));
        g = Math.max(0, Math.floor(g * (1 - percent / 100)));
        b = Math.max(0, Math.floor(b * (1 - percent / 100)));
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
}
