import { LightningElement, api, track } from 'lwc';

/**
 * Custom Property Editor for Agentforce Chat (Inline) component
 * Follows Experience Cloud CPE contract with @api value object
 */
export default class AgentforceChatCPE extends LightningElement {
    // Experience Cloud CPE Contract - Required @api properties
    @api label;
    @api description;
    @api required;
    @api errors;
    @api schema;

    // Internal tracked state for all configuration properties
    @track _config = {};

    // Timestamp of last dispatch to prevent stale overwrites
    _lastDispatchTime = 0;

    // Default values
    static DEFAULTS = {
        orgId: '',
        deploymentDeveloperName: '',
        siteUrl: '',
        scrtUrl: '',
        displayMode: 'inline',
        height: 600,
        widthPercent: 100,
        showHeader: false,
        enableConditionalDisplay: false,
        conditionalPathPattern: 'global-search',
        conditionalQueryParam: 'term',
        invertCondition: false,
        // Welcome Screen Configuration
        gradientStartColor: '#e8f4fd',
        gradientMidColor: '#f5f9fc',
        gradientEndColor: '#ffffff',
        customizeGradient: false,
        welcomeTitle: 'How can Agentforce help?',
        welcomeTitleColor: '#032d60',
        calloutWord: 'Agentforce',
        calloutColor: '#0176d3',
        calloutBold: true,
        calloutItalic: false,
        calloutFontWeight: '700',
        customizeCalloutWord: false,
        welcomeMessage: 'Ask questions, get personalized answers, and take action with Agentforce.',
        agentPrimaryColor: '#0176d3',
        sendButtonColor: '#0176d3'
    };

    // Experience Cloud CPE Contract - value getter/setter
    @api
    get value() {
        return JSON.stringify(this._config);
    }

    set value(val) {
        // Skip if we dispatched very recently (within 150ms)
        if (Date.now() - this._lastDispatchTime < 150) {
            return;
        }

        let parsed = {};
        if (typeof val === 'string' && val) {
            try {
                parsed = JSON.parse(val);
            } catch (e) {
                parsed = {};
            }
        } else if (val && typeof val === 'object') {
            parsed = val;
        }

        // Filter out empty string values
        const filtered = Object.fromEntries(
            Object.entries(parsed).filter(([, v]) => v !== '')
        );

        // Merge with defaults
        this._config = { ...AgentforceChatCPE.DEFAULTS, ...filtered };
    }

    // UI State - Section expansion
    @track isDeploymentExpanded = true;
    @track isDisplayExpanded = true;
    @track isAppearanceExpanded = false;
    @track isWelcomeExpanded = false;
    @track isConditionalExpanded = false;

    // ==================== OPTIONS ====================

    get displayModeOptions() {
        return [
            { label: 'Inline (in container)', value: 'inline' },
            { label: 'Floating (FAB button)', value: 'floating' }
        ];
    }

    get heightOptions() {
        return [
            { label: '400px - Compact', value: 400 },
            { label: '500px - Standard', value: 500 },
            { label: '600px - Large', value: 600 },
            { label: '700px - Extra Large', value: 700 },
            { label: '800px - Full', value: 800 }
        ];
    }

    get fontWeightOptions() {
        return [
            { label: 'Medium (500)', value: '500' },
            { label: 'Bold (700)', value: '700' }
        ];
    }

    // ==================== SECTION ICONS ====================

