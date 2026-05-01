# Runtime Atoms Guide

Runtime atoms are optional capabilities that modify mode behavior. Think of them as switches you can toggle to give a mode specific superpowers.

## All-Mode Atoms (work with every pattern)

### Recovery Policy
- **What:** Handles tool and provider failures gracefully — retries, alternate tools, skip, or degraded artifacts
- **Default:** On
- **When to disable:** Rarely — this is almost always useful

### Tool Error Boundary
- **What:** Converts tool failures into structured events instead of aborting immediately
- **Default:** On
- **When to disable:** When you want strict fail-fast behavior

### Loop Guard
- **What:** Detects repetitive tool or action loops and forces the run to wrap up
- **Default:** On
- **When to disable:** When the mode is intentionally iterative (e.g., search-and-refine)

### Clarification Interrupt
- **What:** Pauses execution to ask the user when information is missing
- **Default:** On
- **When to disable:** For fully autonomous modes that shouldn't stop for user input

### Memory Capture
- **What:** Saves run summaries into session or project memory after meaningful progress
- **Default:** On
- **When to disable:** For stateless or one-shot modes

### Long-term Memory
- **What:** Updates a durable user memory profile and injects relevant facts into future runs
- **Default:** On
- **When to disable:** For privacy-sensitive modes or stateless operations

### Token Usage Trace
- **What:** Tracks token usage and budget across runtime events
- **Default:** Off
- **When to enable:** When you need cost tracking or budget alerts

## Orchestrator-Subagent Atoms

### Thread Workspace
- **What:** Creates a per-run isolated workspace with thread-scoped paths
- **Default:** On
- **When to disable:** When the mode doesn't need file isolation

### Deferred Tool Discovery
- **What:** Exposes lightweight tool metadata first, full schemas on demand
- **Default:** Off
- **Requires:** `mcp.call` tool
- **When to enable:** For modes with many MCP tools to reduce initial context

### Subagent Delegate
- **What:** Runs a stage as a delegated task with explicit lifecycle and handoff records
- **Default:** Off
- **Requires:** `model.handoff` tool
- **When to enable:** For complex delegation with checkpointing and resumability

## Agent Teams Atoms

### Thread Workspace
- Same as above (default: On)

### Subagent Delegate
- Same as above (default: Off)

### Persistent Worker Memory
- **What:** Persists worker-specific memory across runs so roles accumulate context
- **Default:** On
- **When to disable:** For stateless team configurations

## Message Bus Atoms

### Event Routing
- **What:** Tracks routed topics, subscribers, and correlation records as runtime state
- **Default:** On
- **Requires:** `message.publish` tool
- **When to disable:** Only if you don't need event routing tracking

## Shared State Atoms

### Shared Blackboard
- **What:** Maintains a versioned shared board with convergence state
- **Default:** On
- **Requires:** `shared_state.write` tool
- **When to disable:** This is core to the shared state pattern — rarely disabled

## Cross-Pattern Atoms

### Artifact Publish
- **Works with:** Agent Teams, Message Bus, Shared State
- **What:** Promotes stage outputs into explicit runtime artifacts
- **Default:** Off
- **Requires:** `export.report` tool
- **When to enable:** When downstream consumers need structured artifact references

## Quick Recommendation

For most modes, the default atoms are already well-chosen. You typically only need to:

1. **Enable Token Usage Trace** if cost tracking matters
2. **Disable Clarification Interrupt** for autonomous modes
3. **Enable Subagent Delegate** for complex orchestrator patterns
4. **Enable Artifact Publish** for modes that produce structured outputs

Don't overthink atoms — start with defaults and adjust based on the user's specific needs.
