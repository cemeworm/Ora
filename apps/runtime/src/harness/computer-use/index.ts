export { ComputerBackendManager } from "./backend-manager.js";
export { PersistentMcpSession, type McpSession, type McpSessionOptions } from "./mcp-session.js";
export { PeekabooMcpBackend } from "./peekaboo-backend.js";
export { PageBackend, type PageBackendOptions } from "./page-backend.js";
export { CdpClient, type CdpBrowserTarget, type CdpAXNode, type CdpDomNode } from "./cdp-client.js";
export { computerUseBootstrap } from "./bootstrap.js";
export type {
  ComputerUseBackend,
  ComputerObserveResult,
  ComputerActionResult,
  ComputerPermissionStatus,
  ComputerArtifact,
  ComputerUIElement,
  ComputerBounds,
  ComputerRecoverableError,
  ComputerErrorCode,
  ComputerObserveRequest,
  ComputerClickRequest,
  ComputerTypeRequest,
  ComputerPressRequest,
  ComputerScrollRequest,
  ComputerWindowRequest,
} from "./types.js";

export type {
  ComputerUseBootstrapReport,
  PeekabooBootstrapResult,
  PageBootstrapResult,
  ComputerUseAvailabilitySummary,
} from "./bootstrap.js";