    get deploymentIconName() {
        return this.isDeploymentExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get displayIconName() {
        return this.isDisplayExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get appearanceIconName() {
        return this.isAppearanceExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get welcomeIconName() {
        return this.isWelcomeExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get conditionalIconName() {
        return this.isConditionalExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    // ==================== TEMPLATE BINDINGS ====================

    get orgId() { return this._config.orgId; }
    get deploymentDeveloperName() { return this._config.deploymentDeveloperName; }
    get siteUrl() { return this._config.siteUrl; }
    get scrtUrl() { return this._config.scrtUrl; }
    get displayMode() { return this._config.displayMode; }
    get height() { return this._config.height; }
    get widthPercent() { return this._config.widthPercent; }
    get showHeader() { return this._config.showHeader; }
    get enableConditionalDisplay() { return this._config.enableConditionalDisplay; }
    get conditionalPathPattern() { return this._config.conditionalPathPattern; }
    get conditionalQueryParam() { return this._config.conditionalQueryParam; }
    get invertCondition() { return this._config.invertCondition; }

    // Welcome screen bindings
    get gradientStartColor() { return this._config.gradientStartColor; }
    get gradientEndColor() { return this._config.gradientEndColor; }
    get customizeGradient() { return this._config.customizeGradient; }
    get showGradientControls() { return this._config.customizeGradient; }
    get welcomeTitle() { return this._config.welcomeTitle; }
    get welcomeTitleColor() { return this._config.welcomeTitleColor; }
    get calloutWord() { return this._config.calloutWord; }
    get calloutColor() { return this._config.calloutColor; }
    get calloutBold() { return this._config.calloutBold; }
    get calloutItalic() { return this._config.calloutItalic; }
    get calloutFontWeight() { return this._config.calloutFontWeight; }
    get customizeCalloutWord() { return this._config.customizeCalloutWord; }
    get showCalloutWordControls() { return this._config.customizeCalloutWord; }
    get welcomeMessage() { return this._config.welcomeMessage; }
    get agentPrimaryColor() { return this._config.agentPrimaryColor; }
    get sendButtonColor() { return this._config.sendButtonColor; }

    // Stateful button variants for Bold/Italic
    get boldButtonVariant() {
        return this._config.calloutBold ? 'brand' : 'neutral';
    }

    get boldButtonClass() {
        return this._config.calloutBold ? 'style-btn active' : 'style-btn';
    }

    get italicButtonVariant() {
        return this._config.calloutItalic ? 'brand' : 'neutral';
    }

    get italicButtonClass() {
        return this._config.calloutItalic ? 'style-btn active' : 'style-btn';
    }

    // ==================== CORE METHODS ====================

    updateProperty(propertyName, propertyValue) {
        this._config = { ...this._config, [propertyName]: propertyValue };
        this.dispatchValueChange();
    }

    dispatchValueChange() {
        this._lastDispatchTime = Date.now();
        const jsonValue = JSON.stringify(this._config);
        this.dispatchEvent(new CustomEvent('valuechange', {
            detail: { value: jsonValue },
            bubbles: true,
            composed: true
        }));
    }

    // ==================== SECTION TOGGLES ====================

    toggleDeployment() {
        this.isDeploymentExpanded = !this.isDeploymentExpanded;
    }

    toggleDisplay() {
        this.isDisplayExpanded = !this.isDisplayExpanded;
    }

    toggleAppearance() {
        this.isAppearanceExpanded = !this.isAppearanceExpanded;
    }

    toggleWelcome() {
        this.isWelcomeExpanded = !this.isWelcomeExpanded;
    }

    toggleConditional() {
        this.isConditionalExpanded = !this.isConditionalExpanded;
    }

    // ==================== DEPLOYMENT HANDLERS ====================

    handleOrgIdChange(event) {
        this.updateProperty('orgId', event.detail.value);
    }

    handleDeploymentChange(event) {
        this.updateProperty('deploymentDeveloperName', event.detail.value);
    }

    handleSiteUrlChange(event) {
        this.updateProperty('siteUrl', event.detail.value);
    }

    handleScrtUrlChange(event) {
        this.updateProperty('scrtUrl', event.detail.value);
    }

    // ==================== DISPLAY HANDLERS ====================

    handleDisplayModeChange(event) {
        this.updateProperty('displayMode', event.detail.value);
    }

    handleHeightChange(event) {
        this.updateProperty('height', parseInt(event.detail.value, 10) || 600);
    }

    handleWidthChange(event) {
        this.updateProperty('widthPercent', parseInt(event.detail.value, 10) || 100);
    }

    handleShowHeaderChange(event) {
        this.updateProperty('showHeader', event.target.checked);
    }

    // ==================== APPEARANCE HANDLERS ====================

    handleSendButtonColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('sendButtonColor', value);
    }

    handleAgentPrimaryColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('agentPrimaryColor', value);
    }

    handleCustomizeGradientToggle(event) {
        const checked = event.target.checked;
        if (!checked) {
            this._config = {
                ...this._config,
                customizeGradient: false,
                gradientStartColor: '#e8f4fd',
                gradientEndColor: '#ffffff'
            };
        } else {
            this._config = { ...this._config, customizeGradient: true };
        }
        this.dispatchValueChange();
    }

    handleGradientStartColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('gradientStartColor', value);
    }

    handleGradientEndColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('gradientEndColor', value);
    }

    // ==================== WELCOME HANDLERS ====================

    handleWelcomeTitleChange(event) {
        this.updateProperty('welcomeTitle', event.detail.value);
    }

    handleWelcomeTitleColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('welcomeTitleColor', value);
    }

    handleWelcomeMessageChange(event) {
        this.updateProperty('welcomeMessage', event.detail.value);
    }

    handleCustomizeCalloutWordToggle(event) {
        const checked = event.target.checked;
        if (!checked) {
            this._config = {
                ...this._config,
                customizeCalloutWord: false,
                calloutWord: 'Agentforce',
                calloutColor: '#0176d3',
                calloutBold: true,
                calloutItalic: false,
                calloutFontWeight: '700'
            };
        } else {
            this._config = { ...this._config, customizeCalloutWord: true };
        }
        this.dispatchValueChange();
    }

    handleCalloutWordChange(event) {
        this.updateProperty('calloutWord', event.detail.value);
    }

    handleCalloutColorChange(event) {
        const value = event.target.value || event.detail.value;
        this.updateProperty('calloutColor', value);
    }

    handleBoldToggle() {
        this.updateProperty('calloutBold', !this._config.calloutBold);
    }

    handleItalicToggle() {
        this.updateProperty('calloutItalic', !this._config.calloutItalic);
    }

    handleCalloutFontWeightChange(event) {
        this.updateProperty('calloutFontWeight', event.detail.value);
    }

    // ==================== CONDITIONAL DISPLAY HANDLERS ====================

    handleConditionalToggle(event) {
        this.updateProperty('enableConditionalDisplay', event.target.checked);
    }

    handlePathPatternChange(event) {
        this.updateProperty('conditionalPathPattern', event.detail.value);
    }

    handleQueryParamChange(event) {
        this.updateProperty('conditionalQueryParam', event.detail.value);
    }

    handleInvertConditionChange(event) {
        this.updateProperty('invertCondition', event.target.checked);
    }
}
