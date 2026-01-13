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
 * DESIGN TOKENS:
 * This component can receive design tokens from the core agentforceChat component's CPE.
 * Tokens are shared via window.__agentforceChatDesignTokens and the 'agentforceDesignTokensReady' event.
 * If tokens are available, they override the @api property defaults.
 */
export default class AgentforceChatInlineContainer extends LightningElement {
    // Use Light DOM so the projected chat content can be styled
    static renderMode = 'light';

    // Configuration - these are defaults, can be overridden by design tokens from CPE
    @api height = 600;
    @api widthPercent = 100;
    @api showWelcomeScreen;

    // Welcome Screen Configuration - defaults, overridden by design tokens
    @api gradientStartColor = '#e8f4fd';
    @api gradientMidColor = '#f5f9fc';
    @api gradientEndColor = '#ffffff';
    @api welcomeTitle = 'How can Agentforce help?';
    @api welcomeTitleColor = '#032d60';
    @api calloutWord = 'Agentforce';
    @api calloutColor = '#0176d3';
    @api welcomeMessage = 'Ask questions, get personalized answers, and take action with Agentforce.';
    @api agentPrimaryColor = '#0176d3';
    @api sendButtonColor = '#0176d3';

    // Search page configuration - can be set via CPE design tokens
    @api autoDetectSearchQuery = false;
    @api searchPagePath = '/global-search';
    @api searchQueryParam = 'term';

    // Internal state
    _containerId = null;
    _isWelcomeVisible = true;
    _inputMessage = '';

    // Design tokens from CPE (tracked for reactivity)
    @track _designTokens = null;
    _designTokensHandler = null;

    // ==================== LIFECYCLE ====================

    connectedCallback() {
        // Generate unique container ID
        this._containerId = 'agentforce-inline-container-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

        // Register this container globally so the core component can find it
        window.__agentforceChatInlineContainer = {
            id: this._containerId,
            element: null, // Will be set in renderedCallback
            showChat: () => this._showChat(),
            hideWelcome: () => this._hideWelcome(),
            getInputMessage: () => this._inputMessage
        };

        console.log('[AgentforceChatInlineContainer] Registered container:', this._containerId);

        // Check for design tokens from core component's CPE
        this._loadDesignTokens();

        // Listen for design tokens event (in case tokens arrive after we initialize)
        this._designTokensHandler = (event) => this._handleDesignTokensReady(event);
        window.addEventListener('agentforceDesignTokensReady', this._designTokensHandler);

        // Check for search query if on search page (after tokens are loaded)
        this._detectSearchQuery();
    }

