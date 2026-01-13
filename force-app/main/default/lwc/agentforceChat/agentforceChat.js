import { LightningElement, api } from 'lwc';

/**
 * @description Agentforce Chat - Core Component
 * Initializes Salesforce Embedded Service Deployment (Enhanced Web V2).
 *
 * ARCHITECTURE:
 * - This component handles the Embedded Service initialization
 * - If an agentforceChatInlineContainer exists, the chat UI is projected into it
 * - If no container exists, the chat appears as a floating FAB
 *
 * SETUP REQUIRED:
 * 1. Add the Embedded Service Deployment code snippet to Experience Builder Head Markup
 * 2. MODIFY the snippet to NOT auto-call init() - remove or comment out the init() call
 * 3. Place this component on your page (can be hidden/minimal)
 * 4. Optionally place agentforceChatInlineContainer where you want inline chat
 * 5. Configure via CPE with your Org ID, Deployment Name, Site URL, and SCRT URL
 */
export default class AgentforceChat extends LightningElement {
    // Use Light DOM for compatibility
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

    // ==================== INTERNAL STATE ====================

    _configApplied = false;
    _bootstrapInitialized = false;
    _checkAttempts = 0;
    _maxCheckAttempts = 50;
    _messagingReadyHandler = null;
    _chatStartHandler = null;
    _conversationStartHandler = null;
    _navigationHandler = null;
    _pendingMessage = null;
    _projectionAttempts = 0;
    _projectionComplete = false;
    _messageSent = false;
    _lastUrl = null;

    // ==================== COMPUTED PROPERTIES ====================

    get hasRequiredConfig() {
        return this.orgId && this.deploymentDeveloperName && this.siteUrl && this.scrtUrl;
    }

    /**
     * Check if an inline container component exists on the page
     */
    get hasInlineContainer() {
        return !!window.__agentforceChatInlineContainer;
    }

    // ==================== LIFECYCLE ====================

    connectedCallback() {
        this._applyConfigJson();

        // Listen for chatstart event from inline container
        this._chatStartHandler = this._handleChatStart.bind(this);
        document.addEventListener('chatstart', this._chatStartHandler);

        // Listen for SPA navigation to re-evaluate FAB visibility
        this._setupNavigationListener();

        console.log('[AgentforceChat] Core component connected');
        console.log('[AgentforceChat] hasInlineContainer:', this.hasInlineContainer);
        console.log('[AgentforceChat] window.__agentforceChatInlineContainer:', window.__agentforceChatInlineContainer);
    }

