# Agentforce Chat - Todo

## Pending Tasks

- [ ] Add `targetContainerId` property to allow external container targeting
  - Allow component to target an external container element by ID elsewhere on the page
  - Inline chat would render into that container instead of within the component's own wrapper

## Completed Tasks

- [x] Create new SFDX project at agentforce-chat
- [x] Copy agentforceChat component to new project
- [x] Copy agentforceChatCPE component to new project

## Recent Bug Fix (Welcome Screen Transition)

### Problem
After user sends a message from the welcome screen, the embedded service chat window flashes in briefly (oversized) and immediately disappears. The SSE connection ends right away.

### Solution Applied
Pre-render the chat container in the DOM at all times, with the welcome screen as an overlay on top.

**Changes made:**
1. **HTML** - Chat container is always rendered (not conditionally). Welcome screen is now an absolute-positioned overlay.
2. **JS** - Added `chatContainerClass` computed property that toggles visibility state.
3. **CSS** - Added `.chat-container-behind` (hidden state) and `.welcome-overlay` (overlay positioning).

### Why It Works
The embedded service iframe was disappearing because the container element was being created dynamically when state changed. Now the container exists in the DOM from the start - it's just hidden behind the welcome overlay. When the user sends a message, we remove the overlay and the embedded service initializes into a container that already exists.
