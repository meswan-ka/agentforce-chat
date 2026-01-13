# Agentforce Chat Components

## Overview

Two-component architecture for inline Agentforce chat that works around the SSE connection bug in Salesforce's Embedded Service inline mode.

## Components

### agentforceChat (Core)
- Initializes Embedded Service Deployment (Enhanced Web V2)
- Uses floating mode (avoids SSE bug that clears inline mode UI)
- Detects inline container and positions chat over it via CSS
- Handles pending message sending to agent

### agentforceChatInlineContainer
- Target container for inline chat display
- Shows customizable welcome screen with input
- Dispatches `chatstart` event when user sends message
- Registers itself globally via `window.__agentforceChatInlineContainer`

## Architecture

```
[User types in welcome screen]
    → chatstart event
    → Core component positions chat over container
    → launchChat() called
    → Pending message sent via sendTextMessage()
```

## Key Implementation Details

1. **CSS Positioning (not DOM movement)**: Chat UI stays in body, positioned over container via CSS custom properties to avoid fighting with Embedded Service
2. **FAB Hidden**: When inline container exists, FAB is hidden via CSS
3. **Pending Message**: Stored and sent after conversation starts or via 2-second fallback

## Configuration (CPE)

Core component requires:
- `orgId` - Salesforce Org ID
- `deploymentDeveloperName` - Embedded Service Deployment name
- `siteUrl` - Experience Site URL
- `scrtUrl` - SCRT2 URL

## Usage

1. Place `Agentforce Chat Inline Container` where you want chat to appear
2. Place `Agentforce Chat` anywhere on page (configure via CPE)
3. If no container, chat appears as floating FAB