    /**
     * Detect if on a search page and extract the search query
     */
    _detectSearchQuery() {
        // Use effective values from design tokens if available
        const autoDetect = this.effectiveAutoDetectSearchQuery;
        const searchPath = this.effectiveSearchPagePath;
        const queryParam = this.effectiveSearchQueryParam;

        if (autoDetect === false || !autoDetect) {
            return;
        }

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
            detail: { message: query, isSearchQuery: true },
            bubbles: true,
            composed: true
        }));

        // Hide welcome screen
        this._hideWelcome();
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

        // Clean up design tokens listener
        if (this._designTokensHandler) {
            window.removeEventListener('agentforceDesignTokensReady', this._designTokensHandler);
            this._designTokensHandler = null;
        }
    }

    // ==================== DESIGN TOKENS ====================

    /**
     * Load design tokens from the global object (set by core component's CPE)
     */
    _loadDesignTokens() {
        if (window.__agentforceChatDesignTokens) {
            this._designTokens = { ...window.__agentforceChatDesignTokens };
            console.log('[AgentforceChatInlineContainer] Loaded design tokens:', this._designTokens);
        } else {
            console.log('[AgentforceChatInlineContainer] No design tokens available yet');
        }
    }

    /**
     * Handle design tokens ready event
     */
    _handleDesignTokensReady(event) {
        console.log('[AgentforceChatInlineContainer] Design tokens ready event received');
        this._designTokens = { ...event.detail };
        console.log('[AgentforceChatInlineContainer] Applied design tokens:', this._designTokens);
    }

    /**
     * Get effective value - token value if available, otherwise @api property value
     */
    _getToken(tokenName, defaultValue) {
        if (this._designTokens && this._designTokens[tokenName] !== undefined && this._designTokens[tokenName] !== null) {
            return this._designTokens[tokenName];
        }
        return defaultValue;
    }

    // ==================== COMPUTED PROPERTIES ====================
    // These use design tokens from CPE when available, falling back to @api defaults

    get containerId() {
        return this._containerId;
    }

    // Effective values (token or @api default)
    get effectiveHeight() {
        return this._getToken('height', this.height);
    }

    get effectiveWidthPercent() {
        return this._getToken('widthPercent', this.widthPercent);
    }

    get effectiveGradientStartColor() {
        return this._getToken('gradientStartColor', this.gradientStartColor);
    }

    get effectiveGradientMidColor() {
        return this._getToken('gradientMidColor', this.gradientMidColor);
    }

    get effectiveGradientEndColor() {
        return this._getToken('gradientEndColor', this.gradientEndColor);
    }

    get effectiveWelcomeTitle() {
        return this._getToken('welcomeTitle', this.welcomeTitle);
    }

    get effectiveWelcomeTitleColor() {
        return this._getToken('welcomeTitleColor', this.welcomeTitleColor);
    }

    get effectiveCalloutWord() {
        return this._getToken('calloutWord', this.calloutWord);
    }

    get effectiveCalloutColor() {
        return this._getToken('calloutColor', this.calloutColor);
    }

    get effectiveWelcomeMessage() {
        return this._getToken('welcomeMessage', this.welcomeMessage);
    }

    get effectiveAgentPrimaryColor() {
        return this._getToken('agentPrimaryColor', this.agentPrimaryColor);
    }

    get effectiveSendButtonColor() {
        return this._getToken('sendButtonColor', this.sendButtonColor);
    }

    get effectiveAutoDetectSearchQuery() {
        return this._getToken('autoDetectSearchQuery', this.autoDetectSearchQuery);
    }

    get effectiveSearchPagePath() {
        return this._getToken('searchPagePath', this.searchPagePath);
    }

    get effectiveSearchQueryParam() {
        return this._getToken('searchQueryParam', this.searchQueryParam);
    }

    get effectiveSearchStartsNewChat() {
        return this._getToken('searchStartsNewChat', true); // Default to true
    }

    get wrapperStyle() {
        const h = this.effectiveHeight;
        const w = this.effectiveWidthPercent;
        let style = `height: ${h}px; width: ${w}%;`;
        if (w < 100) {
            style += ' margin: 0 auto;';
        }
        return style;
    }

    get containerStyle() {
        return `--gradient-start: ${this.effectiveGradientStartColor}; --gradient-mid: ${this.effectiveGradientMidColor}; --gradient-end: ${this.effectiveGradientEndColor};`;
    }

    get isWelcomeVisible() {
        // showWelcomeScreen defaults to false in JS but true in meta.xml
        // Check for !== false to handle undefined/true cases
        return this._isWelcomeVisible && this.showWelcomeScreen !== false;
    }

    get isSendDisabled() {
        return !this._inputMessage || this._inputMessage.trim() === '';
    }

    get inputMessage() {
        return this._inputMessage;
    }

    get welcomeTitleStyle() {
        return `color: ${this.effectiveWelcomeTitleColor};`;
    }

    get calloutStyle() {
        return `color: ${this.effectiveCalloutColor}; font-weight: 700;`;
    }

    get agentIconStyle() {
        const color = this.effectiveAgentPrimaryColor;
        return `background: linear-gradient(135deg, ${color} 0%, ${this._darkenColor(color, 40)} 100%);`;
    }

    get sendButtonStyle() {
        if (this.isSendDisabled) {
            return '';
        }
        return `background-color: ${this.effectiveSendButtonColor};`;
    }

    /**
     * Parses the welcome title and splits it into parts for rendering
     */
    get titleParts() {
        const title = this.effectiveWelcomeTitle || '';
        const callout = this.effectiveCalloutWord || '';

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
        return this.effectiveWelcomeMessage;
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
        this._isWelcomeVisible = false;
        this._inputMessage = '';
    }

    _showChat() {
        this._isWelcomeVisible = false;
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
