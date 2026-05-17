import type { ComputerTargetKind } from "@cemeworm/shared";

// ---------------------------------------------------------------------------
// Unified Result Envelope
// ---------------------------------------------------------------------------

export interface ComputerResultEnvelope {
  backend: string;
  targetKind: ComputerTargetKind;
  artifacts?: ComputerArtifact[];
  backendHandle?: string;
  recoverableError?: ComputerRecoverableError;
}

export interface ComputerArtifact {
  kind: "screenshot" | "ui_map" | "annotation" | "diagnostic";
  path: string;
  mimeType?: string;
  label?: string;
}

export interface ComputerRecoverableError {
  code: ComputerErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export type ComputerErrorCode =
  | "permission_missing"
  | "backend_unavailable"
  | "backend_crashed"
  | "target_not_found"
  | "action_failed"
  | "verification_failed"
  | "timeout"
  | "invalid_parameters"
  | "install_required";

// ---------------------------------------------------------------------------
// Permission Status
// ---------------------------------------------------------------------------

export interface ComputerPermissionStatus extends ComputerResultEnvelope {
  available: boolean;
  permissions: ComputerPermission[];
  installStatus?: ComputerInstallStatus;
  diagnostics?: string[];
}

export interface ComputerPermission {
  name: string;
  granted: boolean;
  required: boolean;
  description: string;
}

export interface ComputerInstallStatus {
  installed: boolean;
  version?: string;
  installHint?: string;
  requiredNodeVersion?: string;
}

// ---------------------------------------------------------------------------
// Observe Result
// ---------------------------------------------------------------------------

export interface ComputerObserveResult extends ComputerResultEnvelope {
  target: string;
  elements: ComputerUIElement[];
  screenshotArtifact?: ComputerArtifact;
  snapshotId: string;
  app?: string;
  windowTitle?: string;
  bounds?: ComputerBounds;
}

export interface ComputerUIElement {
  id: string;
  role: string;
  label?: string;
  value?: string;
  description?: string;
  bounds?: ComputerBounds;
  enabled?: boolean;
  focused?: boolean;
  children?: ComputerUIElement[];
}

export interface ComputerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Action Result
// ---------------------------------------------------------------------------

export interface ComputerActionResult extends ComputerResultEnvelope {
  action: string;
  success: boolean;
  target?: string;
  affectedElement?: ComputerUIElement;
  verificationHint?: string;
}

// ---------------------------------------------------------------------------
// Backend Interface
// ---------------------------------------------------------------------------

export interface ComputerUseBackend {
  readonly id: string;
  readonly label: string;
  readonly supportedTargetKinds: ComputerTargetKind[];

  getStatus(): Promise<ComputerPermissionStatus>;
  observe(request: ComputerObserveRequest): Promise<ComputerObserveResult>;
  click(request: ComputerClickRequest): Promise<ComputerActionResult>;
  type(request: ComputerTypeRequest): Promise<ComputerActionResult>;
  press(request: ComputerPressRequest): Promise<ComputerActionResult>;
  scroll(request: ComputerScrollRequest): Promise<ComputerActionResult>;
  window(request: ComputerWindowRequest): Promise<ComputerActionResult>;
  dispose(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Request Types
// ---------------------------------------------------------------------------

export interface ComputerObserveRequest {
  target: string;
  targetKind: ComputerTargetKind;
  app?: string;
  windowTitle?: string;
  mode?: "full" | "overview" | "detail";
  annotate?: boolean;
  maxElements?: number;
  includeScreenshot?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerClickRequest {
  target: string;
  snapshotId?: string;
  targetKind: ComputerTargetKind;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  waitFor?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerTypeRequest {
  text: string;
  target?: string;
  snapshotId?: string;
  targetKind: ComputerTargetKind;
  clear?: boolean;
  delayMs?: number;
  submit?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerPressRequest {
  keys: string;
  count?: number;
  holdMs?: number;
  targetKind: ComputerTargetKind;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerScrollRequest {
  target?: string;
  snapshotId?: string;
  targetKind: ComputerTargetKind;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
  unit?: "lines" | "pages";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerWindowRequest {
  action: "list" | "focus" | "move" | "resize" | "minimize" | "maximize" | "close";
  app?: string;
  windowTitle?: string;
  targetKind: ComputerTargetKind;
  bounds?: ComputerBounds;
  timeoutMs?: number;
  signal?: AbortSignal;
}
