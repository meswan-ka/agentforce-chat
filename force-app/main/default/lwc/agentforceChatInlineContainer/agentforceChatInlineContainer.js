import { LightningElement, api } from 'lwc';

/**
 * @description Agentforce Chat Inline Container
 * A target container for projecting the Agentforce chat UI.
 *
 * Place this component on any page where you want the chat to appear inline.
 * The main agentforceChat component will detect this container and project
 * the chat UI into it.
 *
 * If no container exists on the page, the chat will appear in floating (FAB) mode.
 */
export default class AgentforceChatInlineContainer extends LightningElement {
    // Use Light DOM so the projected chat content can be styled
    static renderMode = 'light';

    // Configuration
    @api height = 600;
    @api widthPercent = 100;
    @api showWelcomeScreen;

    // Welcome Screen Configuration
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

    // Internal state
    _containerId = null;
    _isWelcomeVisible = true;
    _inputMessage = '';

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

    // ==================== COMPUTED PROPERTIES ====================

    get containerId() {
        return this._containerId;
    }

    get wrapperStyle() {
        let style = `height: ${this.height}px; width: ${this.widthPercent}%;`;
        if (this.widthPercent < 100) {
            style += ' margin: 0 auto;';
        }
        return style;
    }

    get containerStyle() {
        return `--gradient-start: ${this.gradientStartColor}; --gradient-mid: ${this.gradientMidColor}; --gradient-end: ${this.gradientEndColor};`;
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
        return `color: ${this.welcomeTitleColor};`;
    }

    get calloutStyle() {
        return `color: ${this.calloutColor}; font-weight: 700;`;
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

    /**
     * Parses the welcome title and splits it into parts for rendering
     */
    get titleParts() {
        const title = this.welcomeTitle || '';
        const callout = this.calloutWord || '';

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
