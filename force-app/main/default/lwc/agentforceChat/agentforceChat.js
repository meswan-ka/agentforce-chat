import { LightningElement, api, wire } from 'lwc';
import { publish, MessageContext } from 'lightning/messageService';
import AGENTFORCE_SESSION_CHANNEL from '@salesforce/messageChannel/AgentforceSessionChannel__c';
// Note: The __c suffix is required in the import path even though the file is named without it

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

    // ==================== LMS MESSAGE CONTEXT ====================

    @wire(MessageContext)
    messageContext;

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
    _containerElement = null;
    _navigationCheckTimeout = null;
    _navigationCheckCount = 0;
    _apiReady = false;
    _queuedChatStart = null;
    _minimizeObserver = null;
    _inFabModeOverride = false;
    _greetingWatcherActive = false;

    // Activity tracking state
    _sessionId = null;
    _messageCount = 0;
    _embeddedEventHandlers = {};
    // Track if conversation has ended - use getter/setter to persist in sessionStorage
    // This survives SPA navigation where component reconnects
    get _conversationEnded() {
        return sessionStorage.getItem('agentforce_conversation_ended') === 'true';
    }
    set _conversationEnded(value) {
        if (value) {
            sessionStorage.setItem('agentforce_conversation_ended', 'true');
        } else {
            sessionStorage.removeItem('agentforce_conversation_ended');
        }
    }

    // ==================== COMPUTED PROPERTIES ====================

    get hasRequiredConfig() {
        return this.orgId && this.deploymentDeveloperName && this.siteUrl && this.scrtUrl;
    }

    /**
     * Check if an inline container component exists AND is visible on the page
     * In Experience Cloud SPA, components may stay registered even when not visible
     */
    get hasInlineContainer() {
        const container = window.__agentforceChatInlineContainer;
        if (!container) {
            return false;
        }

        // Check if the container element is actually in the DOM and visible
        const element = container.element || document.getElementById(container.id);
        if (!element) {
            return false;
        }

        // Check if element is connected to DOM
        if (!element.isConnected) {
            return false;
        }

        // Check if element has dimensions (not collapsed)
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            return false;
        }

        // Walk up the DOM tree to check if ANY parent is hidden
        // Experience Cloud SPA hides pages by hiding parent containers
        let current = element;
        while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            // Also check for common SPA hiding patterns
            if (current.hasAttribute('hidden') || current.classList.contains('slds-hide')) {
                return false;
            }
            current = current.parentElement;
        }

        // Final check: is the element actually visible in viewport or at least rendered?
        // An element with rect but off-screen is still "on this page"
        // But if rect.top is extremely large negative, page might have scrolled away
        if (rect.bottom < -5000 || rect.top > 10000) {
            return false;
        }

        return true;
    }

    // ==================== LIFECYCLE ====================

    connectedCallback() {
        this._applyConfigJson();

        // Listen for chatstart event from inline container
        this._chatStartHandler = this._handleChatStart.bind(this);
        document.addEventListener('chatstart', this._chatStartHandler);

        // Listen for projection request from inline container (when it detects active conversation)
        this._projectChatHandler = this._handleProjectChatRequest.bind(this);
        document.addEventListener('agentforceProjectChat', this._projectChatHandler);

        // Listen for SPA navigation to re-evaluate FAB visibility
        this._setupNavigationListener();

        console.log('[AgentforceChat] Core component connected at URL:', window.location.href);
        console.log('[AgentforceChat] hasInlineContainer:', this.hasInlineContainer);
        console.log('[AgentforceChat] window.__agentforceChatInlineContainer:', window.__agentforceChatInlineContainer);
        console.log('[AgentforceChat] Session state - sessionId:', this._sessionId, 'messageCount:', this._messageCount);
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
        if (this._projectChatHandler) {
            document.removeEventListener('agentforceProjectChat', this._projectChatHandler);
            this._projectChatHandler = null;
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
        if (this._navigationCheckTimeout) {
            clearTimeout(this._navigationCheckTimeout);
            this._navigationCheckTimeout = null;
        }
        if (this._minimizeObserver) {
            this._minimizeObserver.disconnect();
            this._minimizeObserver = null;
        }
        // Clean up activity event listeners
        this._cleanupActivityEventListeners();
        this._bootstrapInitialized = false;
    }

    // ==================== NAVIGATION HANDLING ====================

    /**
     * Set up listener for SPA navigation to re-evaluate FAB visibility
     */
    _setupNavigationListener() {
        this._lastUrl = window.location.href;
        console.log('[AgentforceChat] Setting up navigation listener, initial URL:', this._lastUrl);

        // Listen for browser back/forward
        this._navigationHandler = () => {
            this._handleNavigation();
        };
        window.addEventListener('popstate', this._navigationHandler);

        // Also poll for URL changes (handles programmatic navigation)
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._navigationInterval = setInterval(() => {
            const currentUrl = window.location.href;
            if (currentUrl !== this._lastUrl) {
                console.log('[AgentforceChat] URL change detected:', this._lastUrl, '->', currentUrl);
                this._lastUrl = currentUrl;
                this._handleNavigation();
            }
        }, 500);
    }

    /**
     * Handle navigation - re-evaluate chat position (inline or FAB)
     * Uses multiple checks to handle Experience Cloud SPA timing
     */
    _handleNavigation() {
        console.log('[AgentforceChat] Navigation detected, re-evaluating chat position');

        // Clear any pending navigation checks
        if (this._navigationCheckTimeout) {
            clearTimeout(this._navigationCheckTimeout);
        }

        // Reset FAB mode override on navigation - allows returning to inline mode
        this._inFabModeOverride = false;

        // Always reset projection state on navigation
        // The container element changes between pages (different LWC instances)
        // This ensures we re-project with the correct container reference
        this._containerElement = null;
        this._projectionComplete = false;
        this._projectionAttempts = 0;

        // Restore container visibility if it was hidden by FAB switch
        const container = window.__agentforceChatInlineContainer;
        if (container?.element && container.element.style.display === 'none') {
            container.element.style.display = '';
            console.log('[AgentforceChat] Restored inline container visibility');
        }

        // Check multiple times to handle LWC lifecycle timing
        this._navigationCheckCount = 0;
        this._performNavigationCheck();
    }

    /**
     * Perform a navigation check with retry logic
     */
    _performNavigationCheck() {
        this._navigationCheckCount++;
        const hasContainer = this.hasInlineContainer;
        const hasActiveConvo = this._hasActiveConversation();

        console.log(`[AgentforceChat] Navigation check #${this._navigationCheckCount}:`, {
            hasInlineContainer: hasContainer,
            hasActiveConversation: hasActiveConvo,
            projectionComplete: this._projectionComplete,
            sessionId: this._sessionId,
            messageCount: this._messageCount
        });

        // If container found, hide FAB and project chat if active
        if (hasContainer) {
            this._updateFabVisibility(true);

            // If there's an active conversation, project it into the container
            // Projection state was already reset in _handleNavigation()
            if (hasActiveConvo && !this._projectionComplete) {
                console.log('[AgentforceChat] Active conversation detected, projecting into inline container');

                // Hide the inline container's welcome screen
                const container = window.__agentforceChatInlineContainer;
                console.log('[AgentforceChat] Container reference:', container?.id, 'hideWelcome:', !!container?.hideWelcome);
                if (container?.hideWelcome) {
                    container.hideWelcome();
                    console.log('[AgentforceChat] Called hideWelcome()');
                }

                // Project the active chat into the container
                this._projectChatToContainer();

                // If chat is minimized (FAB mode), auto-maximize it for inline display
                const embeddedMessaging = document.getElementById('embedded-messaging');
                const iframe = embeddedMessaging?.querySelector('iframe');
                const isMaximized = iframe?.classList.contains('isMaximized');
                if (!isMaximized) {
                    const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
                    if (utilAPI?.launchChat) {
                        console.log('[AgentforceChat] Chat is minimized, auto-maximizing for inline display');
                        utilAPI.launchChat();
                    }
                }
            }
        }
        // Only show FAB (cleanup inline styles) after final check confirms no container
        else if (this._navigationCheckCount >= 4) {
            console.log('[AgentforceChat] Final check - no container found, showing FAB');
            this._updateFabVisibility(false);
        }

        // Retry a few times to catch late-registering containers
        // Experience Cloud SPA can have variable timing
        if (this._navigationCheckCount < 4) {
            const delay = this._navigationCheckCount === 1 ? 300 : 600;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._navigationCheckTimeout = setTimeout(() => {
                this._performNavigationCheck();
            }, delay);
        }
    }

    /**
     * Check if there's an active conversation that should be preserved
     */
    _hasActiveConversation() {
        // Check 1: Session ID exists (conversation was started)
        if (this._sessionId) {
            console.log('[AgentforceChat] Active conversation: sessionId exists');
            return true;
        }

        // Check 2: Messages have been exchanged
        if (this._messageCount > 0) {
            console.log('[AgentforceChat] Active conversation: messageCount > 0');
            return true;
        }

        // Check 3: Chat iframe is maximized (visible)
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (embeddedMessaging) {
            let iframe = embeddedMessaging.querySelector('iframe[name="embeddedMessagingFrame"]');
            if (!iframe) {
                iframe = embeddedMessaging.querySelector('iframe');
            }
            if (iframe?.classList.contains('isMaximized')) {
                console.log('[AgentforceChat] Active conversation: iframe is maximized');
                return true;
            }
        }

        return false;
    }

    /**
     * Update FAB visibility based on whether inline container exists
     */
    _updateFabVisibility(hasContainer) {
        if (hasContainer) {
            // Hide the FAB
            console.log('[AgentforceChat] Hiding FAB (inline container present)');
            this._hideFabButton();
            this._injectInitialHidingStyles();
        } else {
            // Show the FAB - remove ALL injected styles
            console.log('[AgentforceChat] Showing FAB (no inline container)');
            this._cleanupInlineStyles();
        }
    }

    /**
     * Remove all inline-mode styles and reset to FAB mode
     */
    _cleanupInlineStyles() {
        const styleIds = [
            'agentforce-hide-fab-styles',
            'agentforce-initial-hiding-styles',
            'agentforce-projection-styles'
        ];

        styleIds.forEach(id => {
            const style = document.getElementById(id);
            if (style) {
                style.remove();
                console.log(`[AgentforceChat] Removed ${id}`);
            }
        });

        // Reset embedded-messaging element to FAB defaults
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (embeddedMessaging) {
            embeddedMessaging.classList.remove('projected-inline', 'show-chat');

            // Clear ALL inline styles to reset to default FAB positioning
            // Don't set visibility - let CSS rules control that
            embeddedMessaging.style.cssText = '';

            console.log('[AgentforceChat] Reset embedded-messaging element to FAB mode');
        }

        // Clear container reference
        this._containerElement = null;
        this._projectionComplete = false;
        this._projectionAttempts = 0;
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

            // Check if chat is already initialized (persists across SPA navigation)
            // If so, don't call init() again - just set up listeners and project
            const existingChat = document.getElementById('embedded-messaging');
            // Try multiple selectors - iframe name may vary
            let existingIframe = existingChat?.querySelector('iframe[name="embeddedMessagingFrame"]');
            if (!existingIframe) {
                existingIframe = existingChat?.querySelector('iframe');
            }

            console.log('[AgentforceChat] Checking for existing chat:', {
                existingChatElement: !!existingChat,
                existingIframe: !!existingIframe,
                allIframes: existingChat ? existingChat.querySelectorAll('iframe').length : 0,
                iframeNames: existingChat ? Array.from(existingChat.querySelectorAll('iframe')).map(f => f.name || f.id || 'unnamed') : []
            });

            if (existingChat && existingIframe) {
                console.log('[AgentforceChat] Chat already initialized, skipping bootstrap.init()');

                // Set up listeners without re-initializing
                this._setupMessagingReadyListener();
                this._bootstrapInitialized = true;

                // If we have an inline container, project the existing chat
                if (hasContainer) {
                    this._hideFabButton();

                    // Reset projection state to allow fresh projection to NEW container
                    this._containerElement = null;
                    this._projectionComplete = false;
                    this._projectionAttempts = 0;

                    // Remove old projection class so we can re-add with new position
                    existingChat.classList.remove('projected-inline', 'show-chat');

                    // ALWAYS hide welcome and project for FAB→inline or inline→inline navigation
                    // The chat exists and we're on an inline page, so hide welcome immediately
                    const container = window.__agentforceChatInlineContainer;
                    const isMaximized = existingIframe.classList.contains('isMaximized');
                    console.log('[AgentforceChat] Existing chat detected, hiding welcome and projecting');
                    console.log('[AgentforceChat] isMaximized:', isMaximized);

                    if (container?.hideWelcome) {
                        container.hideWelcome();
                    }

                    // Project immediately - position will be set correctly
                    this._projectChatToContainer();

                    // If chat is minimized (FAB mode), auto-maximize it for inline display
                    if (!isMaximized && bootstrap.utilAPI?.launchChat) {
                        console.log('[AgentforceChat] Chat is minimized, auto-maximizing for inline display');
                        bootstrap.utilAPI.launchChat();
                    }
                } else {
                    // No inline container on this page - clean up inline styles for FAB mode
                    this._cleanupInlineStyles();
                }

                // Trigger ready handler manually since onEmbeddedMessagingReady already fired
                if (bootstrap.utilAPI) {
                    console.log('[AgentforceChat] API already available, triggering ready handler');
                    this._apiReady = true;
                    this._setupConversationStartListener();
                    this._setupActivityEventListeners();
                }

                return;
            }

            console.log('[AgentforceChat] Initializing chat:', {
                hasInlineContainer: hasContainer,
                orgId: this.orgId,
                deployment: this.deploymentDeveloperName
            });

            // CRITICAL: If previous conversation ended, clear Embedded Service storage
            // BEFORE calling bootstrap.init() so it starts fresh.
            // This must happen BEFORE init(), not after, because once init() runs
            // it loads the cached ended conversation state and we can't reset it.
            if (this._conversationEnded) {
                console.log('[AgentforceChat] Previous conversation ended - clearing storage BEFORE init');
                this._clearEmbeddedServiceStoragePreInit();
                this._conversationEnded = false; // Clear our flag too
            }

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

            // Mark API as ready
            this._apiReady = true;

            // If we have an inline container, hide the FAB but DON'T position yet
            // We'll position when the user starts chatting
            if (this.hasInlineContainer) {
                this._hideFabButton();

                // Check if there's already an active conversation (e.g., from previous page)
                // This handles the case where component was recreated but chat persists
                this._checkAndProjectExistingConversation();
            }

            // Set up conversation start listener to send pending message
            this._setupConversationStartListener();

            // Set up activity event listeners for tracking
            this._setupActivityEventListeners();

            // Process any queued chat start
            if (this._queuedChatStart) {
                console.log('[AgentforceChat] Processing queued chat start');
                const event = this._queuedChatStart;
                this._queuedChatStart = null;
                this._handleChatStart(event);
            }

            // Auto-detect search query and start conversation (core component handles this
            // because inline container may re-render and lose its timeout)
            this._checkAndAutoStartFromSearch();
        };

        window.addEventListener('onEmbeddedMessagingReady', this._messagingReadyHandler);
    }

    /**
     * Check if on a search page and auto-start conversation with search query
     * This is handled in the core component because inline container may re-render
     * and lose its timeout before it fires
     */
    _checkAndAutoStartFromSearch() {
        // Get search config from inline container (preferred) or design tokens (fallback)
        const inlineContainer = window.__agentforceChatInlineContainer;
        const searchConfig = inlineContainer?.searchConfig || {};
        const tokens = window.__agentforceChatDesignTokens || {};

        const autoDetectSearch = searchConfig.autoDetectSearchQuery === true || tokens.autoDetectSearchQuery === true;
        const searchPagePath = searchConfig.searchPagePath || tokens.searchPagePath || '/global-search';
        const searchQueryParam = searchConfig.searchQueryParam || tokens.searchQueryParam || 'term';

        console.log('[AgentforceChat] Search config:', { autoDetectSearch, searchPagePath, searchQueryParam });

        if (!autoDetectSearch) {
            console.log('[AgentforceChat] Search auto-detect not enabled');
            return;
        }

        const currentPath = window.location.pathname;
        const isSearchPage = currentPath.includes(searchPagePath);

        console.log('[AgentforceChat] Checking for search query:', {
            autoDetectSearch,
            searchPagePath,
            currentPath,
            isSearchPage
        });

        if (!isSearchPage) {
            return;
        }

        // Extract search query from URL
        let searchQuery = null;

        // Try URL parameter first (e.g., ?term=query)
        const urlParams = new URLSearchParams(window.location.search);
        searchQuery = urlParams.get(searchQueryParam);

        // Try path-based search (e.g., /global-search/my%20query)
        if (!searchQuery && currentPath.includes(searchPagePath + '/')) {
            const pathParts = currentPath.split(searchPagePath + '/');
            if (pathParts.length > 1) {
                searchQuery = decodeURIComponent(pathParts[1].split('/')[0]);
            }
        }

        if (!searchQuery) {
            console.log('[AgentforceChat] No search query found in URL');
            return;
        }

        console.log('[AgentforceChat] Found search query:', searchQuery);

        // Check if there's already an active/maximized conversation
        const hasActiveChat = this._isConversationMaximized();

        if (hasActiveChat) {
            console.log('[AgentforceChat] Already have active conversation, not auto-starting');
            return;
        }

        // Small delay to let the page settle, then start conversation
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            console.log('[AgentforceChat] Auto-starting conversation from search query:', searchQuery);

            // Hide inline container welcome screen if present
            if (inlineContainer?.hideWelcome) {
                inlineContainer.hideWelcome();
            }

            // Create synthetic chatstart event
            const syntheticEvent = {
                detail: {
                    message: searchQuery,
                    isSearchQuery: true,
                    searchStartsNewChat: true
                }
            };

            this._handleChatStart(syntheticEvent);
        }, 500);
    }

    /**
     * Check if there's an existing active conversation and project it
     * Called when component is created and API is ready
     * Uses retries because iframe state is restored asynchronously
     */
    _checkAndProjectExistingConversation(attempt = 0) {
        const maxAttempts = 5;
        const embeddedMessaging = document.getElementById('embedded-messaging');

        if (!embeddedMessaging) {
            console.log('[AgentforceChat] No embedded-messaging element for existing conversation check');
            return;
        }

        // Try multiple selectors - iframe name may vary
        let iframe = embeddedMessaging.querySelector('iframe[name="embeddedMessagingFrame"]');
        if (!iframe) {
            iframe = embeddedMessaging.querySelector('iframe');
        }
        const isMaximized = iframe?.classList.contains('isMaximized');

        console.log(`[AgentforceChat] Checking for existing conversation (attempt ${attempt + 1}):`, {
            hasIframe: !!iframe,
            isMaximized
        });

        if (iframe && isMaximized) {
            console.log('[AgentforceChat] Found existing maximized conversation, projecting');

            // Hide the inline container's welcome screen
            const container = window.__agentforceChatInlineContainer;
            if (container?.hideWelcome) {
                container.hideWelcome();
            }

            // Project the chat
            this._projectChatToContainer();
        } else if (attempt < maxAttempts) {
            // Retry - iframe state may be restored asynchronously
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                this._checkAndProjectExistingConversation(attempt + 1);
            }, 300);
        }
    }

    /**
     * Set up listener for conversation start to send pending message
     */
    _setupConversationStartListener() {
        if (this._conversationStartHandler) {
            return; // Already set up
        }

        this._conversationStartHandler = () => {
            console.log('[AgentforceChat] Conversation started, watching for agent greeting...');
            // Watch for agent's greeting message to appear before sending user's message
            this._watchForAgentGreeting();
        };

        // Listen for various conversation start events
        window.addEventListener('onEmbeddedMessagingConversationStarted', this._conversationStartHandler);

        // Also try after a delay when chat is launched (fallback)
        console.log('[AgentforceChat] Conversation start listener set up');
    }

    /**
     * Watch for agent's greeting message using Embedded Service events (Bug 1 fix)
     * Uses onEmbeddedMessageSent event instead of unreliable DOM observation
     * On timeout, retries launchChat() while keeping listener active to avoid race conditions
     * Updates loading animation progress as retries happen
     */
    _watchForAgentGreeting(retryCount = 0) {
        const maxRetries = 15;
        const timeoutMs = 4000;
        const totalTimeMs = maxRetries * timeoutMs; // 60 seconds total

        if (!this._pendingMessage || this._messageSent) {
            return;
        }

        // Prevent duplicate watchers - if one is already active, skip
        if (this._greetingWatcherActive) {
            console.log('[AgentforceChat] Greeting watcher already active, skipping duplicate');
            return;
        }

        this._greetingWatcherActive = true;
        console.log('[AgentforceChat] Setting up agent greeting watcher (will retry up to', maxRetries, 'times)');

        // Track state
        let greetingDetected = false;
        let currentRetry = 0;
        const startTime = Date.now();

        // Get container reference for loading updates
        const container = window.__agentforceChatInlineContainer;

        // Start progress animation - update every 500ms for smooth fill
        let progressInterval = null;
        if (container?.updateLoadingProgress) {
            progressInterval = setInterval(() => {
                if (greetingDetected || this._messageSent) {
                    clearInterval(progressInterval);
                    return;
                }
                const elapsed = Date.now() - startTime;
                const progress = Math.min(95, (elapsed / totalTimeMs) * 100); // Cap at 95% until complete
                container.updateLoadingProgress(progress);
            }, 500);
        }

        // Handler for incoming messages - wait for non-user message (agent/bot greeting)
        const messageHandler = (event) => {
            if (greetingDetected || this._messageSent) {
                return;
            }

            const detail = event?.detail || {};
            const sender = detail.sender || 'unknown';

            console.log('[AgentforceChat] Message event received, sender:', sender);

            // Only trigger on non-user messages (agent, bot, or system greeting)
            if (sender !== 'EndUser') {
                console.log('[AgentforceChat] Agent/bot message detected, completing loading and sending message');
                greetingDetected = true;
                this._greetingWatcherActive = false;

                // Stop progress animation
                if (progressInterval) {
                    clearInterval(progressInterval);
                }

                // Remove the handler
                window.removeEventListener('onEmbeddedMessageSent', messageHandler);

                // Complete the loading animation, then project chat and send message
                if (container?.completeLoading) {
                    container.completeLoading(() => {
                        // Project the chat into the container
                        this._projectChatToContainer();
                        // Send the pending message after a brief delay
                        // eslint-disable-next-line @lwc/lwc/no-async-operation
                        setTimeout(() => this._sendPendingMessage(), 300);
                    });
                } else {
                    // Fallback if completeLoading not available
                    this._projectChatToContainer();
                    // eslint-disable-next-line @lwc/lwc/no-async-operation
                    setTimeout(() => this._sendPendingMessage(), 300);
                }
            }
        };

        // Register the handler ONCE - it stays active through all retries
        window.addEventListener('onEmbeddedMessageSent', messageHandler);

        // Retry function that keeps the same listener active
        const scheduleRetry = () => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                // Check if greeting was detected while we were waiting
                if (greetingDetected || this._messageSent) {
                    return; // Success! Handler already cleaned up
                }

                if (currentRetry < maxRetries) {
                    currentRetry++;
                    console.log('[AgentforceChat] No agent message after', timeoutMs / 1000, 's, retrying launchChat() (retry', currentRetry, 'of', maxRetries, ')');

                    // Retry launchChat - listener stays active
                    const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
                    if (utilAPI?.launchChat) {
                        utilAPI.launchChat()
                            .then(() => console.log('[AgentforceChat] Retry launchChat() succeeded'))
                            .catch((error) => console.warn('[AgentforceChat] Retry launchChat() failed:', error));
                    }

                    // Schedule next check
                    scheduleRetry();
                } else {
                    // Max retries reached - clean up
                    window.removeEventListener('onEmbeddedMessageSent', messageHandler);
                    if (progressInterval) {
                        clearInterval(progressInterval);
                    }
                    this._greetingWatcherActive = false;
                    console.error('[AgentforceChat] Max retries reached (', maxRetries, '). Agent greeting not detected.');

                    // Handle timeout - show toast and attempt re-init
                    this._handleAgentGreetingTimeout();
                }
            }, timeoutMs);
        };

        // Start the retry loop
        scheduleRetry();

        console.log('[AgentforceChat] Started watching for agent greeting via events');
    }

    /**
     * Handle timeout when agent greeting is not received after max retries
     * Shows a warning toast and attempts to re-initialize the chat
     */
    _handleAgentGreetingTimeout() {
        console.log('[AgentforceChat] Handling agent greeting timeout');

        const container = window.__agentforceChatInlineContainer;

        // Hide the loading screen
        if (container?.hideLoading) {
            container.hideLoading();
        }

        // Show warning toast using platform events or custom event
        this._showWarningToast('Connection timeout', 'Unable to connect to the AI agent. Please try again.');

        // Reset state for retry
        this._pendingMessage = null;
        this._messageSent = false;
        this._greetingWatcherActive = false;

        // Reset projection state
        this._projectionComplete = false;
        this._projectionAttempts = 0;
        this._containerElement = null;

        // Show welcome screen again so user can retry
        if (container?.reset) {
            container.reset();
        }

        // Attempt to re-initialize the embedded service
        this._attemptReInit();
    }

    /**
     * Show a warning toast notification
     */
    _showWarningToast(title, message) {
        // Dispatch a custom event that can be caught by a toast handler
        // In Experience Cloud, we use a custom event since ShowToastEvent isn't available
        const toastEvent = new CustomEvent('agentforcetoast', {
            detail: {
                title: title,
                message: message,
                variant: 'warning'
            },
            bubbles: true,
            composed: true
        });
        document.dispatchEvent(toastEvent);

        // Also log to console
        console.warn(`[AgentforceChat] Toast: ${title} - ${message}`);

        // Create a simple DOM-based toast as fallback
        this._createFallbackToast(title, message);
    }

    /**
     * Create a simple DOM-based toast notification as fallback
     * Uses safe DOM methods instead of innerHTML to prevent XSS
     */
    _createFallbackToast(title, message) {
        const toast = document.createElement('div');
        toast.className = 'agentforce-toast agentforce-toast-warning';

        const content = document.createElement('div');
        content.className = 'agentforce-toast-content';

        const titleEl = document.createElement('strong');
        titleEl.textContent = title;

        const messageEl = document.createElement('p');
        messageEl.textContent = message;

        content.appendChild(titleEl);
        content.appendChild(messageEl);
        toast.appendChild(content);

        // Inject toast styles if not already present
        if (!document.getElementById('agentforce-toast-styles')) {
            const styles = document.createElement('style');
            styles.id = 'agentforce-toast-styles';
            styles.textContent = `
                .agentforce-toast {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 10000;
                    padding: 16px 24px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    animation: agentforce-toast-in 0.3s ease-out;
                    font-family: 'Salesforce Sans', Arial, sans-serif;
                }
                .agentforce-toast-warning {
                    background: #fef3cd;
                    border: 1px solid #ffc107;
                    color: #856404;
                }
                .agentforce-toast-content strong {
                    display: block;
                    margin-bottom: 4px;
                }
                .agentforce-toast-content p {
                    margin: 0;
                    font-size: 14px;
                }
                @keyframes agentforce-toast-in {
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes agentforce-toast-out {
                    from { opacity: 1; transform: translateX(-50%) translateY(0); }
                    to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(toast);

        // Auto-remove after 5 seconds
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            toast.style.animation = 'agentforce-toast-out 0.3s ease-out forwards';
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Attempt to re-initialize the embedded service after a failure
     */
    _attemptReInit() {
        console.log('[AgentforceChat] Attempting to re-initialize chat');

        // Clear any existing conversation state
        this._conversationEnded = true;

        // Reset bootstrap state
        this._bootstrapInitialized = false;
        this._apiReady = false;

        // Remove existing iframe if present
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (embeddedMessaging) {
            const iframe = embeddedMessaging.querySelector('iframe');
            if (iframe) {
                iframe.remove();
            }
        }

        // Clear embedded service storage
        this._clearEmbeddedServiceStoragePreInit();

        // Re-initialize after a brief delay
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            this._conversationEnded = false;
            this._initializeChat();
        }, 500);
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

        // Don't project if user has switched to FAB mode via minimize
        if (this._inFabModeOverride) {
            console.log('[AgentforceChat] In FAB mode override, skipping projection');
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

        // Watch for minimize action to end chat and reset to welcome screen
        this._watchForMinimize(embeddedMessaging);

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
     * Watch for minimize action in inline mode to end chat and reset to welcome screen
     * Only triggers on actual minimize button click, not on other DOM changes
     * Only applies when in inline mode - FAB mode uses default minimize behavior
     */
    _watchForMinimize(embeddedMessaging) {
        // Clean up existing observer
        if (this._minimizeObserver) {
            this._minimizeObserver.disconnect();
        }

        // Track the last known state of the iframe
        let wasMaximized = true;

        this._minimizeObserver = new MutationObserver((mutations) => {
            // Only handle minimize in inline mode
            if (!this.hasInlineContainer || this._inFabModeOverride) {
                return;
            }

            for (const mutation of mutations) {
                // Only watch for class changes on the iframe
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    // Check if this is the chat iframe
                    if (target.tagName === 'IFRAME' && target.name === 'embeddedMessagingFrame') {
                        const isMaximized = target.classList.contains('isMaximized');

                        // Only trigger if transitioning FROM maximized TO not maximized
                        if (wasMaximized && !isMaximized) {
                            console.log('[AgentforceChat] Chat minimize detected in inline mode');

                            // Double-check with a short delay to avoid false positives
                            // eslint-disable-next-line @lwc/lwc/no-async-operation
                            setTimeout(() => {
                                // Re-check - if still not maximized, it's a real minimize
                                if (!target.classList.contains('isMaximized')) {
                                    console.log('[AgentforceChat] Confirmed minimize - ending chat and resetting');
                                    this._endChatAndReset();
                                } else {
                                    console.log('[AgentforceChat] False minimize detection, ignoring');
                                }
                            }, 100);
                        }

                        wasMaximized = isMaximized;
                    }
                }
            }
        });

        this._minimizeObserver.observe(embeddedMessaging, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });

        console.log('[AgentforceChat] Started watching for minimize action (inline mode only)');
    }

    /**
     * End the current chat and reset to welcome screen (inline mode only)
     */
    _endChatAndReset() {
        console.log('[AgentforceChat] Ending chat and resetting to welcome screen');

        // Stop watching for minimize
        if (this._minimizeObserver) {
            this._minimizeObserver.disconnect();
            this._minimizeObserver = null;
        }

        // Clean up projection styles (hides the chat UI)
        this._cleanupInlineStyles();

        // Reset the inline container to show welcome screen
        const container = window.__agentforceChatInlineContainer;
        if (container?.reset) {
            container.reset();
        }

        // Reset projection state
        this._projectionComplete = false;
        this._pendingMessage = null;
        this._messageSent = false;

        // Publish session ended event
        this._publishActivityEvent('SESSION_ENDED', {
            source: 'user_minimize',
            reason: 'inline_minimize'
        });

        // Reset session for next chat
        this._sessionId = null;
        this._messageCount = 0;

        console.log('[AgentforceChat] Chat ended and reset complete');
    }

    /**
     * Switch from inline mode to FAB mode
     */
    _switchToFabMode() {
        console.log('[AgentforceChat] Switching to FAB mode');

        // Stop watching for minimize
        if (this._minimizeObserver) {
            this._minimizeObserver.disconnect();
            this._minimizeObserver = null;
        }

        // Hide the inline container
        const container = window.__agentforceChatInlineContainer;
        if (container?.element) {
            container.element.style.display = 'none';
            console.log('[AgentforceChat] Hid inline container');
        }

        // Clean up inline styles and show FAB
        this._cleanupInlineStyles();

        // Clear the inline container reference so hasInlineContainer returns false
        // This prevents re-projection until user navigates back
        this._projectionComplete = false;
        this._inFabModeOverride = true;

        console.log('[AgentforceChat] Now in FAB mode');
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

            /* Hide FAB button in inline mode */
            #embedded-messaging.projected-inline > button {
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
        const { message, isSearchQuery, searchStartsNewChat: eventSearchStartsNewChat } = event.detail || {};
        console.log('[AgentforceChat] Chat start requested:', message, 'isSearchQuery:', isSearchQuery);
        console.log('[AgentforceChat] Current state - conversationEnded:', this._conversationEnded, 'apiReady:', this._apiReady);

        // If API not ready yet, queue this request
        if (!this._apiReady) {
            console.log('[AgentforceChat] API not ready, queuing chat start');
            this._queuedChatStart = event;
            return;
        }

        // Use event detail as source of truth for searchStartsNewChat, fallback to design tokens
        const searchStartsNewChat = eventSearchStartsNewChat !== undefined
            ? eventSearchStartsNewChat
            : (window.__agentforceChatDesignTokens?.searchStartsNewChat !== false);

        // Check if there's an active maximized conversation (reliable indicator vs _sessionId)
        const hasMaximizedChat = this._isConversationMaximized();
        console.log('[AgentforceChat] hasMaximizedChat:', hasMaximizedChat, 'searchStartsNewChat:', searchStartsNewChat);

        // Bug 2 fix: If previous conversation ended, reset state before starting new chat
        if (this._conversationEnded) {
            console.log('[AgentforceChat] Previous conversation ended, resetting for fresh start');
            this._resetForNewConversation();
        }

        // If this is a search query and searchStartsNewChat is false, AND there's an active chat,
        // just send the message to existing conversation
        if (isSearchQuery && !searchStartsNewChat && hasMaximizedChat) {
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

        // Show the loading screen in the container (replaces welcome screen)
        const container = window.__agentforceChatInlineContainer;
        if (container?.showLoading) {
            container.showLoading();
        } else if (container?.hideWelcome) {
            // Fallback if showLoading not available
            container.hideWelcome();
        }

        // DON'T position chat yet - wait until loading completes
        // this._projectChatToContainer();

        // Launch the chat - this will start a new conversation if none exists
        const utilAPI = window.embeddedservice_bootstrap?.utilAPI;
        if (utilAPI?.launchChat) {
            console.log('[AgentforceChat] Launching chat (will start new conversation if needed)');
            utilAPI.launchChat();

            // Start watching for agent greeting immediately
            // Don't wait for onEmbeddedMessagingConversationStarted as it may not fire
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                console.log('[AgentforceChat] Starting greeting watcher after launch');
                this._watchForAgentGreeting();
            }, 500);
        }
    }

    /**
     * Check if there's a maximized (active) conversation
     * More reliable than _sessionId which is generated on API ready
     */
    _isConversationMaximized() {
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (!embeddedMessaging) {
            return false;
        }

        let iframe = embeddedMessaging.querySelector('iframe[name="embeddedMessagingFrame"]');
        if (!iframe) {
            iframe = embeddedMessaging.querySelector('iframe');
        }

        return iframe?.classList.contains('isMaximized') || false;
    }

    /**
     * Reset component state for a new conversation (Bug 2 fix)
     * Called when starting a chat after previous conversation ended
     * Uses clearSession() to properly reset Embedded Service state so launchChat()
     * starts a fresh conversation instead of showing the ended one.
     */
    _resetForNewConversation() {
        console.log('[AgentforceChat] Resetting state for new conversation');

        // Reset internal state
        this._conversationEnded = false;
        this._pendingMessage = null;
        this._messageSent = false;
        this._sessionId = null;
        this._messageCount = 0;
        this._greetingWatcherActive = false;

        // Reset projection state to allow fresh projection
        this._projectionComplete = false;
        this._projectionAttempts = 0;
        this._containerElement = null;

        // Remove inline projection styles so chat can be re-projected
        const embeddedMessaging = document.getElementById('embedded-messaging');
        if (embeddedMessaging) {
            embeddedMessaging.classList.remove('projected-inline', 'show-chat');
        }

        // Clear the Embedded Service session/UI to allow fresh start
        // This is necessary because launchChat() alone won't start a new conversation
        // when the previous one has ended - it just shows the ended UI
        this._clearEmbeddedServiceForNewConversation();

        console.log('[AgentforceChat] State reset complete, ready for new conversation');
    }

    /**
     * Clear Embedded Service state to allow a fresh conversation
     * Tries multiple approaches since different API versions have different methods
     */
    _clearEmbeddedServiceForNewConversation() {
        console.log('[AgentforceChat] Attempting to clear Embedded Service for new conversation');

        // NOTE: On Agentforce, utilAPI.clearSession and utilAPI.clearComponent are NOT implemented
        // and even accessing these properties throws an error. We skip directly to manual cleanup.
        // This is different from standard Enhanced Web Chat which has these methods available.

        // Manual cleanup: Remove the iframe to force recreation
        const embeddedMessaging = document.getElementById('embedded-messaging');
        let iframeRemoved = false;
        if (embeddedMessaging) {
            const iframe = embeddedMessaging.querySelector('iframe[name="embeddedMessagingFrame"]') ||
                          embeddedMessaging.querySelector('iframe');
            if (iframe) {
                console.log('[AgentforceChat] Removing iframe to force fresh conversation');
                iframe.remove();
                iframeRemoved = true;
            }
        }

        // Also clear any localStorage/sessionStorage keys that might hold conversation state
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && (key.includes('embedded') || key.includes('messaging') || key.includes('conversation'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => {
                if (!key.includes('agentforce_')) { // Don't remove our own keys
                    console.log('[AgentforceChat] Removing sessionStorage key:', key);
                    sessionStorage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn('[AgentforceChat] Error clearing storage:', error);
        }

        // CRITICAL: If we removed the iframe, we MUST reset _bootstrapInitialized
        // and re-initialize so bootstrap.init() creates a new iframe.
        // This handles SPA navigation where the component stays alive but needs fresh chat.
        if (iframeRemoved) {
            console.log('[AgentforceChat] Iframe removed, resetting bootstrap state for re-init');
            this._bootstrapInitialized = false;
            this._apiReady = false;

            // Re-initialize after a brief delay to let DOM settle
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                console.log('[AgentforceChat] Re-initializing chat after iframe removal');
                this._initializeChat();
            }, 100);
        }
    }

    /**
     * Clear Embedded Service storage BEFORE bootstrap.init() runs
     * This is called on page load when we detect a previous conversation ended.
     * Unlike _clearEmbeddedServiceForNewConversation(), this does NOT remove the iframe
     * because the iframe doesn't exist yet (we're clearing BEFORE init creates it).
     *
     * This ensures bootstrap.init() starts with a clean slate and doesn't
     * restore the ended conversation state from cache.
     */
    _clearEmbeddedServiceStoragePreInit() {
        console.log('[AgentforceChat] Clearing Embedded Service storage before init');

        // Clear sessionStorage keys used by Embedded Service
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && (key.includes('embedded') || key.includes('messaging') || key.includes('conversation') || key.includes('MIAW'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => {
                if (!key.includes('agentforce_')) { // Don't remove our own keys
                    console.log('[AgentforceChat] Pre-init: Removing sessionStorage key:', key);
                    sessionStorage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn('[AgentforceChat] Error clearing sessionStorage:', error);
        }

        // Clear localStorage keys used by Embedded Service
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('embedded') || key.includes('messaging') || key.includes('conversation') || key.includes('MIAW'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => {
                if (!key.includes('agentforce_')) {
                    console.log('[AgentforceChat] Pre-init: Removing localStorage key:', key);
                    localStorage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn('[AgentforceChat] Error clearing localStorage:', error);
        }

        console.log('[AgentforceChat] Storage cleared, ready for fresh init');
    }

    /**
     * Handle projection request from inline container
     * Called when container detects an active conversation on page load
     */
    _handleProjectChatRequest(event) {
        const { containerId } = event.detail || {};
        console.log('[AgentforceChat] Projection request received from container:', containerId);

        // Reset projection state to allow fresh projection
        this._containerElement = null;
        this._projectionComplete = false;
        this._projectionAttempts = 0;
        this._inFabModeOverride = false;

        // Hide FAB and project the chat
        this._updateFabVisibility(true);
        this._projectChatToContainer();
    }

    // ==================== ACTIVITY TRACKING ====================

    /**
     * Generate a unique session ID for activity tracking
     */
    _generateSessionId() {
        const timestamp = Date.now().toString(36);
        const randomPart = Math.random().toString(36).substring(2, 9);
        return `af-${timestamp}-${randomPart}`;
    }

    /**
     * Register Embedded Service event listeners for activity tracking
     * Called when onEmbeddedMessagingReady fires
     */
    _setupActivityEventListeners() {
        console.log('[AgentforceChat] Setting up activity event listeners');

        // Generate session ID when setting up listeners
        if (!this._sessionId) {
            this._sessionId = this._generateSessionId();
            console.log('[AgentforceChat] Generated session ID:', this._sessionId);
        }

        // Conversation events
        this._registerEmbeddedEvent('onEmbeddedMessagingConversationStarted', () => {
            console.log('[AgentforceChat] Conversation started event received');
            // Reset the ended flag since we have a new active conversation
            this._conversationEnded = false;
            this._publishActivityEvent('SESSION_STARTED', {
                source: 'embedded_service'
            });
        });

        this._registerEmbeddedEvent('onEmbeddedMessagingConversationClosed', () => {
            console.log('[AgentforceChat] Conversation closed event received');
            this._publishActivityEvent('SESSION_ENDED', {
                source: 'embedded_service',
                messageCount: this._messageCount
            });
            // Reset for next session and mark conversation as ended (Bug 2 fix)
            this._sessionId = null;
            this._messageCount = 0;
            this._conversationEnded = true;
            console.log('[AgentforceChat] Marked conversation as ended, will reset on next chat start');
        });

        // Message events - onEmbeddedMessageSent fires for all messages (user, bot, rep)
        this._registerEmbeddedEvent('onEmbeddedMessageSent', (event) => {
            this._messageCount++;
            const detail = event?.detail || {};
            const sender = detail.sender || 'unknown';

            // Determine event type based on sender
            const eventType = sender === 'EndUser' ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED';

            this._publishActivityEvent(eventType, {
                sender: sender,
                messageCount: this._messageCount
            });
        });

        // Link click events
        this._registerEmbeddedEvent('onEmbeddedMessageLinkClicked', (event) => {
            const detail = event?.detail || {};
            this._publishActivityEvent('LINK_CLICK', {
                url: detail.url,
                linkText: detail.linkText
            });
        });

        // UI events - window state changes
        this._registerEmbeddedEvent('onEmbeddedMessagingWindowMinimized', () => {
            this._publishActivityEvent('WINDOW_MINIMIZED', {});
        });

        this._registerEmbeddedEvent('onEmbeddedMessagingWindowMaximized', () => {
            this._publishActivityEvent('WINDOW_MAXIMIZED', {});
        });

        this._registerEmbeddedEvent('onEmbeddedMessagingWindowClosed', () => {
            this._publishActivityEvent('WINDOW_CLOSED', {});
        });

        // FAB button click
        this._registerEmbeddedEvent('onEmbeddedMessagingButtonClicked', () => {
            this._publishActivityEvent('FAB_CLICKED', {});
        });

        console.log('[AgentforceChat] Activity event listeners registered');
    }

    /**
     * Register an Embedded Service event handler (with cleanup tracking)
     */
    _registerEmbeddedEvent(eventName, handler) {
        // Wrap handler to catch errors
        const wrappedHandler = (event) => {
            try {
                handler(event);
            } catch (error) {
                console.error(`[AgentforceChat] Error in ${eventName} handler:`, error);
            }
        };

        // Store for cleanup
        this._embeddedEventHandlers[eventName] = wrappedHandler;

        // Register with window
        window.addEventListener(eventName, wrappedHandler);
        console.log(`[AgentforceChat] Registered ${eventName} listener`);
    }

    /**
     * Publish an activity event via LMS
     */
    _publishActivityEvent(eventType, data = {}) {
        // Generate session ID if not present
        if (!this._sessionId) {
            this._sessionId = this._generateSessionId();
        }

        const message = {
            sessionId: this._sessionId,
            eventType: eventType,
            timestamp: Date.now(),
            data: JSON.stringify(data)
        };

        console.log('[AgentforceChat] Publishing activity event:', eventType, message);

        try {
            publish(this.messageContext, AGENTFORCE_SESSION_CHANNEL, message);
        } catch (error) {
            console.error('[AgentforceChat] Error publishing activity event:', error);
        }
    }

    /**
     * Clean up activity event listeners
     */
    _cleanupActivityEventListeners() {
        Object.entries(this._embeddedEventHandlers).forEach(([eventName, handler]) => {
            window.removeEventListener(eventName, handler);
            console.log(`[AgentforceChat] Removed ${eventName} listener`);
        });
        this._embeddedEventHandlers = {};
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
