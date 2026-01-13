import { LightningElement, api } from 'lwc';

/**
 * @description Agentforce Chat - Embedded Service Inline Container
 * Hosts Salesforce Embedded Service Deployment (Enhanced Web V2) in inline mode.
 *
 * SETUP REQUIRED:
 * 1. Add the Embedded Service Deployment code snippet to Experience Builder Head Markup
 * 2. MODIFY the snippet to NOT auto-call init() - remove or comment out the init() call
 * 3. Place this component on your page
 * 4. Configure via CPE with your Org ID, Deployment Name, Site URL, and SCRT URL
 *
 * This component will:
 * - Provide the target container for inline mode
 * - Configure displayMode = 'inline' and targetElement
 * - Call embeddedservice_bootstrap.init() with your settings
 */
export default class AgentforceChat extends LightningElement {
    // Use Light DOM so Embedded Service can inject content
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
        this._applyConfigJson();
    }

    // Deployment Configuration
    @api orgId = '';
    @api deploymentDeveloperName = '';
    @api siteUrl = '';
    @api scrtUrl = '';

    // Display Configuration
    @api displayMode = 'inline';
    @api height = 600;
    @api widthPercent = 100;
    @api showHeader = false;

    // Welcome Screen Configuration (Inline Mode Only)
    @api gradientStartColor = '#e8f4fd';
    @api gradientMidColor = '#f5f9fc';
    @api gradientEndColor = '#ffffff';
    @api welcomeTitle = 'How can Agentforce help?';
    @api welcomeTitleColor = '#032d60';
    @api calloutWord = 'Agentforce';
    @api calloutColor = '#0176d3';
    @api calloutBold = false;
    @api calloutItalic = false;
    @api calloutFontWeight = '700';
    @api welcomeMessage = 'Ask questions, get personalized answers, and take action with Agentforce.';
    @api agentPrimaryColor = '#0176d3';
    @api sendButtonColor = '#0176d3';

    // Conditional Display
    @api enableConditionalDisplay = false;
    @api conditionalPathPattern = 'global-search';
    @api conditionalQueryParam = 'term';
    @api invertCondition = false;

    // ==================== INTERNAL STATE ====================

    _configApplied = false;
    _isLoading = true;
    _hasError = false;
    _errorMessage = '';
    _bootstrapInitialized = false;
    _containerId = null;
    _checkAttempts = 0;
    _maxCheckAttempts = 50; // 5 seconds max wait

    // Welcome Screen State (Inline Mode)
    _screenState = 'welcome'; // 'welcome' or 'chat'
    _inputMessage = '';
    _pendingFirstMessage = null; // Store message until chat is ready
    _messagingReadyHandler = null; // Store event handler reference

    // ==================== COMPUTED PROPERTIES ====================

    get wrapperClass() {
        return 'agentforce-chat-wrapper';
    }

    get wrapperStyle() {
        let style = `height: ${this.height}px; width: ${this.widthPercent}%;`;
        if (this.widthPercent < 100) {
            style += ' margin: 0 auto;';
        }
        return style;
    }

    get isLoading() {
        return this._isLoading && !this._hasError && this.hasRequiredConfig;
    }

    get hasError() {
        return this._hasError;
    }

    get errorMessage() {
        return this._errorMessage;
    }

    get showConfigRequired() {
        return !this.hasRequiredConfig && !this._hasError;
    }

    get hasRequiredConfig() {
        return this.orgId && this.deploymentDeveloperName && this.siteUrl && this.scrtUrl;
    }

    get containerId() {
        return this._containerId;
    }

    get showInlineContainer() {
        // Show the visible container when inline mode is configured
        return this.shouldDisplayInline;
    }

    get showFloatingContainer() {
        // Show hidden container for floating mode (bootstrap still needs an element reference)
        return !this.shouldDisplayInline;
    }

    get shouldDisplayInline() {
        if (!this.enableConditionalDisplay) {
            // Simple mode: just check displayMode property
            return this.displayMode === 'inline';
        }
        // Conditional mode: check URL conditions
        const matchesCondition = this._checkUrlCondition();
        return this.invertCondition ? !matchesCondition : matchesCondition;
    }

    // ==================== WELCOME SCREEN COMPUTED PROPERTIES ====================

    get showWelcomeScreen() {
        // Only show welcome screen in inline mode and when in welcome state
        return this.shouldDisplayInline && this._screenState === 'welcome' && this.hasRequiredConfig && !this._hasError;
    }

    get chatContainerClass() {
        // Chat container is always in DOM, but hidden when welcome screen is showing
        if (this._screenState === 'welcome') {
            return 'chat-container chat-container-behind';
        }
        return 'chat-container';
    }

    get containerStyle() {
        return `--gradient-start: ${this.gradientStartColor}; --gradient-mid: ${this.gradientMidColor}; --gradient-end: ${this.gradientEndColor};`;
    }

    /**
     * Parses the welcome title and splits it into parts for rendering
     * with the callout word styled separately
     */
    get titleParts() {
        const title = this.welcomeTitle || '';
        const callout = this.calloutWord || '';

        // If no callout word specified, return title as single part
        if (!callout) {
            return [{ text: title, isCallout: false }];
        }

        // Case-insensitive search for the callout word
        const lowerTitle = title.toLowerCase();
        const lowerCallout = callout.toLowerCase();
        const index = lowerTitle.indexOf(lowerCallout);

        // If callout word not found in title, return title as single part
        if (index === -1) {
            return [{ text: title, isCallout: false }];
        }

        const parts = [];

        // Text before callout
        if (index > 0) {
            parts.push({ text: title.substring(0, index), isCallout: false });
        }

        // The callout word (preserve original case from title)
        parts.push({
            text: title.substring(index, index + callout.length),
            isCallout: true
        });

        // Text after callout
        if (index + callout.length < title.length) {
            parts.push({
                text: title.substring(index + callout.length),
                isCallout: false
            });
        }

        return parts;
    }

    get welcomeTitleStyle() {
        return `color: ${this.welcomeTitleColor};`;
    }

    get calloutStyle() {
        let style = `color: ${this.calloutColor};`;

        if (this.calloutBold) {
            style += ` font-weight: ${this.calloutFontWeight};`;
        }

        if (this.calloutItalic) {
            style += ' font-style: italic;';
        }

        return style;
    }

    get agentIconStyle() {
        return `background: linear-gradient(135deg, ${this.agentPrimaryColor} 0%, ${this._darkenColor(this.agentPrimaryColor, 40)} 100%);`;
    }

    get sendButtonStyle() {
        if (this.isSendDisabled) {
            return '';
        }
        return `background-color: ${this.sendButtonColor};`;
    }

    get isSendDisabled() {
        return !this._inputMessage || this._inputMessage.trim() === '';
    }

    get inputMessage() {
        return this._inputMessage;
    }

    /**
     * Helper to darken a hex color by a percentage
     */
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

    // ==================== LIFECYCLE ====================

    connectedCallback() {
        this._applyConfigJson();
        this._containerId = 'agentforce-chat-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    }

    renderedCallback() {
        if (this._bootstrapInitialized || !this.hasRequiredConfig) {
            return;
        }

        // In inline mode with welcome screen showing, don't initialize yet
        // Wait until user sends first message (transitions to 'chat' state)
        if (this.shouldDisplayInline && this._screenState === 'welcome') {
            this._isLoading = false; // Not loading while showing welcome screen
            return;
        }

        this._waitForBootstrapAndInit();
    }

    disconnectedCallback() {
        this._bootstrapInitialized = false;
    }

    // ==================== CONFIGURATION ====================

    _applyConfigJson() {
        if (this._configApplied || !this.configJson) {
            return;
        }

        try {
            const config = typeof this.configJson === 'string'
                ? JSON.parse(this.configJson)
                : this.configJson;

            if (config.orgId !== undefined) this.orgId = config.orgId;
            if (config.deploymentDeveloperName !== undefined) this.deploymentDeveloperName = config.deploymentDeveloperName;
            if (config.siteUrl !== undefined) this.siteUrl = config.siteUrl;
            if (config.scrtUrl !== undefined) this.scrtUrl = config.scrtUrl;
            if (config.displayMode !== undefined) this.displayMode = config.displayMode;
            if (config.height !== undefined) this.height = config.height;
            if (config.widthPercent !== undefined) this.widthPercent = config.widthPercent;
            if (config.showHeader !== undefined) this.showHeader = config.showHeader;
            if (config.enableConditionalDisplay !== undefined) this.enableConditionalDisplay = config.enableConditionalDisplay;
            if (config.conditionalPathPattern !== undefined) this.conditionalPathPattern = config.conditionalPathPattern;
            if (config.conditionalQueryParam !== undefined) this.conditionalQueryParam = config.conditionalQueryParam;
            if (config.invertCondition !== undefined) this.invertCondition = config.invertCondition;

            // Welcome Screen Configuration
            if (config.gradientStartColor !== undefined) this.gradientStartColor = config.gradientStartColor;
            if (config.gradientMidColor !== undefined) this.gradientMidColor = config.gradientMidColor;
            if (config.gradientEndColor !== undefined) this.gradientEndColor = config.gradientEndColor;
            if (config.welcomeTitle !== undefined) this.welcomeTitle = config.welcomeTitle;
            if (config.welcomeTitleColor !== undefined) this.welcomeTitleColor = config.welcomeTitleColor;
            if (config.calloutWord !== undefined) this.calloutWord = config.calloutWord;
            if (config.calloutColor !== undefined) this.calloutColor = config.calloutColor;
            if (config.calloutBold !== undefined) this.calloutBold = config.calloutBold;
            if (config.calloutItalic !== undefined) this.calloutItalic = config.calloutItalic;
            if (config.calloutFontWeight !== undefined) this.calloutFontWeight = config.calloutFontWeight;
            if (config.welcomeMessage !== undefined) this.welcomeMessage = config.welcomeMessage;
            if (config.agentPrimaryColor !== undefined) this.agentPrimaryColor = config.agentPrimaryColor;
            if (config.sendButtonColor !== undefined) this.sendButtonColor = config.sendButtonColor;

            this._configApplied = true;
        } catch (e) {
            console.error('[AgentforceChat] Failed to parse configJson:', e);
        }
    }

    // ==================== URL CONDITION CHECKING ====================

    _checkUrlCondition() {
        try {
            const pathname = window.location.pathname.toLowerCase();
            const searchParams = new URLSearchParams(window.location.search);

            // Check path patterns (comma-separated, e.g., "home,global-search")
            if (this.conditionalPathPattern) {
                const patterns = this.conditionalPathPattern.split(',').map(p => p.trim().toLowerCase());
                for (const pattern of patterns) {
                    if (!pattern) continue;

                    // Special case: "home" or "/" matches the root/home page
                    if (pattern === 'home' || pattern === '/') {
                        // Match paths like /s/, /s, /sitename/, or ending with /home
                        if (pathname.match(/\/s\/?$/) || pathname.endsWith('/home') || pathname.match(/\/[^/]+\/?$/)) {
                            return true;
                        }
                    }

                    // General pattern matching
                    if (pathname.includes(pattern)) {
                        return true;
                    }
                }
            }

            // Check query parameters (comma-separated)
            if (this.conditionalQueryParam) {
                const params = this.conditionalQueryParam.split(',').map(p => p.trim());
                for (const param of params) {
                    if (param && searchParams.get(param)) {
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            console.error('[AgentforceChat] Error checking URL condition:', error);
            return false;
        }
    }

    // ==================== BOOTSTRAP INITIALIZATION ====================

    /**
     * Load the bootstrap script and initialize
     * Component loads the script itself for full control over initialization
     */
    _waitForBootstrapAndInit() {
        if (this._bootstrapInitialized) {
            return;
        }

        // Check if bootstrap is already loaded (from Head Markup or previous load)
        if (window.embeddedservice_bootstrap) {
            console.log('[AgentforceChat] Bootstrap already available, initializing...');
            this._initializeChat();
            return;
        }

        // Load the bootstrap script ourselves
        this._loadBootstrapScript();
    }

    /**
     * Load the Salesforce bootstrap script dynamically
     */
    _loadBootstrapScript() {
        // Check if script is already being loaded or exists
        const existingScript = document.querySelector('script[src*="bootstrap.min.js"]');
        if (existingScript) {
            console.log('[AgentforceChat] Bootstrap script already in DOM, waiting...');
            this._waitForBootstrap();
            return;
        }

        console.log('[AgentforceChat] Loading bootstrap script from:', this.siteUrl);

        const script = document.createElement('script');
        script.src = `${this.siteUrl}/assets/js/bootstrap.min.js`;
        script.type = 'text/javascript';

        script.onload = () => {
            console.log('[AgentforceChat] Bootstrap script loaded');
            this._initializeChat();
        };

        script.onerror = (error) => {
            console.error('[AgentforceChat] Failed to load bootstrap script:', error);
            this._hasError = true;
            this._errorMessage = 'Failed to load chat service. Check your Site URL configuration.';
            this._isLoading = false;
        };

        document.body.appendChild(script);
    }

    /**
     * Wait for bootstrap to become available (when loaded externally)
     */
    _waitForBootstrap() {
        this._checkAttempts++;

        if (window.embeddedservice_bootstrap) {
            this._initializeChat();
            return;
        }

        if (this._checkAttempts >= this._maxCheckAttempts) {
            this._hasError = true;
            this._errorMessage = 'Chat service timed out. Please refresh the page.';
            this._isLoading = false;
            return;
        }

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => this._waitForBootstrap(), 100);
    }

    /**
     * Configure and initialize the Embedded Service
     * Sets displayMode and targetElement BEFORE calling init()
     */
    _initializeChat() {
        if (this._bootstrapInitialized) {
            return;
        }

        try {
            const bootstrap = window.embeddedservice_bootstrap;

            if (!bootstrap) {
                throw new Error('embeddedservice_bootstrap not available');
            }

            // Determine display mode based on configuration
            const useInlineMode = this.shouldDisplayInline;

            console.log('[AgentforceChat] Configuring chat:', {
                useInlineMode,
                enableConditionalDisplay: this.enableConditionalDisplay,
                displayMode: this.displayMode,
                pathname: window.location.pathname
            });

            // Configure language
            bootstrap.settings.language = 'en_US';

            if (useInlineMode) {
                // Get the container element for inline mode
                let chatContainer = document.getElementById(this._containerId);

                if (!chatContainer) {
                    chatContainer = document.querySelector(`[id="${this._containerId}"]`);
                }

                console.log('[AgentforceChat] Container lookup:', this._containerId, chatContainer ? 'FOUND' : 'NOT FOUND');

                if (!chatContainer) {
                    // Element not found - retry after a short delay
                    this._checkAttempts++;
                    if (this._checkAttempts < 10) {
                        // eslint-disable-next-line @lwc/lwc/no-async-operation
                        setTimeout(() => this._initializeChat(), 200);
                        return;
                    }
                    throw new Error('Chat container element not found');
                }

                // Set inline mode settings BEFORE init()
                console.log('[AgentforceChat] Setting displayMode=inline and targetElement');
                bootstrap.settings.displayMode = 'inline';
                bootstrap.settings.targetElement = chatContainer;
                bootstrap.settings.headerEnabled = this.showHeader;
            } else {
                console.log('[AgentforceChat] Using default floating mode');
            }

            // Initialize with provided configuration
            const initOptions = {
                scrt2URL: this.scrtUrl
            };

            console.log('[AgentforceChat] Calling bootstrap.init()');
            bootstrap.init(
                this.orgId,
                this.deploymentDeveloperName,
                this.siteUrl,
                initOptions
            );

            this._bootstrapInitialized = true;
            this._isLoading = false;

            console.log('[AgentforceChat] Initialization complete:', {
                displayMode: useInlineMode ? 'inline' : 'floating'
            });

        } catch (error) {
            console.error('[AgentforceChat] Initialization error:', error);
            this._hasError = true;
            this._errorMessage = error.message || 'Failed to initialize chat service.';
            this._isLoading = false;
        }
    }

    // ==================== EVENT HANDLERS ====================

    handleRetry() {
        this._hasError = false;
        this._errorMessage = '';
        this._isLoading = true;
        this._bootstrapInitialized = false;
        this._checkAttempts = 0;

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            this._waitForBootstrapAndInit();
        }, 100);
    }

    // ==================== WELCOME SCREEN EVENT HANDLERS ====================

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
        if (!messageText) {
            return;
        }

        console.log('[AgentforceChat] User sent first message:', messageText);

        // Store the message (for potential future use)
        this._pendingFirstMessage = messageText;

        // Transition from welcome screen to embedded chat
        this._screenState = 'chat';
        this._inputMessage = '';

        // The renderedCallback will handle initialization
    }

    /**
     * Populate the embedded service chat input with the first message
     */
    _populateChatInput(messageText) {
        // Try to find the embedded service input field and populate it
        // For Agentforce/MIAW, look for the textarea in the messaging frame
        const frames = document.querySelectorAll('iframe');

        for (const iframe of frames) {
            try {
                if (iframe.contentDocument) {
                    const input = iframe.contentDocument.querySelector(
                        'textarea[placeholder], input[type="text"][placeholder]'
                    );
                    if (input) {
                        input.value = messageText;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));

                        // Try to find and click the send button
                        const sendBtn = iframe.contentDocument.querySelector(
                            'button[type="submit"], button[aria-label*="Send"], button[title*="Send"]'
                        );
                        if (sendBtn) {
                            // eslint-disable-next-line @lwc/lwc/no-async-operation
                            setTimeout(() => sendBtn.click(), 100);
                        }
                        console.log('[AgentforceChat] Message populated in chat input');
                        return;
                    }
                }
            } catch (e) {
                // Cross-origin iframe, skip it
            }
        }

        console.log('[AgentforceChat] Could not find chat input, message:', messageText);
    }

    // ==================== PUBLIC API ====================

    @api
    showChat() {
        if (window.embeddedservice_bootstrap?.utilAPI) {
            window.embeddedservice_bootstrap.utilAPI.launchChat();
        }
    }

    @api
    getDisplayMode() {
        return this.shouldDisplayInline ? 'inline' : 'floating';
    }

    @api
    isInitialized() {
        return this._bootstrapInitialized;
    }
}