    renderedCallback() {
        if (this._bootstrapInitialized || !this.hasRequiredConfig) {
            return;
        }

        // Wait a tick for inline container to register
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            this._waitForBootstrapAndInit();
        }, 100);
    }

    disconnectedCallback() {
        // Clean up event listeners
        if (this._messagingReadyHandler) {
            window.removeEventListener('onEmbeddedMessagingReady', this._messagingReadyHandler);
            this._messagingReadyHandler = null;
        }
        if (this._chatStartHandler) {
            document.removeEventListener('chatstart', this._chatStartHandler);
            this._chatStartHandler = null;
        }
        if (this._conversationStartHandler) {
            window.removeEventListener('onEmbeddedMessagingConversationStarted', this._conversationStartHandler);
            this._conversationStartHandler = null;
        }
        if (this._navigationHandler) {
            window.removeEventListener('popstate', this._navigationHandler);
            this._navigationHandler = null;
        }
        if (this._navigationInterval) {
            clearInterval(this._navigationInterval);
            this._navigationInterval = null;
        }
        this._bootstrapInitialized = false;
    }

    // ==================== NAVIGATION HANDLING ====================

    /**
     * Set up listener for SPA navigation to re-evaluate FAB visibility
     */
    _setupNavigationListener() {
        this._lastUrl = window.location.href;

        // Listen for browser back/forward
        this._navigationHandler = () => {
            this._handleNavigation();
        };
        window.addEventListener('popstate', this._navigationHandler);

        // Also poll for URL changes (handles programmatic navigation)
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._navigationInterval = setInterval(() => {
            if (window.location.href !== this._lastUrl) {
                this._lastUrl = window.location.href;
                this._handleNavigation();
            }
        }, 500);
    }

    /**
     * Handle navigation - re-evaluate FAB visibility
     */
    _handleNavigation() {
        console.log('[AgentforceChat] Navigation detected, re-evaluating FAB visibility');

        // Wait a tick for the new page's inline container to register (or unregister)
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const hasContainer = this.hasInlineContainer;
            console.log('[AgentforceChat] After navigation - hasInlineContainer:', hasContainer);

            this._updateFabVisibility(hasContainer);

            // Reset projection state for new page
            if (hasContainer) {
                this._projectionComplete = false;
                this._projectionAttempts = 0;
            }
        }, 300);
    }

    /**
     * Update FAB visibility based on whether inline container exists
     */
    _updateFabVisibility(hasContainer) {
        const hidingStyleId = 'agentforce-hide-fab-styles';
        const initialHidingStyleId = 'agentforce-initial-hiding-styles';

        if (hasContainer) {
            // Hide the FAB
            console.log('[AgentforceChat] Hiding FAB (inline container present)');
            this._hideFabButton();
            this._injectInitialHidingStyles();
        } else {
            // Show the FAB - remove hiding styles
            console.log('[AgentforceChat] Showing FAB (no inline container)');

            const hidingStyle = document.getElementById(hidingStyleId);
            if (hidingStyle) {
                hidingStyle.remove();
                console.log('[AgentforceChat] Removed FAB hiding styles');
            }

            const initialStyle = document.getElementById(initialHidingStyleId);
            if (initialStyle) {
                initialStyle.remove();
                console.log('[AgentforceChat] Removed initial hiding styles');
            }

            // Also remove classes from embedded-messaging
            const embeddedMessaging = document.getElementById('embedded-messaging');
            if (embeddedMessaging) {
                embeddedMessaging.classList.remove('projected-inline', 'show-chat');
            }
        }
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

            // Share design tokens globally for inline container to use
            this._shareDesignTokens(config);

            this._configApplied = true;
        } catch (e) {
            console.error('[AgentforceChat] Failed to parse configJson:', e);
        }
    }

    /**
     * Share design tokens globally so inline container can apply them
     */
    _shareDesignTokens(config) {
        window.__agentforceChatDesignTokens = {
            // Welcome screen
            gradientStartColor: config.gradientStartColor,
            gradientMidColor: config.gradientMidColor,
            gradientEndColor: config.gradientEndColor,
            welcomeTitle: config.welcomeTitle,
            welcomeTitleColor: config.welcomeTitleColor,
            calloutWord: config.calloutWord,
            calloutColor: config.calloutColor,
            calloutBold: config.calloutBold,
            calloutItalic: config.calloutItalic,
            calloutFontWeight: config.calloutFontWeight,
            welcomeMessage: config.welcomeMessage,
            // Branding
            agentPrimaryColor: config.agentPrimaryColor,
            sendButtonColor: config.sendButtonColor,
            // Display
            height: config.height,
            widthPercent: config.widthPercent,
            // Search/conditional
            autoDetectSearchQuery: config.enableConditionalDisplay,
            searchPagePath: config.conditionalPathPattern,
            searchQueryParam: config.conditionalQueryParam,
            searchStartsNewChat: config.searchStartsNewChat !== false // Default true
        };

        console.log('[AgentforceChat] Shared design tokens:', window.__agentforceChatDesignTokens);

        // Dispatch event for any listening components
        window.dispatchEvent(new CustomEvent('agentforceDesignTokensReady', {
            detail: window.__agentforceChatDesignTokens
        }));
    }

    // ==================== BOOTSTRAP INITIALIZATION ====================

    _waitForBootstrapAndInit() {
        if (this._bootstrapInitialized) {
            return;
        }

        if (window.embeddedservice_bootstrap) {
            console.log('[AgentforceChat] Bootstrap available, initializing...');
            this._initializeChat();
            return;
        }

        // Load the bootstrap script
        this._loadBootstrapScript();
    }

    _loadBootstrapScript() {
        const existingScript = document.querySelector('script[src*="bootstrap.min.js"]');
        if (existingScript) {
            this._waitForBootstrap();
            return;
        }

        console.log('[AgentforceChat] Loading bootstrap script');
        const script = document.createElement('script');
        script.src = `${this.siteUrl}/assets/js/bootstrap.min.js`;
        script.type = 'text/javascript';

        script.onload = () => {
            console.log('[AgentforceChat] Bootstrap script loaded');
            this._initializeChat();
        };

        script.onerror = (error) => {
            console.error('[AgentforceChat] Failed to load bootstrap script:', error);
        };

        document.body.appendChild(script);
    }

    _waitForBootstrap() {
        this._checkAttempts++;

        if (window.embeddedservice_bootstrap) {
            this._initializeChat();
            return;
        }

        if (this._checkAttempts >= this._maxCheckAttempts) {
            console.error('[AgentforceChat] Timeout waiting for bootstrap');
            return;
        }

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => this._waitForBootstrap(), 100);
    }

    /**
     * Initialize the Embedded Service in floating mode
     * The chat UI will be projected into the inline container if one exists
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

            const hasContainer = this.hasInlineContainer;
            console.log('[AgentforceChat] Initializing chat:', {
                hasInlineContainer: hasContainer,
                orgId: this.orgId,
                deployment: this.deploymentDeveloperName
            });

            // If we have an inline container, hide the floating UI initially
            // It will be shown after projection completes
            if (hasContainer) {
                this._injectInitialHidingStyles();
            }

            // Configure language
            bootstrap.settings.language = 'en_US';

            // Always use floating mode - we'll project the UI into the container
            // This avoids the SSE connection bug that clears inline mode UI
            console.log('[AgentforceChat] Using floating mode with projection');

            // Set up onEmbeddedMessagingReady listener
            this._setupMessagingReadyListener();

            // Initialize
            const initOptions = { scrt2URL: this.scrtUrl };
            console.log('[AgentforceChat] Calling bootstrap.init()');

            bootstrap.init(
                this.orgId,
                this.deploymentDeveloperName,
                this.siteUrl,
                initOptions
            );

            this._bootstrapInitialized = true;
            console.log('[AgentforceChat] Initialization complete');

        } catch (error) {
            console.error('[AgentforceChat] Initialization error:', error);
        }
    }

    /**
     * Inject styles to hide the floating chat UI initially (before projection)
     */
    _injectInitialHidingStyles() {
        const styleId = 'agentforce-initial-hiding-styles';
        if (document.getElementById(styleId)) {
            return;
        }

        const styles = document.createElement('style');
        styles.id = styleId;
        styles.textContent = `
            /* Hide the entire embedded-messaging (including FAB) when inline container exists */
            #embedded-messaging:not(.projected-inline) {
                display: none !important;
            }

            /* When projected, hide the FAB button but show the chat */
            #embedded-messaging.projected-inline [class*="fab"],
            #embedded-messaging.projected-inline [class*="Fab"],
            #embedded-messaging.projected-inline [class*="FAB"],
            #embedded-messaging.projected-inline [class*="minimized"],
            #embedded-messaging.projected-inline [class*="Minimized"],
            #embedded-messaging.projected-inline button[class*="embeddedMessaging"] {
                display: none !important;
            }
        `;
        document.head.appendChild(styles);
        console.log('[AgentforceChat] Injected initial hiding styles');
    }

    /**
     * Set up listener for onEmbeddedMessagingReady event
     */
    _setupMessagingReadyListener() {
        if (this._messagingReadyHandler) {
            window.removeEventListener('onEmbeddedMessagingReady', this._messagingReadyHandler);
        }

        this._messagingReadyHandler = () => {
            console.log('[AgentforceChat] onEmbeddedMessagingReady fired');
            console.log('[AgentforceChat] hasInlineContainer at ready:', this.hasInlineContainer);

            // If we have an inline container, hide the FAB but DON'T position yet
            // We'll position when the user starts chatting
            if (this.hasInlineContainer) {
                this._hideFabButton();
            }

            // Set up conversation start listener to send pending message
            this._setupConversationStartListener();
        };

        window.addEventListener('onEmbeddedMessagingReady', this._messagingReadyHandler);
    }

    /**
     * Set up listener for conversation start to send pending message
     */
    _setupConversationStartListener() {
        if (this._conversationStartHandler) {
            return; // Already set up
        }

        this._conversationStartHandler = () => {
            console.log('[AgentforceChat] Conversation started');
            this._sendPendingMessage();
        };

        // Listen for various conversation start events
        window.addEventListener('onEmbeddedMessagingConversationStarted', this._conversationStartHandler);

        // Also try after a delay when chat is launched (fallback)
        console.log('[AgentforceChat] Conversation start listener set up');
    }

    /**
     * Send the pending message to the agent
     */
    _sendPendingMessage() {
        if (!this._pendingMessage || this._messageSent) {
            console.log('[AgentforceChat] No pending message or already sent');
            return;
        }

        const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
        if (utilAPI?.sendTextMessage) {
            console.log('[AgentforceChat] Sending pending message:', this._pendingMessage);
            try {
                utilAPI.sendTextMessage(this._pendingMessage);
                this._messageSent = true;
                console.log('[AgentforceChat] Pending message sent successfully');
            } catch (error) {
                console.error('[AgentforceChat] Error sending pending message:', error);
                // Retry after a delay
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => this._sendPendingMessage(), 1000);
            }
        } else {
            console.log('[AgentforceChat] sendTextMessage API not available, retrying...');
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => this._sendPendingMessage(), 500);
        }
    }

    // ==================== CHAT PROJECTION ====================

    /**
     * Position the floating chat UI over the inline container using CSS
     * Instead of moving DOM elements (which causes fighting), we use CSS positioning
     */
    _projectChatToContainer() {
        // Guard against multiple projections
        if (this._projectionComplete) {
            console.log('[AgentforceChat] Projection already complete, skipping');
            return;
        }

        console.log('[AgentforceChat] _projectChatToContainer called, attempt:', this._projectionAttempts);

        const container = window.__agentforceChatInlineContainer;
        if (!container || !container.element) {
            console.log('[AgentforceChat] Inline container not ready, retrying...');
            this._projectionAttempts++;
            if (this._projectionAttempts < 10) {
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => this._projectChatToContainer(), 200);
            }
            return;
        }

        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (!embeddedMessaging) {
            console.log('[AgentforceChat] embedded-messaging not found, retrying...');
            this._projectionAttempts++;
            if (this._projectionAttempts < 10) {
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => this._projectChatToContainer(), 200);
            }
            return;
        }

        console.log('[AgentforceChat] Positioning chat over container:', container.id);

        // DON'T move the DOM - just add classes and inject positioning styles
        embeddedMessaging.classList.add('projected-inline');
        embeddedMessaging.classList.add('show-chat');

        // Store container reference for position updates
        this._containerElement = container.element;

        // Inject CSS that positions the chat over the container
        this._injectProjectionStyles();

        // Update position immediately and on scroll/resize
        this._updateChatPosition();
        window.addEventListener('scroll', () => this._updateChatPosition(), true);
        window.addEventListener('resize', () => this._updateChatPosition());

        // Hide the FAB button directly
        this._hideFabButton();

        this._projectionComplete = true;
        console.log('[AgentforceChat] Chat positioned successfully');
    }

    /**
     * Hide the FAB button using CSS (works even if FAB is in shadow DOM or created later)
     */
    _hideFabButton() {
        const styleId = 'agentforce-hide-fab-styles';
        if (document.getElementById(styleId)) {
            console.log('[AgentforceChat] FAB hiding styles already injected');
            return;
        }

        const styles = document.createElement('style');
        styles.id = styleId;
        styles.textContent = `
            /* Hide the FAB button when inline container exists */
            #embedded-messaging {
                /* Hide the minimized state (FAB) but not the maximized chat */
                visibility: hidden !important;
            }
            #embedded-messaging iframe[name="embeddedMessagingFrame"].isMaximized,
            #embedded-messaging iframe.isMaximized,
            #embedded-messaging.show-chat {
                visibility: visible !important;
            }
        `;
        document.head.appendChild(styles);
        console.log('[AgentforceChat] Injected FAB hiding styles');
    }

    /**
     * Update the chat position to overlay the container
     */
    _updateChatPosition() {
        if (!this._containerElement) return;

        const rect = this._containerElement.getBoundingClientRect();
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (!embeddedMessaging) return;

        // Set CSS custom properties for positioning
        embeddedMessaging.style.setProperty('--container-top', `${rect.top}px`);
        embeddedMessaging.style.setProperty('--container-left', `${rect.left}px`);
        embeddedMessaging.style.setProperty('--container-width', `${rect.width}px`);
        embeddedMessaging.style.setProperty('--container-height', `${rect.height}px`);
    }

    /**
     * Inject CSS to style the projected chat
     */
    _injectProjectionStyles() {
        const styleId = 'agentforce-projection-styles';
        if (document.getElementById(styleId)) {
            return;
        }

        const styles = document.createElement('style');
        styles.id = styleId;
        styles.textContent = `
            /* Position chat over the container using CSS custom properties */
            #embedded-messaging.projected-inline {
                opacity: 1 !important;
                pointer-events: auto !important;
                position: fixed !important;
                top: var(--container-top, 0) !important;
                left: var(--container-left, 0) !important;
                width: var(--container-width, 400px) !important;
                height: var(--container-height, 600px) !important;
                right: auto !important;
                bottom: auto !important;
                z-index: 1000 !important;
            }

            /* Style the iframe to fill the positioned container */
            #embedded-messaging.projected-inline iframe {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                max-width: none !important;
                max-height: none !important;
                border-radius: 12px !important;
                border: none !important;
            }

            /* Hide any FAB buttons when in projected mode */
            #embedded-messaging.projected-inline button {
                display: none !important;
            }

            /* Make inner container fill the space */
            #embedded-messaging.projected-inline > div {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
            }
        `;
        document.head.appendChild(styles);
    }

    // ==================== EVENT HANDLERS ====================

    /**
     * Handle chatstart event from inline container
     */
    _handleChatStart(event) {
        const { message, isSearchQuery } = event.detail || {};
        console.log('[AgentforceChat] Chat start requested:', message, 'isSearchQuery:', isSearchQuery);

        // Check if we should start a new chat or resume existing
        const searchStartsNewChat = window.__agentforceChatDesignTokens?.searchStartsNewChat !== false;

        // If this is a search query and searchStartsNewChat is false, just send the message
        // without launching a new chat session
        if (isSearchQuery && !searchStartsNewChat && this._bootstrapInitialized) {
            console.log('[AgentforceChat] Resuming existing chat with search query');

            // Hide the welcome screen
            const container = window.__agentforceChatInlineContainer;
            if (container?.hideWelcome) {
                container.hideWelcome();
            }

            // Project if not already done
            this._projectChatToContainer();

            // Send the message to existing conversation
            const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
            if (utilAPI?.sendTextMessage && message) {
                console.log('[AgentforceChat] Sending search query to existing chat:', message);
                try {
                    utilAPI.sendTextMessage(message);
                } catch (error) {
                    console.error('[AgentforceChat] Error sending search query:', error);
                }
            }
            return;
        }

        // Store the pending message
        if (message) {
            this._pendingMessage = message;
            this._messageSent = false; // Reset flag for new message
        }

        // Hide the welcome screen in the container
        const container = window.__agentforceChatInlineContainer;
        if (container?.hideWelcome) {
            container.hideWelcome();
        }

        // NOW position the chat over the container
        this._projectChatToContainer();

        // Launch the chat
        const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
        if (utilAPI?.launchChat) {
            console.log('[AgentforceChat] Launching chat');
            utilAPI.launchChat();

            // Try to send the pending message after a delay (fallback if event doesn't fire)
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                console.log('[AgentforceChat] Fallback: attempting to send pending message');
                this._sendPendingMessage();
            }, 2000);
        }
    }

    // ==================== PUBLIC API ====================

    @api
    launchChat() {
        const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
        if (utilAPI?.launchChat) {
            utilAPI.launchChat();
        }
    }

    @api
    isInitialized() {
        return this._bootstrapInitialized;
    }
}
