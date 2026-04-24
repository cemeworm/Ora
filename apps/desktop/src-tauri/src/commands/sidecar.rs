use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const JSON_RPC_VERSION: &str = "2.0";
const RUNTIME_COMMAND_ENV: &str = "ORA_RUNTIME_SIDECAR_COMMAND";
const KEYCHAIN_ACCOUNT: &str = "Ora";
const KEYCHAIN_SERVICE_PREFIX: &str = "ora.provider.";
const BRIDGE_MODE_FACADE: &str = "in-process-facade";
const BRIDGE_MODE_PROCESS: &str = "process-json-rpc";
const RUNTIME_MODE_FACADE: &str = "facade";
const RUNTIME_MODE_PROCESS: &str = "process";
const BUNDLED_RUNTIME_ROOT: &str = "runtime-sidecar";
const BUNDLED_RUNTIME_ENTRYPOINT: &str = "runtime-sidecar.cjs";
const BUNDLED_RUNTIME_STORE_DB: &str = "runtime.db";
const BUNDLED_RUNTIME_CHECKPOINT_DB: &str = "langgraph-checkpoints.db";
const STATUS_REASON_FACADE: &str =
    "Runtime process spawning is disabled; Rust is serving deterministic Ora facade responses.";
const STATUS_REASON_PROCESS: &str =
    "Runtime sidecar process bridge is enabled; Rust is forwarding JSON-RPC over stdio.";
const STATUS_REASON_UNAVAILABLE: &str =
    "Runtime sidecar command is configured but unavailable; Rust is falling back to deterministic Ora facade responses.";
const DEFAULT_PATTERN: &str = "orchestrator_subagent";
const DEV_RUNTIME_COMMAND_DISPLAY: &str =
    "node <workspace-tsx>/cli.mjs apps/runtime/src/sidecar-entry.ts";
const PROD_RUNTIME_COMMAND_DISPLAY: &str =
    "runtime-sidecar/bin/node runtime-sidecar/app/runtime-sidecar.cjs";
const MANAGED_LANGFUSE_BASE_URL: &str = "http://localhost:3000";
const MANAGED_LANGFUSE_PUBLIC_KEY: &str = "lf_pk_ora_local_runtime";
const MANAGED_LANGFUSE_SECRET_KEY: &str = "lf_sk_ora_local_runtime";

#[derive(Default)]
pub struct RuntimeFacade {
    state: Mutex<FacadeState>,
}

#[derive(Default)]
struct FacadeState {
    runs: HashMap<String, Value>,
    run_order: Vec<String>,
    projects: HashMap<String, Value>,
    sessions: HashMap<String, Value>,
    next_project_number: u64,
    next_run_number: u64,
    next_session_number: u64,
}

pub struct RuntimeSidecarManager {
    configured_command: Option<RuntimeCommandSpec>,
    process_spawn_available: Mutex<bool>,
    configured_from_env: bool,
}

impl Default for RuntimeSidecarManager {
    fn default() -> Self {
        Self {
            configured_command: None,
            process_spawn_available: Mutex::new(false),
            configured_from_env: false,
        }
    }
}

impl RuntimeSidecarManager {
    pub fn new(app: AppHandle) -> Self {
        let (configured_command, configured_from_env) = resolve_runtime_command(&app);
        let process_spawn_available = configured_command
            .as_ref()
            .map(|command| command_is_available(command.executable()))
            .unwrap_or(false);
        Self {
            configured_command,
            process_spawn_available: Mutex::new(process_spawn_available),
            configured_from_env,
        }
    }

    #[cfg(test)]
    fn with_process_bridge(
        command: Option<RuntimeCommandSpec>,
        process_spawn_available: bool,
    ) -> Self {
        let configured_from_env = command.is_some();
        Self {
            configured_command: command,
            process_spawn_available: Mutex::new(process_spawn_available),
            configured_from_env,
        }
    }

    fn status(&self) -> SidecarStatus {
        let configured_command = self.configured_command.as_ref();
        let active_process = self
            .process_spawn_available
            .lock()
            .map(|available| *available)
            .unwrap_or(false);
        SidecarStatus {
            configured: true,
            sidecar_configured: self.configured_from_env,
            json_rpc_facade_enabled: false,
            runtime_mode: if active_process {
                RUNTIME_MODE_PROCESS
            } else {
                RUNTIME_MODE_FACADE
            },
            transport: if active_process {
                BRIDGE_MODE_PROCESS
            } else {
                "in-process-json-rpc-facade"
            },
            command: configured_command
                .map(|spec| spec.display.clone())
                .unwrap_or_else(|| PROD_RUNTIME_COMMAND_DISPLAY.to_string()),
            bridge_mode: if active_process {
                RUNTIME_MODE_PROCESS
            } else {
                BRIDGE_MODE_FACADE
            },
            sidecar_spawn_enabled: true,
            sidecar_process_spawn_enabled: active_process,
            process_spawn_available: active_process,
            shell_authority_exposed: false,
            reason: if active_process {
                STATUS_REASON_PROCESS
            } else if self.configured_from_env || self.configured_command.is_some() {
                STATUS_REASON_UNAVAILABLE
            } else {
                STATUS_REASON_FACADE
            },
        }
    }

    fn preview_command(&self) -> Vec<String> {
        self.configured_command
            .as_ref()
            .map(RuntimeCommandSpec::preview_command)
            .unwrap_or_else(|| {
                PROD_RUNTIME_COMMAND_DISPLAY
                    .split_whitespace()
                    .map(str::to_string)
                    .collect()
            })
    }

    fn try_process_json_rpc(
        &self,
        request: &RuntimeJsonRpcRequest,
    ) -> Option<RuntimeJsonRpcResponse> {
        if !self
            .process_spawn_available
            .lock()
            .map(|available| *available)
            .unwrap_or(false)
        {
            return None;
        }

        let command = self.configured_command.clone()?;
        match run_process_json_rpc(&command, request) {
            Ok(response) => Some(response),
            Err(_) => {
                self.disable_process_bridge();
                None
            }
        }
    }

    fn disable_process_bridge(&self) {
        if let Ok(mut process_spawn_available) = self.process_spawn_available.lock() {
            *process_spawn_available = false;
        }
    }
}

#[derive(Clone, Debug)]
struct RuntimeCommandSpec {
    display: String,
    executable: PathBuf,
    args: Vec<String>,
    working_directory: Option<PathBuf>,
    environment: Vec<(String, String)>,
}

impl RuntimeCommandSpec {
    fn new(
        display: impl Into<String>,
        executable: impl Into<PathBuf>,
        args: Vec<String>,
        working_directory: Option<PathBuf>,
        environment: Vec<(String, String)>,
    ) -> Self {
        Self {
            display: display.into(),
            executable: executable.into(),
            args,
            working_directory,
            environment,
        }
    }

    fn executable(&self) -> &Path {
        &self.executable
    }

    fn args(&self) -> &[String] {
        &self.args
    }

    fn preview_command(&self) -> Vec<String> {
        let mut command = vec![self.executable.to_string_lossy().into_owned()];
        command.extend(self.args.clone());
        command
    }
}

#[derive(Serialize)]
pub struct SidecarStatus {
    configured: bool,
    sidecar_configured: bool,
    json_rpc_facade_enabled: bool,
    runtime_mode: &'static str,
    transport: &'static str,
    command: String,
    bridge_mode: &'static str,
    sidecar_spawn_enabled: bool,
    sidecar_process_spawn_enabled: bool,
    process_spawn_available: bool,
    shell_authority_exposed: bool,
    reason: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeJsonRpcRequest {
    #[serde(default)]
    pub jsonrpc: Option<String>,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeJsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RuntimeJsonRpcError>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeJsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderSecretWrite {
    #[serde(rename = "providerId")]
    provider_id: String,
    secret: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderSecretStatus {
    #[serde(rename = "providerId")]
    provider_id: String,
    #[serde(rename = "hasSecret")]
    has_secret: bool,
    storage: &'static str,
    #[serde(rename = "keychainService", skip_serializing_if = "Option::is_none")]
    keychain_service: Option<String>,
    detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedCustomAgentConfig {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(rename = "tool_groups", skip_serializing_if = "Option::is_none")]
    tool_groups: Option<Vec<String>>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Clone)]
struct CustomAgentDetailRecord {
    name: String,
    description: String,
    model: Option<String>,
    tool_groups: Option<Vec<String>>,
    soul: String,
    created_at: u64,
    updated_at: u64,
}

#[tauri::command]
// The webview only receives lifecycle metadata here; shell access stays out of React.
pub fn runtime_sidecar_status(manager: State<'_, RuntimeSidecarManager>) -> SidecarStatus {
    manager.status()
}

#[tauri::command]
pub fn preview_sidecar_command(manager: State<'_, RuntimeSidecarManager>) -> Vec<String> {
    manager.preview_command()
}

#[tauri::command]
pub fn provider_secret_status(provider_ids: Vec<String>) -> Vec<ProviderSecretStatus> {
    provider_ids
        .into_iter()
        .map(|provider_id| provider_secret_status_for(&provider_id))
        .collect()
}

#[tauri::command]
pub fn provider_secret_store(
    payload: ProviderSecretWrite,
) -> Result<ProviderSecretStatus, String> {
    let service = provider_keychain_service(&payload.provider_id)?;
    if payload.secret.trim().is_empty() {
        return Err("Provider secret cannot be empty.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("security")
            .args([
                "add-generic-password",
                "-a",
                KEYCHAIN_ACCOUNT,
                "-s",
                service.as_str(),
                "-w",
                payload.secret.as_str(),
                "-U",
            ])
            .status()
            .map_err(|error| format!("Unable to write provider key to Keychain: {error}"))?;

        if !status.success() {
            return Err("macOS Keychain rejected the provider secret write.".to_string());
        }

        Ok(ProviderSecretStatus {
            provider_id: payload.provider_id,
            has_secret: true,
            storage: "keychain",
            keychain_service: Some(service),
            detail: "Provider key is stored in macOS Keychain.".to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = service;
        Err("Provider Keychain storage is only implemented for macOS in this MVP.".to_string())
    }
}

#[tauri::command]
pub fn provider_secret_delete(provider_id: String) -> Result<ProviderSecretStatus, String> {
    let service = provider_keychain_service(&provider_id)?;

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("security")
            .args([
                "delete-generic-password",
                "-a",
                KEYCHAIN_ACCOUNT,
                "-s",
                service.as_str(),
            ])
            .status()
            .map_err(|error| format!("Unable to delete provider key from Keychain: {error}"))?;

        if !status.success() && keychain_has_secret(&service) {
            return Err("macOS Keychain rejected the provider secret delete.".to_string());
        }
    }

    Ok(ProviderSecretStatus {
        provider_id,
        has_secret: false,
        storage: keychain_storage_kind(),
        keychain_service: Some(service),
        detail: "Provider key is not stored.".to_string(),
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is required.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(trimmed)
            .status()
            .map_err(|error| format!("Unable to open URL: {error}"))?;
        if !status.success() {
            return Err("macOS rejected the external URL open request.".to_string());
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = trimmed;
        Err("External URL opening is only implemented for macOS in this MVP.".to_string())
    }
}

#[tauri::command]
pub fn runtime_json_rpc(
    request: RuntimeJsonRpcRequest,
    manager: State<'_, RuntimeSidecarManager>,
    facade: State<'_, RuntimeFacade>,
) -> RuntimeJsonRpcResponse {
    if let Some(response) = manager.try_process_json_rpc(&request) {
        response
    } else {
        facade.handle_runtime_json_rpc(request)
    }
}

#[tauri::command]
pub fn runtime_start_run(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.start", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_stream_run(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.stream", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_list_runs(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.list", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_fork_run(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.fork", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_resume_run(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.resume", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_cancel_run(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.cancel", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_export_report(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.exportReport", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_run_status(
    params: Option<Value>,
    facade: State<'_, RuntimeFacade>,
) -> Result<Value, String> {
    facade
        .handle_method("runs.state", params)
        .map_err(|error| error.message)
}

impl RuntimeFacade {
    fn handle_runtime_json_rpc(&self, request: RuntimeJsonRpcRequest) -> RuntimeJsonRpcResponse {
        if request
            .jsonrpc
            .as_deref()
            .map_or(false, |version| version != JSON_RPC_VERSION)
        {
            return json_rpc_error(
                request.id,
                -32600,
                "Invalid Request",
                Some(json!({
                    "reason": "Only JSON-RPC 2.0 requests are supported by the runtime facade."
                })),
            );
        }

        match self.handle_method(request.method.as_str(), request.params) {
            Ok(result) => json_rpc_result(request.id, result),
            Err(error) => RuntimeJsonRpcResponse {
                jsonrpc: JSON_RPC_VERSION.to_string(),
                id: request.id,
                result: None,
                error: Some(error),
            },
        }
    }

    fn handle_method(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, RuntimeJsonRpcError> {
        match method {
            "runtime.health" => Ok(runtime_health()),
            "patterns.list" => Ok(patterns_list()),
            "providers.list" => Ok(providers_list()),
            "agents.list" => self.agents_list(),
            "agents.get" => self.agents_get(params.as_ref()),
            "agents.create" => self.agents_create(params.as_ref()),
            "agents.update" => self.agents_update(params.as_ref()),
            "agents.delete" => self.agents_delete(params.as_ref()),
            "agents.checkName" => self.agents_check_name(params.as_ref()),
            "projects.create" => self.projects_create(params.as_ref()),
            "projects.list" => self.projects_list(params.as_ref()),
            "projects.get" => self.projects_get(params.as_ref()),
            "sessions.create" => self.sessions_create(params.as_ref()),
            "sessions.list" => self.sessions_list(params.as_ref()),
            "sessions.get" => self.sessions_get(params.as_ref()),
            "runs.start" => self.runs_start(params.as_ref()),
            "runs.list" => self.runs_list(params.as_ref()),
            "runs.stream" => self.runs_stream(params.as_ref()),
            "runs.interrupt" => self.runs_interrupt(params.as_ref()),
            "runs.resume" => self.runs_resume(params.as_ref()),
            "runs.cancel" => self.runs_cancel(params.as_ref()),
            "runs.state" => self.runs_state(params.as_ref()),
            "runs.trail" => self.runs_trail(params.as_ref()),
            "runs.checkpoints" => self.runs_checkpoints(params.as_ref()),
            "runs.replay" => self.runs_replay(params.as_ref()),
            "runs.fork" => self.runs_fork(params.as_ref()),
            "runs.exportReport" => self.runs_export_report(params.as_ref()),
            _ => Err(runtime_error(
                -32601,
                "Method not found",
                Some(json!({
                "method": method,
                    "bridge_mode": BRIDGE_MODE_FACADE,
                    "reason": "The in-process facade implements Ora MVP runtime methods without exposing shell authority."
                })),
            )),
        }
    }

    fn agents_list(&self) -> Result<Value, RuntimeJsonRpcError> {
        let root = ensure_custom_agents_root()?;
        let mut agents = fs::read_dir(root)
            .map_err(|error| {
                runtime_error(
                    -32060,
                    "Unable to read custom agents directory",
                    Some(json!({ "error": error.to_string() })),
                )
            })?
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if !path.is_dir() {
                    return None;
                }
                read_custom_agent_detail(&path).ok()
            })
            .collect::<Vec<CustomAgentDetailRecord>>();
        agents.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(Value::Array(
            agents
                .into_iter()
                .map(|agent| custom_agent_summary_value(&agent))
                .collect(),
        ))
    }

    fn agents_get(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let name = require_custom_agent_name(params)?;
        let path = custom_agent_dir(&name)?;
        let agent = read_custom_agent_detail(&path)?;
        Ok(custom_agent_detail_value(&agent))
    }

    fn agents_create(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let params = params.ok_or_else(|| runtime_error(-32602, "Missing custom agent payload", None))?;
        let name = require_custom_agent_name(Some(params))?;
        let path = custom_agent_dir(&name)?;
        if path.exists() {
            return Err(runtime_error(
                -32602,
                "Custom agent already exists",
                Some(json!({ "name": name })),
            ));
        }

        let now = now_ms();
        let agent = CustomAgentDetailRecord {
            name: name.clone(),
            description: params
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            model: optional_trimmed_string(params.get("model")),
            tool_groups: optional_string_array(params.get("toolGroups"))?,
            soul: params
                .get("soul")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            created_at: now,
            updated_at: now,
        };
        write_custom_agent(&agent)?;
        Ok(custom_agent_detail_value(&agent))
    }

    fn agents_update(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let params = params.ok_or_else(|| runtime_error(-32602, "Missing custom agent payload", None))?;
        let name = require_custom_agent_name(Some(params))?;
        let path = custom_agent_dir(&name)?;
        let existing = read_custom_agent_detail(&path)?;
        let agent = CustomAgentDetailRecord {
            name: existing.name.clone(),
            description: params
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(existing.description),
            model: merge_optional_string_field(params.get("model"), existing.model),
            tool_groups: merge_optional_string_array_field(params.get("toolGroups"), existing.tool_groups)?,
            soul: params
                .get("soul")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(existing.soul),
            created_at: existing.created_at,
            updated_at: now_ms(),
        };
        write_custom_agent(&agent)?;
        Ok(custom_agent_detail_value(&agent))
    }

    fn agents_delete(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let name = require_custom_agent_name(params)?;
        let path = custom_agent_dir(&name)?;
        if !path.exists() {
            return Err(runtime_error(
                -32004,
                "Custom agent not found",
                Some(json!({ "name": name })),
            ));
        }
        fs::remove_dir_all(&path).map_err(|error| {
            runtime_error(
                -32061,
                "Unable to delete custom agent",
                Some(json!({ "name": name, "error": error.to_string() })),
            )
        })?;
        Ok(json!({ "deleted": true, "name": name }))
    }

    fn agents_check_name(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let params = params.ok_or_else(|| runtime_error(-32602, "Missing custom agent payload", None))?;
        let raw_name = params
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| runtime_error(-32602, "Custom agent name is required", None))?;
        let name = normalize_custom_agent_name(raw_name)?;
        let path = custom_agent_dir(&name)?;
        Ok(json!({
            "available": !path.exists(),
            "name": name,
        }))
    }

    fn sessions_create(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let project_id = params
            .and_then(|value| value.get("projectId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let label = params
            .and_then(|value| value.get("label"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        let created_at = now_ms();
        let mut state = self.lock_state()?;
        if let Some(project_id) = project_id.as_deref() {
            get_project(&state, project_id)?;
        }
        state.next_session_number += 1;
        let session_id = format!("session-{:04}", state.next_session_number);
        let session = json!({
            "sessionId": session_id,
            "title": label.unwrap_or_else(|| "New Chat".to_string()),
            "projectId": project_id,
            "status": "idle",
            "turnCount": 0,
            "createdAt": created_at,
            "updatedAt": created_at
        });
        state.sessions.insert(session_id.clone(), session.clone());
        if let Some(project_id) = session["projectId"].as_str() {
            sync_project_summary(&mut state, project_id);
        }
        Ok(session)
    }

    fn projects_create(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let root_path = params
            .and_then(|value| value.get("rootPath"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| runtime_error(-32602, "Missing rootPath", None))?;
        let normalized_root_path = normalize_project_root_path(root_path);
        let label = params
            .and_then(|value| value.get("label"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_project_label(&normalized_root_path));
        let created_at = now_ms();
        let mut state = self.lock_state()?;
        if let Some(existing) = state
            .projects
            .values()
            .find(|project| project["rootPath"].as_str() == Some(normalized_root_path.as_str()))
            .cloned()
        {
            return Ok(existing);
        }
        state.next_project_number += 1;
        let project_id = format!("project-{:04}", state.next_project_number);
        let project = json!({
            "projectId": project_id,
            "label": label,
            "rootPath": normalized_root_path,
            "sessionCount": 0,
            "createdAt": created_at,
            "updatedAt": created_at,
        });
        state.projects.insert(project_id, project.clone());
        Ok(project)
    }

    fn projects_list(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let limit = params
            .and_then(|value| value.get("limit"))
            .and_then(Value::as_u64)
            .unwrap_or(500) as usize;
        let state = self.lock_state()?;
        let mut projects = state.projects.values().cloned().collect::<Vec<Value>>();
        projects.sort_by(|left, right| {
            let left_updated = left["updatedAt"].as_u64().unwrap_or(0);
            let right_updated = right["updatedAt"].as_u64().unwrap_or(0);
            right_updated
                .cmp(&left_updated)
                .then_with(|| {
                    left["projectId"]
                        .as_str()
                        .unwrap_or_default()
                        .cmp(right["projectId"].as_str().unwrap_or_default())
                })
        });
        projects.truncate(limit);
        Ok(Value::Array(projects))
    }

    fn projects_get(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let project_id = require_project_id(params)?;
        let state = self.lock_state()?;
        let project = get_project(&state, &project_id)?.clone();
        let mut sessions = state
            .sessions
            .values()
            .filter(|session| session["projectId"].as_str() == Some(project_id.as_str()))
            .cloned()
            .collect::<Vec<Value>>();
        sessions.sort_by(|left, right| {
            let left_updated = left["updatedAt"].as_u64().unwrap_or(0);
            let right_updated = right["updatedAt"].as_u64().unwrap_or(0);
            right_updated
                .cmp(&left_updated)
                .then_with(|| {
                    left["sessionId"]
                        .as_str()
                        .unwrap_or_default()
                        .cmp(right["sessionId"].as_str().unwrap_or_default())
                })
        });
        Ok(json!({
            "project": project,
            "sessions": sessions,
        }))
    }

    fn sessions_list(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let project_id = params
            .and_then(|value| value.get("projectId"))
            .and_then(Value::as_str);
        let limit = params
            .and_then(|value| value.get("limit"))
            .and_then(Value::as_u64)
            .unwrap_or(500) as usize;
        let state = self.lock_state()?;
        let mut sessions = state
            .sessions
            .values()
            .filter(|session| {
                project_id.map_or(true, |expected| session["projectId"].as_str() == Some(expected))
            })
            .cloned()
            .collect::<Vec<Value>>();
        sessions.sort_by(|left, right| {
            let left_updated = left["updatedAt"].as_u64().unwrap_or(0);
            let right_updated = right["updatedAt"].as_u64().unwrap_or(0);
            right_updated
                .cmp(&left_updated)
                .then_with(|| {
                    left["sessionId"]
                        .as_str()
                        .unwrap_or_default()
                        .cmp(right["sessionId"].as_str().unwrap_or_default())
                })
        });
        sessions.truncate(limit);
        Ok(Value::Array(sessions))
    }

    fn sessions_get(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let session_id = require_session_id(params)?;
        let state = self.lock_state()?;
        let session = get_session(&state, &session_id)?.clone();
        let turns = runs_for_session(&state, &session_id)
            .into_iter()
            .map(session_turn)
            .collect::<Vec<Value>>();
        let transcript = session_transcript(&state, &session_id);
        let latest_snapshot = runs_for_session(&state, &session_id)
            .last()
            .cloned()
            .cloned();

        Ok(json!({
            "session": session,
            "turns": turns,
            "transcript": transcript,
            "latestSnapshot": latest_snapshot
        }))
    }

    fn runs_start(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let prompt = start_prompt(params)?;
        let pattern = start_pattern(params)?;
        let provider_id = start_provider_id(params);
        let provider_config = start_provider_config(params);
        let model_ref = start_model_ref(params);
        let custom_agent_id = start_custom_agent_id(params)?;
        let started_at = now_ms();
        let mut state = self.lock_state()?;
        let session_id = ensure_session_for_run(&mut state, params, started_at)?;
        let turn_index = next_turn_index(&state, &session_id);
        let project_id = params
            .and_then(|value| value.get("input"))
            .and_then(|input| input.get("projectId"))
            .and_then(Value::as_str)
            .or_else(|| {
                state
                    .sessions
                    .get(&session_id)
                    .and_then(|session| session["projectId"].as_str())
            })
            .map(str::to_string);
        state.next_run_number += 1;
        let run_id = format!("run-{:04}", state.next_run_number);
        let snapshot = create_snapshot(
            &run_id,
            &session_id,
            turn_index,
            project_id.as_deref(),
            pattern,
            &prompt,
            started_at,
            None,
            provider_id.as_deref(),
            provider_config.as_ref(),
            model_ref.as_deref(),
            custom_agent_id.as_deref(),
        );
        state.runs.insert(run_id.clone(), snapshot.clone());
        state.run_order.push(run_id.clone());
        upsert_session_from_snapshot(&mut state, &snapshot);

        Ok(json!({
            "runId": run_id,
            "sessionId": session_id,
            "turnIndex": turn_index,
            "status": snapshot["status"],
            "pattern": pattern,
            "startedAt": snapshot["events"][0]["createdAt"]
        }))
    }

    fn runs_list(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let status_filter = params
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str);
        let limit = params
            .and_then(|value| value.get("limit"))
            .and_then(Value::as_u64)
            .unwrap_or(500) as usize;
        let session_filter = params
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str);
        let state = self.lock_state()?;
        let mut summaries = Vec::new();

        for run_id in state.run_order.iter().rev() {
            if let Some(snapshot) = state.runs.get(run_id) {
                let status = snapshot["status"].as_str().unwrap_or("failed");
                if status_filter.map_or(false, |expected| expected != status) {
                    continue;
                }
                if session_filter.map_or(false, |expected| snapshot["sessionId"].as_str() != Some(expected)) {
                    continue;
                }
                summaries.push(run_summary(snapshot));
                if summaries.len() >= limit {
                    break;
                }
            }
        }

        Ok(Value::Array(summaries))
    }

    fn runs_stream(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let after_seq = params
            .and_then(|value| value.get("afterSeq"))
            .and_then(Value::as_u64);
        let from_seq = after_seq.map_or(0, |seq| seq + 1);
        let state = self.lock_state()?;
        let snapshot = get_run(&state, &run_id)?;
        let events = snapshot["events"]
            .as_array()
            .map(|all_events| {
                all_events
                    .iter()
                    .filter(|event| event["seq"].as_u64().unwrap_or(0) >= from_seq)
                    .cloned()
                    .collect::<Vec<Value>>()
            })
            .unwrap_or_default();

        Ok(json!({
            "runId": run_id,
            "fromSeq": from_seq,
            "events": events,
            "nextSeq": snapshot["events"].as_array().map_or(0, Vec::len)
        }))
    }

    fn runs_interrupt(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let reason = params
            .and_then(|value| value.get("reason"))
            .and_then(Value::as_str)
            .unwrap_or("Interrupted by caller.");
        self.transition_run(
            params,
            "interrupted",
            "run.interrupted",
            json!({ "reason": reason }),
        )
    }

    fn runs_resume(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let reason = params
            .and_then(|value| value.get("reason"))
            .and_then(Value::as_str)
            .unwrap_or("Resumed by caller.");
        let patch = params
            .and_then(|value| value.get("patch"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let mut state = self.lock_state()?;
        let updated = {
            let snapshot = get_run_mut(&mut state, &run_id)?;
            append_event(
                snapshot,
                "run.resumed",
                json!({ "reason": reason, "patch": patch }),
                None,
            );
            set_snapshot_status(snapshot, "running");
            set_topology_status(snapshot, "running");
            set_plan_status(snapshot, "running");
            append_event(
                snapshot,
                "run.done",
                json!({
                    "status": "succeeded",
                    "summary": "Deterministic local smoke run resumed and completed."
                }),
                None,
            );
            set_snapshot_status(snapshot, "succeeded");
            set_topology_status(snapshot, "done");
            set_plan_status(snapshot, "done");
            snapshot.clone()
        };
        upsert_session_from_snapshot(&mut state, &updated);
        Ok(updated)
    }

    fn runs_cancel(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        self.transition_run(
            params,
            "cancelled",
            "run.cancelled",
            json!({ "reason": "Cancelled by caller." }),
        )
    }

    fn runs_state(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let state = self.lock_state()?;
        Ok(get_run(&state, &run_id)?.clone())
    }

    fn runs_trail(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let state = self.lock_state()?;
        let snapshot = get_run(&state, &run_id)?;
        Ok(build_run_trail(snapshot))
    }

    fn runs_checkpoints(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let state = self.lock_state()?;
        Ok(get_run(&state, &run_id)?["checkpoints"].clone())
    }

    fn runs_replay(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        self.create_child_run(params, false)
    }

    fn runs_fork(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        self.create_child_run(params, true)
    }

    fn runs_export_report(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let mut state = self.lock_state()?;
        let (artifact, updated) = {
            let snapshot = get_run_mut(&mut state, &run_id)?;
            let report_index = snapshot["artifacts"].as_array().map_or(0, Vec::len);
            let artifact = json!({
                "id": format!("{}:report-{}", run_id, report_index),
                "runId": run_id,
                "kind": "report",
                "label": if report_index == 0 {
                    "Smoke run report".to_string()
                } else {
                    format!("Smoke run report {}", report_index + 1)
                },
                "mimeType": "application/json",
                "createdAt": now_ms(),
                "payload": {
                    "runId": snapshot["runId"],
                    "status": snapshot["status"],
                    "pattern": snapshot["pattern"],
                    "eventCount": snapshot["events"].as_array().map_or(0, Vec::len),
                    "checkpointCount": snapshot["checkpoints"].as_array().map_or(0, Vec::len),
                    "output": snapshot["output"]
                }
            });

            push_array_item(snapshot, "artifacts", artifact.clone());
            append_event(
                snapshot,
                "artifact.exported",
                json!({ "artifact": artifact.clone() }),
                None,
            );
            (artifact, snapshot.clone())
        };
        upsert_session_from_snapshot(&mut state, &updated);
        Ok(artifact)
    }

    fn create_child_run(
        &self,
        params: Option<&Value>,
        is_fork: bool,
    ) -> Result<Value, RuntimeJsonRpcError> {
        let source_run_id = require_run_id(params)?;
        let checkpoint_id = require_checkpoint_id(params)?;
        let mut state = self.lock_state()?;
        let source = get_run(&state, &source_run_id)?.clone();
        let checkpoint = source["checkpoints"]
            .as_array()
            .and_then(|checkpoints| {
                checkpoints
                    .iter()
                    .find(|checkpoint| checkpoint["id"].as_str() == Some(checkpoint_id.as_str()))
            })
            .cloned()
            .ok_or_else(|| {
                runtime_error(
                    -32004,
                    "Checkpoint not found",
                    Some(json!({ "runId": source_run_id, "checkpointId": checkpoint_id })),
                )
            })?;
        let pattern = params
            .and_then(|value| value.get("config"))
            .and_then(|config| config.get("pattern"))
            .and_then(Value::as_str)
            .or_else(|| source["pattern"].as_str())
            .unwrap_or(DEFAULT_PATTERN)
            .to_string();
        ensure_pattern(&pattern)?;
        let prompt = params
            .and_then(|value| value.get("input"))
            .and_then(|input| input.get("prompt"))
            .and_then(Value::as_str)
            .or_else(|| source["input"]["prompt"].as_str())
            .unwrap_or("Replay Ora run")
            .to_string();
        let provider_id = params
            .and_then(|value| value.get("config"))
            .and_then(|config| config.get("providerId"))
            .and_then(Value::as_str)
            .or_else(|| source["config"]["providerId"].as_str())
            .map(str::to_string);
        let provider_config = params
            .and_then(|value| value.get("config"))
            .and_then(|config| config.get("providerConfig"))
            .cloned()
            .or_else(|| source["config"].get("providerConfig").cloned());
        let model_ref = params
            .and_then(|value| value.get("config"))
            .and_then(|config| config.get("modelRef"))
            .and_then(Value::as_str)
            .or_else(|| source["config"]["modelRef"].as_str())
            .map(str::to_string);
        let custom_agent_id = params
            .and_then(|value| value.get("config"))
            .and_then(|config| config.get("customAgentId"))
            .and_then(Value::as_str)
            .map(normalize_custom_agent_name)
            .transpose()?
            .or_else(|| source["config"]["customAgentId"].as_str().map(str::to_string));
        let started_at = now_ms();
        let session_id = source["sessionId"]
            .as_str()
            .ok_or_else(|| runtime_error(
                -32004,
                "Source run is missing sessionId",
                Some(json!({ "runId": source_run_id })),
            ))?
            .to_string();
        let turn_index = next_turn_index(&state, &session_id);
        state.next_run_number += 1;
        let child_run_id = format!("run-{:04}", state.next_run_number);
        let forked_from = json!({
            "runId": source_run_id,
            "checkpointId": checkpoint_id,
            "eventSeq": checkpoint["eventSeq"],
            "mode": if is_fork { "fork" } else { "replay" }
        });
        let project_id = source["input"]["projectId"]
            .as_str()
            .or_else(|| {
                state
                    .sessions
                    .get(&session_id)
                    .and_then(|session| session["projectId"].as_str())
            })
            .map(str::to_string);
        let snapshot = create_snapshot(
            &child_run_id,
            &session_id,
            turn_index,
            project_id.as_deref(),
            &pattern,
            &prompt,
            started_at,
            Some(forked_from),
            provider_id.as_deref(),
            provider_config.as_ref(),
            model_ref.as_deref(),
            custom_agent_id.as_deref(),
        );
        state.runs.insert(child_run_id.clone(), snapshot.clone());
        state.run_order.push(child_run_id.clone());
        upsert_session_from_snapshot(&mut state, &snapshot);

        Ok(json!({
            "runId": child_run_id,
            "sessionId": session_id,
            "turnIndex": turn_index,
            "status": snapshot["status"],
            "pattern": pattern,
            "startedAt": snapshot["events"][0]["createdAt"]
        }))
    }

    fn transition_run(
        &self,
        params: Option<&Value>,
        status: &'static str,
        event_type: &'static str,
        payload: Value,
    ) -> Result<Value, RuntimeJsonRpcError> {
        let run_id = require_run_id(params)?;
        let mut state = self.lock_state()?;
        let updated = {
            let snapshot = get_run_mut(&mut state, &run_id)?;
            append_event(snapshot, event_type, payload, None);
            set_snapshot_status(snapshot, status);
            snapshot.clone()
        };
        upsert_session_from_snapshot(&mut state, &updated);
        Ok(updated)
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, FacadeState>, RuntimeJsonRpcError> {
        self.state
            .lock()
            .map_err(|_| runtime_error(-32000, "Runtime facade state lock failed", None))
    }
}

fn provider_secret_status_for(provider_id: &str) -> ProviderSecretStatus {
    match provider_keychain_service(provider_id) {
        Ok(service) => {
            let has_secret = keychain_has_secret(&service);
            ProviderSecretStatus {
                provider_id: provider_id.to_string(),
                has_secret,
                storage: keychain_storage_kind(),
                keychain_service: Some(service),
                detail: if has_secret {
                    "Provider key is stored in macOS Keychain.".to_string()
                } else if cfg!(target_os = "macos") {
                    "Provider key is not stored.".to_string()
                } else {
                    "Provider Keychain storage is only implemented for macOS in this MVP."
                        .to_string()
                },
            }
        }
        Err(error) => ProviderSecretStatus {
            provider_id: provider_id.to_string(),
            has_secret: false,
            storage: "unavailable",
            keychain_service: None,
            detail: error,
        },
    }
}

fn provider_keychain_service(provider_id: &str) -> Result<String, String> {
    let clean = provider_id.trim();
    if clean.is_empty() {
        return Err("Provider id is required.".to_string());
    }
    if !clean
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("Provider id contains unsupported characters.".to_string());
    }
    Ok(format!("{KEYCHAIN_SERVICE_PREFIX}{clean}"))
}

fn keychain_storage_kind() -> &'static str {
    if cfg!(target_os = "macos") {
        "keychain"
    } else {
        "unavailable"
    }
}

fn keychain_has_secret(service: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        Command::new("security")
            .args([
                "find-generic-password",
                "-a",
                KEYCHAIN_ACCOUNT,
                "-s",
                service,
            ])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = service;
        false
    }
}

fn json_rpc_result(id: Option<Value>, result: Value) -> RuntimeJsonRpcResponse {
    RuntimeJsonRpcResponse {
        jsonrpc: JSON_RPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn json_rpc_error(
    id: Option<Value>,
    code: i64,
    message: &str,
    data: Option<Value>,
) -> RuntimeJsonRpcResponse {
    RuntimeJsonRpcResponse {
        jsonrpc: JSON_RPC_VERSION.to_string(),
        id,
        result: None,
        error: Some(runtime_error(code, message, data)),
    }
}

fn runtime_error(code: i64, message: &str, data: Option<Value>) -> RuntimeJsonRpcError {
    RuntimeJsonRpcError {
        code,
        message: message.to_string(),
        data,
    }
}

fn runtime_health() -> Value {
    json!({
        "ok": true,
        "service": "ora-runtime-facade",
        "version": "0.1.0",
        "deterministic": true,
        "configured": true,
        "sidecar_configured": false,
        "runtime_mode": RUNTIME_MODE_FACADE,
        "bridge_mode": BRIDGE_MODE_FACADE,
        "transport": "in-process-json-rpc-facade",
        "command": PROD_RUNTIME_COMMAND_DISPLAY,
        "sidecar_spawn_enabled": true,
        "sidecar_process_spawn_enabled": false,
        "process_spawn_available": false,
        "shell_authority_exposed": false,
        "reason": STATUS_REASON_FACADE
    })
}

fn resolve_runtime_command(app: &AppHandle) -> (Option<RuntimeCommandSpec>, bool) {
    if let Ok(command) = env::var(RUNTIME_COMMAND_ENV) {
        let resolved = match command.trim().to_ascii_lowercase().as_str() {
            "dev" | "development" => dev_runtime_command(),
            "prod" | "production" => bundled_runtime_command(app),
            _ => None,
        };
        return (resolved, true);
    }

    #[cfg(debug_assertions)]
    {
        (dev_runtime_command(), false)
    }

    #[cfg(not(debug_assertions))]
    {
        (bundled_runtime_command(app), false)
    }
}

fn command_is_available(executable: &Path) -> bool {
    let candidate = Path::new(executable);
    if candidate.components().count() > 1 {
        return candidate.is_file();
    }

    let Some(paths) = env::var_os("PATH") else {
        return false;
    };

    for directory in env::split_paths(&paths) {
        let resolved = directory.join(executable);
        if resolved.is_file() {
            return true;
        }

        #[cfg(windows)]
        {
            if let Some(pathext) = env::var_os("PATHEXT") {
                for extension in env::split_paths(&pathext) {
                    let extension = extension.to_string_lossy();
                    let resolved_with_extension =
                        directory.join(format!("{}{}", executable, extension));
                    if resolved_with_extension.is_file() {
                        return true;
                    }
                }
            }
        }
    }

    false
}

fn run_process_json_rpc(
    command: &RuntimeCommandSpec,
    request: &RuntimeJsonRpcRequest,
) -> Result<RuntimeJsonRpcResponse, RuntimeJsonRpcError> {
    let mut process = Command::new(command.executable());
    process
        .args(command.args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(working_directory) = command.working_directory.as_ref() {
        process.current_dir(working_directory);
    }
    for (key, value) in &command.environment {
        process.env(key, value);
    }
    let mut child = process.spawn().map_err(|error| {
            runtime_error(
                -32050,
                "Runtime sidecar process spawn failed",
                Some(json!({
                    "command": command.display,
                    "error": error.to_string()
                })),
            )
        })?;

    {
        let request_json = serde_json::to_string(request).map_err(|error| {
            runtime_error(
                -32051,
                "Runtime sidecar request serialization failed",
                Some(json!({ "error": error.to_string() })),
            )
        })?;
        let mut stdin = child.stdin.take().ok_or_else(|| {
            runtime_error(
                -32052,
                "Runtime sidecar stdin unavailable",
                Some(json!({ "command": command.display })),
            )
        })?;
        stdin.write_all(request_json.as_bytes()).map_err(|error| {
            runtime_error(
                -32053,
                "Runtime sidecar write failed",
            Some(json!({
                    "command": command.display,
                    "error": error.to_string()
                })),
            )
        })?;
        stdin.write_all(b"\n").map_err(|error| {
            runtime_error(
                -32053,
                "Runtime sidecar write failed",
            Some(json!({
                    "command": command.display,
                    "error": error.to_string()
                })),
            )
        })?;
        stdin.flush().map_err(|error| {
            runtime_error(
                -32053,
                "Runtime sidecar write failed",
            Some(json!({
                    "command": command.display,
                    "error": error.to_string()
                })),
            )
        })?;
    }

    let stdout = child.stdout.take().ok_or_else(|| {
        runtime_error(
            -32054,
            "Runtime sidecar stdout unavailable",
            Some(json!({ "command": command.display })),
        )
    })?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let bytes_read = reader.read_line(&mut line).map_err(|error| {
        runtime_error(
            -32055,
            "Runtime sidecar read failed",
            Some(json!({
                "command": command.display,
                "error": error.to_string()
            })),
        )
    })?;

    if bytes_read == 0 {
        return Err(runtime_error(
            -32056,
            "Runtime sidecar returned no JSON-RPC response",
            Some(json!({ "command": command.display })),
        ));
    }

    let response = serde_json::from_str(line.trim()).map_err(|error| {
        runtime_error(
            -32057,
            "Runtime sidecar response parse failed",
            Some(json!({
                "command": command.display,
                "error": error.to_string(),
                "response": line.trim()
            })),
        )
    })?;

    // The sidecar process is one-shot; once a valid JSON-RPC response is read,
    // post-response cleanup must not block the desktop command path.
    match child.try_wait() {
        Ok(Some(_status)) => {}
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
        }
        Err(_error) => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    Ok(response)
}

fn dev_runtime_command() -> Option<RuntimeCommandSpec> {
    let repo_root = workspace_root()?;
    let tsx_cli = find_workspace_tsx_cli(&repo_root)?;
    let sidecar_entry = repo_root.join("apps").join("runtime").join("src").join("sidecar-entry.ts");

    if !sidecar_entry.is_file() {
        return None;
    }

    Some(RuntimeCommandSpec::new(
        DEV_RUNTIME_COMMAND_DISPLAY,
        "node",
        vec![
            tsx_cli.to_string_lossy().into_owned(),
            sidecar_entry.to_string_lossy().into_owned(),
        ],
        Some(repo_root),
        managed_langfuse_runtime_env(),
    ))
}

fn managed_langfuse_runtime_env() -> Vec<(String, String)> {
    vec![
        ("ORA_LANGFUSE_ENABLED".to_string(), "true".to_string()),
        (
            "LANGFUSE_BASE_URL".to_string(),
            MANAGED_LANGFUSE_BASE_URL.to_string(),
        ),
        (
            "LANGFUSE_PUBLIC_KEY".to_string(),
            MANAGED_LANGFUSE_PUBLIC_KEY.to_string(),
        ),
        (
            "LANGFUSE_SECRET_KEY".to_string(),
            MANAGED_LANGFUSE_SECRET_KEY.to_string(),
        ),
        (
            "LANGFUSE_TRACING_ENVIRONMENT".to_string(),
            "local".to_string(),
        ),
    ]
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("../../..").canonicalize().ok()
}

fn find_workspace_tsx_cli(repo_root: &Path) -> Option<PathBuf> {
    let pnpm_dir = repo_root.join("node_modules").join(".pnpm");
    let entries = fs::read_dir(pnpm_dir).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_str()?;
        if !name.starts_with("tsx@") {
            continue;
        }

        let cli = path
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("cli.mjs");
        if cli.is_file() {
            return Some(cli);
        }
    }

    None
}

fn bundled_runtime_command(app: &AppHandle) -> Option<RuntimeCommandSpec> {
    let resource_dir = app.path().resource_dir().ok()?;
    let runtime_root = resource_dir.join(BUNDLED_RUNTIME_ROOT);
    let node_path = runtime_root.join("bin").join(bundled_node_binary_name());
    let entrypoint_path = runtime_root.join("app").join(BUNDLED_RUNTIME_ENTRYPOINT);
    let working_directory = runtime_root.join("app");

    if !node_path.is_file() || !entrypoint_path.is_file() || !working_directory.is_dir() {
        return None;
    }

    let app_data_dir = app.path().app_data_dir().ok()?;
    let runtime_data_dir = app_data_dir.join("runtime");
    let runtime_db_path = runtime_data_dir.join(BUNDLED_RUNTIME_STORE_DB);
    let checkpoint_db_path = runtime_data_dir.join(BUNDLED_RUNTIME_CHECKPOINT_DB);
    let mut environment = managed_langfuse_runtime_env();
    environment.extend([
        (
            "ORA_RUNTIME_STORE_DIR".to_string(),
            runtime_db_path.to_string_lossy().into_owned(),
        ),
        (
            "ORA_LANGGRAPH_CHECKPOINT_DB".to_string(),
            checkpoint_db_path.to_string_lossy().into_owned(),
        ),
    ]);

    Some(RuntimeCommandSpec::new(
        format!(
            "{} {}",
            node_path.to_string_lossy(),
            entrypoint_path.to_string_lossy()
        ),
        node_path,
        vec![entrypoint_path.to_string_lossy().into_owned()],
        Some(working_directory),
        environment,
    ))
}

#[cfg(target_os = "windows")]
fn bundled_node_binary_name() -> &'static str {
    "node.exe"
}

#[cfg(not(target_os = "windows"))]
fn bundled_node_binary_name() -> &'static str {
    "node"
}

fn patterns_list() -> Value {
    Value::Array(vec![
        pattern_definition("orchestrator_subagent"),
        pattern_definition("generator_verifier"),
        pattern_definition("agent_teams"),
        pattern_definition("message_bus"),
        pattern_definition("shared_state"),
    ])
}

fn providers_list() -> Value {
    json!({
        "providers": [
            {
                "id": "anthropic-claude",
                "type": "anthropic",
                "label": "Claude",
                "modelId": "claude-sonnet-4-20250514",
                "maxTokens": 8192
            },
            {
                "id": "openai-gpt",
                "type": "openai",
                "label": "GPT",
                "modelId": "gpt-4o",
                "maxTokens": 8192
            },
            {
                "id": "local-smoke",
                "type": "local_smoke",
                "label": "Smoke Model",
                "modelId": "smoke-model",
                "maxTokens": 1024
            }
        ],
        "defaultProviderId": "local-smoke"
    })
}

fn ensure_custom_agents_root() -> Result<PathBuf, RuntimeJsonRpcError> {
    let root = workspace_root()
        .ok_or_else(|| runtime_error(-32060, "Workspace root unavailable for custom agents", None))?
        .join(".ora")
        .join("agents");
    fs::create_dir_all(&root).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to create custom agents directory",
            Some(json!({ "error": error.to_string() })),
        )
    })?;
    Ok(root)
}

fn custom_agent_dir(name: &str) -> Result<PathBuf, RuntimeJsonRpcError> {
    Ok(ensure_custom_agents_root()?.join(name))
}

fn custom_agent_config_path(agent_dir: &Path) -> PathBuf {
    agent_dir.join("config.yaml")
}

fn custom_agent_soul_path(agent_dir: &Path) -> PathBuf {
    agent_dir.join("SOUL.md")
}

fn read_custom_agent_detail(agent_dir: &Path) -> Result<CustomAgentDetailRecord, RuntimeJsonRpcError> {
    let config_path = custom_agent_config_path(agent_dir);
    if !config_path.is_file() {
        return Err(runtime_error(
            -32004,
            "Custom agent config missing",
            Some(json!({ "path": config_path.to_string_lossy() })),
        ));
    }
    let raw = fs::read_to_string(&config_path).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to read custom agent config",
            Some(json!({ "path": config_path.to_string_lossy(), "error": error.to_string() })),
        )
    })?;
    let config: PersistedCustomAgentConfig = serde_json::from_str(raw.trim()).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to parse custom agent config",
            Some(json!({ "path": config_path.to_string_lossy(), "error": error.to_string() })),
        )
    })?;
    let soul_path = custom_agent_soul_path(agent_dir);
    let soul = if soul_path.is_file() {
        fs::read_to_string(&soul_path).map_err(|error| {
            runtime_error(
                -32060,
                "Unable to read custom agent SOUL",
                Some(json!({ "path": soul_path.to_string_lossy(), "error": error.to_string() })),
            )
        })?
    } else {
        String::new()
    };
    Ok(CustomAgentDetailRecord {
        name: config.name,
        description: config.description,
        model: config.model,
        tool_groups: config.tool_groups,
        soul,
        created_at: config.created_at,
        updated_at: config.updated_at,
    })
}

fn write_custom_agent(agent: &CustomAgentDetailRecord) -> Result<(), RuntimeJsonRpcError> {
    let agent_dir = custom_agent_dir(&agent.name)?;
    fs::create_dir_all(&agent_dir).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to create custom agent directory",
            Some(json!({ "path": agent_dir.to_string_lossy(), "error": error.to_string() })),
        )
    })?;
    let config = PersistedCustomAgentConfig {
        name: agent.name.clone(),
        description: agent.description.clone(),
        model: agent.model.clone(),
        tool_groups: agent.tool_groups.clone(),
        created_at: agent.created_at,
        updated_at: agent.updated_at,
    };
    let config_path = custom_agent_config_path(&agent_dir);
    let config_json = serde_json::to_string_pretty(&config).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to serialize custom agent config",
            Some(json!({ "name": agent.name, "error": error.to_string() })),
        )
    })?;
    fs::write(&config_path, format!("{config_json}\n")).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to write custom agent config",
            Some(json!({ "path": config_path.to_string_lossy(), "error": error.to_string() })),
        )
    })?;
    let soul_path = custom_agent_soul_path(&agent_dir);
    fs::write(&soul_path, agent.soul.as_bytes()).map_err(|error| {
        runtime_error(
            -32060,
            "Unable to write custom agent SOUL",
            Some(json!({ "path": soul_path.to_string_lossy(), "error": error.to_string() })),
        )
    })?;
    Ok(())
}

fn custom_agent_summary_value(agent: &CustomAgentDetailRecord) -> Value {
    json!({
        "name": agent.name,
        "description": agent.description,
        "model": agent.model,
        "toolGroups": agent.tool_groups,
        "createdAt": agent.created_at,
        "updatedAt": agent.updated_at,
    })
}

fn custom_agent_detail_value(agent: &CustomAgentDetailRecord) -> Value {
    json!({
        "name": agent.name,
        "description": agent.description,
        "model": agent.model,
        "toolGroups": agent.tool_groups,
        "soul": agent.soul,
        "createdAt": agent.created_at,
        "updatedAt": agent.updated_at,
    })
}

fn optional_trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn optional_string_array(value: Option<&Value>) -> Result<Option<Vec<String>>, RuntimeJsonRpcError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(items) = value.as_array() else {
        return Err(runtime_error(-32602, "Custom agent toolGroups must be an array", None));
    };
    let values = items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| runtime_error(-32602, "Custom agent toolGroups must be strings", None))
        })
        .collect::<Result<Vec<String>, RuntimeJsonRpcError>>()?;
    Ok(if values.is_empty() { None } else { Some(values) })
}

fn merge_optional_string_field(value: Option<&Value>, existing: Option<String>) -> Option<String> {
    match value {
        Some(Value::Null) => None,
        Some(other) => optional_trimmed_string(Some(other)).or(existing),
        None => existing,
    }
}

fn merge_optional_string_array_field(
    value: Option<&Value>,
    existing: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, RuntimeJsonRpcError> {
    match value {
        Some(Value::Null) => Ok(None),
        Some(other) => optional_string_array(Some(other)).map(|next| next.or(existing)),
        None => Ok(existing),
    }
}

fn normalize_custom_agent_name(value: &str) -> Result<String, RuntimeJsonRpcError> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(runtime_error(-32602, "Custom agent name is required", None));
    }
    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err(runtime_error(
            -32602,
            "Custom agent names must contain only letters, digits, and hyphens",
            Some(json!({ "name": value })),
        ));
    }
    Ok(normalized)
}

fn require_custom_agent_name(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    let raw = params
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .ok_or_else(|| runtime_error(-32602, "Custom agent name is required", None))?;
    normalize_custom_agent_name(raw)
}

fn create_snapshot(
    run_id: &str,
    session_id: &str,
    turn_index: u64,
    project_id: Option<&str>,
    pattern: &str,
    prompt: &str,
    started_at: u64,
    forked_from: Option<Value>,
    provider_id: Option<&str>,
    provider_config: Option<&Value>,
    model_ref: Option<&str>,
    custom_agent_id: Option<&str>,
) -> Value {
    let definition = pattern_definition(pattern);
    let custom_agent_label = custom_agent_id.map(|value| format!(" via custom agent {}", value));
    let topology = definition["topology"].clone();
    let plan_template = definition["planTemplate"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut events = Vec::new();

    events.push(create_event(
        run_id,
        0,
        "run.started",
        json!({ "message": "Smoke run started.", "prompt": prompt }),
        pattern,
        started_at,
        None,
    ));

    if let Some(fork_info) = forked_from.clone() {
        events.push(create_event(
            run_id,
            events.len() as u64,
            if fork_info["mode"].as_str() == Some("replay") {
                "run.replayed"
            } else {
                "run.forked"
            },
            fork_info,
            pattern,
            started_at + events.len() as u64,
            None,
        ));
    }

    events.push(create_event(
        run_id,
        events.len() as u64,
        "topology.updated",
        topology.clone(),
        pattern,
        started_at + events.len() as u64,
        None,
    ));
    events.push(create_event(
        run_id,
        events.len() as u64,
        "plan.updated",
        json!({ "items": plan_template.clone() }),
        pattern,
        started_at + events.len() as u64,
        None,
    ));
    events.push(create_event(
        run_id,
        events.len() as u64,
        "message.delta",
        json!({
            "role": "assistant",
            "content": format!(
                "{} accepted a local smoke task{}: {}",
                definition["label"].as_str().unwrap_or("Ora"),
                custom_agent_label.as_deref().unwrap_or(""),
                prompt
            )
        }),
        pattern,
        started_at + events.len() as u64,
        None,
    ));
    events.push(create_event(
        run_id,
        events.len() as u64,
        "token.delta",
        json!({
            "text": "ok",
            "tokenCount": 1,
            "budget": definition["defaultBudget"]
        }),
        pattern,
        started_at + events.len() as u64,
        None,
    ));

    let checkpoint = json!({
        "id": format!("{}:checkpoint-0", run_id),
        "runId": run_id,
        "label": if forked_from.is_some() { "Fork checkpoint" } else { "Smoke checkpoint" },
        "createdAt": started_at + events.len() as u64,
        "eventSeq": events.len(),
        "stateHash": format!(
            "{}:{}:{}",
            pattern,
            definition["planTemplate"].as_array().map_or(0, Vec::len),
            definition["topology"]["nodes"].as_array().map_or(0, Vec::len)
        )
    });

    events.push(create_event(
        run_id,
        events.len() as u64,
        "checkpoint.created",
        json!({
            "checkpoint": checkpoint,
            "summary": "Local checkpoint captured after smoke event stream."
        }),
        pattern,
        started_at + events.len() as u64,
        checkpoint["id"].as_str(),
    ));
    events.push(create_event(
        run_id,
        events.len() as u64,
        "run.done",
        json!({
            "status": "succeeded",
            "summary": "Deterministic local smoke run completed."
        }),
        pattern,
        started_at + events.len() as u64,
        None,
    ));

    let plan = plan_template
        .iter()
        .map(|item| {
            let item_id = item["id"].as_str().unwrap_or("item");
            let dependencies = item["dependencies"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|dependency| json!(format!("{}:{}", run_id, dependency)))
                        .collect::<Vec<Value>>()
                })
                .unwrap_or_default();
            json!({
                "id": format!("{}:{}", run_id, item_id),
                "runId": run_id,
                "ownerAgentId": item["ownerAgentId"],
                "status": "done",
                "title": item["title"],
                "dependencies": dependencies,
                "linkedActionIds": [],
                "checkpointIds": [checkpoint["id"].clone()]
            })
        })
        .collect::<Vec<Value>>();

    let mut config = json!({
        "pattern": pattern,
        "profileIds": definition["profiles"].as_array().map(|profiles| {
            profiles.iter().filter_map(|profile| profile["id"].as_str()).collect::<Vec<&str>>()
        }).unwrap_or_default(),
        "providerId": provider_id.unwrap_or("local-smoke"),
        "modelRef": model_ref.unwrap_or("local/smoke-model"),
        "budget": definition["defaultBudget"],
        "metadata": {
            "source": "tauri-facade",
            "providerId": provider_id.unwrap_or("local-smoke")
        },
        "deterministicSeed": "ora-smoke"
    });
    if let Some(provider_config) = provider_config {
        set_object_value(&mut config, "providerConfig", provider_config.clone());
    }
    if let Some(custom_agent_id) = custom_agent_id {
        set_object_value(&mut config, "customAgentId", json!(custom_agent_id));
        if let Some(metadata) = config.get_mut("metadata") {
            set_object_value(metadata, "customAgentId", json!(custom_agent_id));
        }
    }

    json!({
        "runId": run_id,
        "sessionId": session_id,
        "turnIndex": turn_index,
        "status": "succeeded",
        "pattern": pattern,
        "input": {
            "prompt": prompt,
            "projectId": project_id.map_or(Value::Null, |value| json!(value)),
            "context": forked_from.map_or_else(|| json!({}), |fork_info| json!({ "forkedFrom": fork_info })),
            "createdAt": started_at
        },
        "config": config,
        "topology": {
            "nodes": done_topology_nodes(&definition),
            "edges": definition["topology"]["edges"].clone()
        },
        "profiles": definition["profiles"].clone(),
        "memory": [],
        "plan": plan,
        "actions": [
            {
                "id": format!("{}:action-report", run_id),
                "runId": run_id,
                "agentId": definition["profiles"][0]["id"],
                "type": "report.export",
                "riskLevel": "low",
                "status": "proposed",
                "input": { "format": "application/json" },
                "artifactIds": []
            }
        ],
        "policyDecisions": [],
        "checkpoints": [checkpoint],
        "events": events,
        "artifacts": [],
        "output": {
            "text": format!(
                "Smoke result for {}{}: {}",
                definition["label"].as_str().unwrap_or("Ora"),
                custom_agent_label.as_deref().unwrap_or(""),
                prompt
            )
        },
        "trace": build_trace_metadata(run_id, provider_id, model_ref),
        "updatedAt": started_at + 10
    })
}

fn create_event(
    run_id: &str,
    seq: u64,
    event_type: &str,
    payload: Value,
    pattern: &str,
    created_at: u64,
    checkpoint_id: Option<&str>,
) -> Value {
    let mut event = Map::new();
    event.insert("id".to_string(), json!(format!("{}:evt-{}", run_id, seq)));
    event.insert("runId".to_string(), json!(run_id));
    event.insert("seq".to_string(), json!(seq));
    event.insert("type".to_string(), json!(event_type));
    event.insert("createdAt".to_string(), json!(created_at));
    event.insert("pattern".to_string(), json!(pattern));
    if let Some(id) = checkpoint_id {
        event.insert("checkpointId".to_string(), json!(id));
    }
    event.insert("payload".to_string(), payload);
    Value::Object(event)
}

fn build_trace_metadata(
    run_id: &str,
    provider_id: Option<&str>,
    model_ref: Option<&str>,
) -> Value {
    json!({
        "provider": "langfuse",
        "enabled": true,
        "available": true,
        "traceId": format!("trace-{}", run_id),
        "rootObservationId": format!("{}:trace-root", run_id),
        "traceUrl": format!("http://localhost:3000/project/ora-runtime/traces/trace-{}", run_id),
        "source": "local_synthesized",
        "generationRefs": [{
            "observationId": format!("{}:generation-0", run_id),
            "traceId": format!("trace-{}", run_id),
            "parentObservationId": format!("{}:trace-root", run_id),
            "name": "model.local-smoke",
            "providerId": provider_id.unwrap_or("local-smoke"),
            "providerType": "local_smoke",
            "model": model_ref.unwrap_or("local/smoke-model"),
            "latencySeconds": 1.2,
            "totalCostUsd": 0.0
        }]
    })
}

fn build_run_trail(snapshot: &Value) -> Value {
    let run_id = snapshot["runId"].as_str().unwrap_or("run-unknown");
    let trace = if snapshot.get("trace").is_some() {
        snapshot["trace"].clone()
    } else {
        build_trace_metadata(
            run_id,
            snapshot["config"]["providerId"].as_str(),
            snapshot["config"]["modelRef"].as_str(),
        )
    };
    let trace_id = trace["traceId"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("trace-{}", run_id));
    let root_observation_id = trace["rootObservationId"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}:trace-root", run_id));
    let started_at = snapshot["input"]["createdAt"]
        .as_u64()
        .unwrap_or_else(|| snapshot["updatedAt"].as_u64().unwrap_or(0));
    let updated_at = snapshot["updatedAt"].as_u64().unwrap_or(started_at);

    let mut observations = vec![json!({
        "id": root_observation_id,
        "traceId": trace_id,
        "parentObservationId": Value::Null,
        "type": "agent",
        "name": format!("ora.run.{}", snapshot["pattern"].as_str().unwrap_or(DEFAULT_PATTERN)),
        "input": {
            "prompt": snapshot["input"]["prompt"],
            "config": snapshot["config"]
        },
        "output": snapshot["output"],
        "metadata": {
            "runId": snapshot["runId"],
            "pattern": snapshot["pattern"],
            "source": "tauri-facade"
        },
        "startTime": started_at.to_string(),
        "endTime": updated_at.to_string(),
        "latencySeconds": ((updated_at.saturating_sub(started_at)) as f64) / 1000.0,
        "totalCostUsd": 0.0
    })];

    if let Some(events) = snapshot["events"].as_array() {
        for event in events {
            let event_type = event["type"].as_str().unwrap_or("runtime.event");
            let created_at = event["createdAt"].as_u64().unwrap_or(updated_at);
            observations.push(json!({
                "id": format!("{}:obs", event["id"].as_str().unwrap_or("event")),
                "traceId": trace["traceId"],
                "parentObservationId": trace["rootObservationId"],
                "type": if event_type == "message.delta" {
                    "generation"
                } else if event_type == "checkpoint.created" {
                    "event"
                } else {
                    "span"
                },
                "name": event_type,
                "input": event["payload"],
                "metadata": {
                    "eventSeq": event["seq"],
                    "nodeId": event["nodeId"],
                    "agentId": event["agentId"]
                },
                "startTime": created_at.to_string(),
                "endTime": created_at.to_string(),
                "model": if event_type == "message.delta" {
                    snapshot["config"]["modelRef"].clone()
                } else {
                    Value::Null
                },
                "latencySeconds": if event_type == "message.delta" { json!(0.8) } else { Value::Null },
                "totalCostUsd": if event_type == "message.delta" { json!(0.0) } else { Value::Null }
            }));
        }
    }

    let event_count = snapshot["events"].as_array().map_or(0, Vec::len);
    let checkpoint_count = snapshot["checkpoints"].as_array().map_or(0, Vec::len);
    let topology_change_count = snapshot["events"]
        .as_array()
        .map(|events| {
            events
                .iter()
                .filter(|event| event["type"].as_str() == Some("topology.updated"))
                .count()
        })
        .unwrap_or(0);
    let message_count = snapshot["events"]
        .as_array()
        .map(|events| {
            events
                .iter()
                .filter(|event| event["type"].as_str() == Some("message.delta"))
                .count()
        })
        .unwrap_or(0);
    let active_agent_count = snapshot["activeAgents"].as_array().map_or(0, Vec::len);
    let estimated_cost_usd = trace["generationRefs"]
        .as_array()
        .map(|refs| {
            refs.iter()
                .map(|generation| generation["totalCostUsd"].as_f64().unwrap_or(0.0))
                .sum::<f64>()
        })
        .unwrap_or(0.0);

    json!({
        "run": {
            "runId": snapshot["runId"],
            "sessionId": snapshot["sessionId"],
            "turnIndex": snapshot["turnIndex"],
            "status": snapshot["status"],
            "pattern": snapshot["pattern"],
            "prompt": snapshot["input"]["prompt"],
            "startedAt": started_at,
            "updatedAt": updated_at,
            "eventCount": event_count,
            "checkpointCount": checkpoint_count,
            "artifactCount": snapshot["artifacts"].as_array().map_or(0, Vec::len)
        },
        "trace": trace,
        "observations": observations,
        "liveMetrics": {
            "runtimeMs": updated_at.saturating_sub(started_at),
            "eventCount": event_count,
            "checkpointCount": checkpoint_count,
            "topologyChangeCount": topology_change_count,
            "messageCount": message_count,
            "activeAgentCount": active_agent_count,
            "warningCount": 0,
            "errorCount": 0,
            "estimatedCostUsd": estimated_cost_usd
        }
    })
}

fn append_event(
    snapshot: &mut Value,
    event_type: &str,
    payload: Value,
    checkpoint_id: Option<&str>,
) {
    let seq = snapshot["events"].as_array().map_or(0, Vec::len) as u64;
    let pattern = snapshot["pattern"]
        .as_str()
        .unwrap_or(DEFAULT_PATTERN)
        .to_string();
    let run_id = snapshot["runId"].as_str().unwrap_or("run").to_string();
    let updated_at = now_ms();
    let event = create_event(
        &run_id,
        seq,
        event_type,
        payload,
        &pattern,
        updated_at,
        checkpoint_id,
    );
    push_array_item(snapshot, "events", event);
    set_object_value(snapshot, "updatedAt", json!(updated_at));
}

fn run_summary(snapshot: &Value) -> Value {
    json!({
        "runId": snapshot["runId"],
        "sessionId": snapshot["sessionId"],
        "turnIndex": snapshot["turnIndex"],
        "status": snapshot["status"],
        "pattern": snapshot["pattern"],
        "prompt": snapshot["input"]["prompt"],
        "startedAt": snapshot["events"][0]["createdAt"].clone(),
        "updatedAt": snapshot["updatedAt"],
        "eventCount": snapshot["events"].as_array().map_or(0, Vec::len),
        "checkpointCount": snapshot["checkpoints"].as_array().map_or(0, Vec::len),
        "artifactCount": snapshot["artifacts"].as_array().map_or(0, Vec::len)
    })
}

fn session_turn(snapshot: &Value) -> Value {
    json!({
        "runId": snapshot["runId"],
        "sessionId": snapshot["sessionId"],
        "turnIndex": snapshot["turnIndex"],
        "status": snapshot["status"],
        "pattern": snapshot["pattern"],
        "providerId": snapshot["config"]["providerId"],
        "modelRef": snapshot["config"]["modelRef"],
        "prompt": snapshot["input"]["prompt"],
        "startedAt": snapshot["events"][0]["createdAt"].clone(),
        "updatedAt": snapshot["updatedAt"],
        "eventCount": snapshot["events"].as_array().map_or(0, Vec::len),
        "checkpointCount": snapshot["checkpoints"].as_array().map_or(0, Vec::len),
        "artifactCount": snapshot["artifacts"].as_array().map_or(0, Vec::len)
    })
}

fn get_run<'a>(state: &'a FacadeState, run_id: &str) -> Result<&'a Value, RuntimeJsonRpcError> {
    state
        .runs
        .get(run_id)
        .ok_or_else(|| runtime_error(-32004, "Run not found", Some(json!({ "runId": run_id }))))
}

fn get_session<'a>(state: &'a FacadeState, session_id: &str) -> Result<&'a Value, RuntimeJsonRpcError> {
    state
        .sessions
        .get(session_id)
        .ok_or_else(|| {
            runtime_error(
                -32004,
                "Session not found",
                Some(json!({ "sessionId": session_id })),
            )
        })
}

fn get_run_mut<'a>(
    state: &'a mut FacadeState,
    run_id: &str,
) -> Result<&'a mut Value, RuntimeJsonRpcError> {
    state
        .runs
        .get_mut(run_id)
        .ok_or_else(|| runtime_error(-32004, "Run not found", Some(json!({ "runId": run_id }))))
}

fn runs_for_session<'a>(state: &'a FacadeState, session_id: &str) -> Vec<&'a Value> {
    let mut runs = state
        .runs
        .values()
        .filter(|snapshot| snapshot["sessionId"].as_str() == Some(session_id))
        .collect::<Vec<&Value>>();
    runs.sort_by(|left, right| {
        let left_turn = left["turnIndex"].as_u64().unwrap_or(1);
        let right_turn = right["turnIndex"].as_u64().unwrap_or(1);
        left_turn
            .cmp(&right_turn)
            .then_with(|| left["updatedAt"].as_u64().unwrap_or(0).cmp(&right["updatedAt"].as_u64().unwrap_or(0)))
            .then_with(|| {
                left["runId"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(right["runId"].as_str().unwrap_or_default())
            })
    });
    runs
}

fn next_turn_index(state: &FacadeState, session_id: &str) -> u64 {
    runs_for_session(state, session_id)
        .last()
        .and_then(|snapshot| snapshot["turnIndex"].as_u64())
        .unwrap_or(0)
        + 1
}

fn default_session_title(prompt: &str) -> String {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        "New Chat".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn assistant_text_for_run(snapshot: &Value) -> String {
    if let Some(text) = snapshot["output"]["text"].as_str() {
        if !text.trim().is_empty() {
            return text.trim().to_string();
        }
    }
    if let Some(text) = snapshot["output"].as_str() {
        if !text.trim().is_empty() {
            return text.trim().to_string();
        }
    }
    if let Some(events) = snapshot["events"].as_array() {
        for event in events.iter().rev() {
            if event["type"].as_str() != Some("message.delta") {
                continue;
            }
            if let Some(content) = event["payload"]["content"].as_str() {
                if !content.trim().is_empty() {
                    return content.trim().to_string();
                }
            }
        }
    }
    String::new()
}

fn session_transcript(state: &FacadeState, session_id: &str) -> Vec<Value> {
    let mut transcript = Vec::new();
    for run in runs_for_session(state, session_id) {
        if let Some(prompt) = run["input"]["prompt"].as_str() {
            if !prompt.trim().is_empty() {
                transcript.push(json!({
                    "id": format!("{}:user", run["runId"].as_str().unwrap_or("run")),
                    "sessionId": session_id,
                    "runId": run["runId"],
                    "turnIndex": run["turnIndex"],
                    "role": "user",
                    "content": prompt.trim(),
                    "pattern": run["pattern"],
                    "createdAt": run["input"]["createdAt"]
                }));
            }
        }
        let assistant = assistant_text_for_run(run);
        if !assistant.is_empty() {
            transcript.push(json!({
                "id": format!("{}:assistant", run["runId"].as_str().unwrap_or("run")),
                "sessionId": session_id,
                "runId": run["runId"],
                "turnIndex": run["turnIndex"],
                "role": "assistant",
                "content": assistant,
                "pattern": run["pattern"],
                "createdAt": run["updatedAt"]
            }));
        }
    }
    transcript
}

fn ensure_session_for_run(
    state: &mut FacadeState,
    params: Option<&Value>,
    created_at: u64,
) -> Result<String, RuntimeJsonRpcError> {
    if let Some(session_id) = params
        .and_then(|value| value.get("sessionId"))
        .and_then(Value::as_str)
        .filter(|session_id| !session_id.is_empty())
    {
        get_session(state, session_id)?;
        return Ok(session_id.to_string());
    }

    let project_id = params
        .and_then(|value| value.get("input"))
        .and_then(|input| input.get("projectId"))
        .and_then(Value::as_str);
    if let Some(project_id) = project_id {
        get_project(state, project_id)?;
    }
    state.next_session_number += 1;
    let session_id = format!("session-{:04}", state.next_session_number);
    state.sessions.insert(
        session_id.clone(),
        json!({
            "sessionId": session_id,
            "title": "New Chat",
            "projectId": project_id,
            "status": "idle",
            "turnCount": 0,
            "createdAt": created_at,
            "updatedAt": created_at
        }),
    );
    if let Some(project_id) = project_id {
        sync_project_summary(state, project_id);
    }
    Ok(session_id)
}

fn upsert_session_from_snapshot(state: &mut FacadeState, snapshot: &Value) {
    let Some(session_id) = snapshot["sessionId"].as_str() else {
        return;
    };
    let existing = state.sessions.get(session_id).cloned();
    let project_id = if !snapshot["input"]["projectId"].is_null() {
        snapshot["input"]["projectId"].clone()
    } else {
        existing
            .as_ref()
            .map(|session| session["projectId"].clone())
            .unwrap_or(Value::Null)
    };
    let turn_count = runs_for_session(state, session_id)
        .into_iter()
        .filter(|run| run["runId"] != snapshot["runId"])
        .count() as u64
        + 1;
    let title = if existing
        .as_ref()
        .and_then(|session| session["turnCount"].as_u64())
        .unwrap_or(0)
        > 0
    {
        existing
            .as_ref()
            .and_then(|session| session["title"].as_str())
            .unwrap_or("New Chat")
            .to_string()
    } else {
        default_session_title(snapshot["input"]["prompt"].as_str().unwrap_or("New Chat"))
    };
    state.sessions.insert(
        session_id.to_string(),
        json!({
            "sessionId": session_id,
            "title": title,
            "projectId": project_id,
            "status": snapshot["status"],
            "latestRunId": snapshot["runId"],
            "latestPattern": snapshot["pattern"],
            "latestProviderId": snapshot["config"]["providerId"],
            "latestModelRef": snapshot["config"]["modelRef"],
            "turnCount": turn_count,
            "createdAt": existing.as_ref().map(|session| session["createdAt"].clone()).unwrap_or_else(|| snapshot["input"]["createdAt"].clone()),
            "updatedAt": snapshot["updatedAt"]
        }),
    );
    if let Some(project_id) = project_id.as_str() {
        sync_project_summary(state, project_id);
    }
}

fn require_run_id(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("runId"))
        .and_then(Value::as_str)
        .filter(|run_id| !run_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Missing runId", None))
}

fn require_session_id(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("sessionId"))
        .and_then(Value::as_str)
        .filter(|session_id| !session_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Missing sessionId", None))
}

fn require_project_id(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("projectId"))
        .and_then(Value::as_str)
        .filter(|project_id| !project_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Missing projectId", None))
}

fn get_project<'a>(
    state: &'a FacadeState,
    project_id: &str,
) -> Result<&'a Value, RuntimeJsonRpcError> {
    state.projects.get(project_id).ok_or_else(|| {
        runtime_error(
            -32004,
            "Project not found",
            Some(json!({ "projectId": project_id })),
        )
    })
}

fn sync_project_summary(state: &mut FacadeState, project_id: &str) {
    let Some(existing) = state.projects.get(project_id).cloned() else {
        return;
    };
    let sessions = state
        .sessions
        .values()
        .filter(|session| session["projectId"].as_str() == Some(project_id))
        .cloned()
        .collect::<Vec<Value>>();
    let updated_at = sessions
        .iter()
        .filter_map(|session| session["updatedAt"].as_u64())
        .max()
        .unwrap_or_else(|| existing["createdAt"].as_u64().unwrap_or_else(now_ms));
    state.projects.insert(
        project_id.to_string(),
        json!({
            "projectId": existing["projectId"],
            "label": existing["label"],
            "rootPath": existing["rootPath"],
            "sessionCount": sessions.len(),
            "createdAt": existing["createdAt"],
            "updatedAt": updated_at,
        }),
    );
}

fn normalize_project_root_path(root_path: &str) -> String {
    let trimmed = root_path.trim();
    let path = PathBuf::from(trimmed);
    fs::canonicalize(&path)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .to_string()
}

fn default_project_label(root_path: &str) -> String {
    Path::new(root_path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(root_path)
        .to_string()
}

fn require_checkpoint_id(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("checkpointId"))
        .and_then(Value::as_str)
        .filter(|checkpoint_id| !checkpoint_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Missing checkpointId", None))
}

fn start_prompt(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("input"))
        .and_then(|input| input.get("prompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Start run prompt is required", None))
}

fn start_pattern(params: Option<&Value>) -> Result<&str, RuntimeJsonRpcError> {
    let pattern = params
        .and_then(|value| value.get("config"))
        .and_then(|config| config.get("pattern"))
        .and_then(Value::as_str)
        .or_else(|| {
            params
                .and_then(|value| value.get("pattern"))
                .and_then(Value::as_str)
        })
        .unwrap_or(DEFAULT_PATTERN);
    ensure_pattern(pattern)?;
    Ok(pattern)
}

fn start_provider_id(params: Option<&Value>) -> Option<String> {
    params
        .and_then(|value| value.get("config"))
        .and_then(|config| config.get("providerId"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn start_provider_config(params: Option<&Value>) -> Option<Value> {
    params
        .and_then(|value| value.get("config"))
        .and_then(|config| config.get("providerConfig"))
        .cloned()
}

fn start_model_ref(params: Option<&Value>) -> Option<String> {
    params
        .and_then(|value| value.get("config"))
        .and_then(|config| config.get("modelRef"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn start_custom_agent_id(params: Option<&Value>) -> Result<Option<String>, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("config"))
        .and_then(|config| config.get("customAgentId"))
        .and_then(Value::as_str)
        .map(normalize_custom_agent_name)
        .transpose()
}

fn ensure_pattern(pattern: &str) -> Result<(), RuntimeJsonRpcError> {
    match pattern {
        "generator_verifier" | "orchestrator_subagent" | "agent_teams" | "message_bus" | "shared_state" => Ok(()),
        _ => Err(runtime_error(
            -32602,
            "Unsupported coordination pattern",
            Some(json!({ "pattern": pattern })),
        )),
    }
}

fn set_snapshot_status(snapshot: &mut Value, status: &str) {
    set_object_value(snapshot, "status", json!(status));
}

fn set_topology_status(snapshot: &mut Value, status: &str) {
    if let Some(nodes) = snapshot
        .get_mut("topology")
        .and_then(Value::as_object_mut)
        .and_then(|topology| topology.get_mut("nodes"))
        .and_then(Value::as_array_mut)
    {
        for node in nodes {
            set_object_value(node, "status", json!(status));
        }
    }
}

fn set_plan_status(snapshot: &mut Value, status: &str) {
    if let Some(items) = snapshot.get_mut("plan").and_then(Value::as_array_mut) {
        for item in items {
            set_object_value(item, "status", json!(status));
        }
    }
}

fn push_array_item(object: &mut Value, field: &str, item: Value) {
    if let Some(items) = object.get_mut(field).and_then(Value::as_array_mut) {
        items.push(item);
    }
}

fn set_object_value(object: &mut Value, field: &str, value: Value) {
    if let Some(fields) = object.as_object_mut() {
        fields.insert(field.to_string(), value);
    }
}

fn done_topology_nodes(definition: &Value) -> Vec<Value> {
    definition["topology"]["nodes"]
        .as_array()
        .map(|nodes| {
            nodes
                .iter()
                .map(|node| {
                    let mut updated = node.clone();
                    set_object_value(&mut updated, "status", json!("done"));
                    updated
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default()
}

fn budget(max_tokens: u64, max_tool_calls: u64, max_runtime_ms: u64, max_cost_usd: u64) -> Value {
    json!({
        "maxTokens": max_tokens,
        "maxToolCalls": max_tool_calls,
        "maxRuntimeMs": max_runtime_ms,
        "maxCostUsd": max_cost_usd
    })
}

fn profile(id: &str, label: &str, role: &str, pattern: &str, namespaces: Vec<&str>) -> Value {
    json!({
        "id": id,
        "label": label,
        "role": role,
        "modelRef": "local/smoke-model",
        "toolPolicyId": format!("{}.default_policy", pattern),
        "memoryNamespaces": namespaces,
        "budget": pattern_budget(pattern)
    })
}

fn pattern_budget(pattern: &str) -> Value {
    match pattern {
        "generator_verifier" => budget(12000, 8, 180000, 2),
        "agent_teams" => budget(24000, 24, 600000, 5),
        "message_bus" => budget(18000, 18, 300000, 3),
        "shared_state" => budget(20000, 20, 360000, 4),
        _ => budget(18000, 16, 300000, 3),
    }
}

fn pattern_definition(pattern: &str) -> Value {
    match pattern {
        "generator_verifier" => json!({
            "id": "generator_verifier",
            "label": "Generator-Verifier",
            "summary": "A generator proposes an answer and a verifier checks it against a rubric.",
            "recommendedUse": "Use when quality can be judged by explicit acceptance criteria.",
            "failureMode": "Weak rubrics can create false confidence or unproductive retry loops.",
            "defaultConstraints": [
                "Require a clear rubric before verification.",
                "Keep retries bounded.",
                "Attach verifier evidence."
            ],
            "defaultBudget": pattern_budget("generator_verifier"),
            "profiles": [
                profile("generator", "Generator", "Produce the candidate answer.", "generator_verifier", vec!["session", "project"]),
                profile("verifier", "Verifier", "Evaluate the answer against the rubric.", "generator_verifier", vec!["session", "project", "artifact"])
            ],
            "topology": {
                "nodes": [
                    { "id": "run", "label": "Run", "kind": "run", "status": "idle", "metadata": {} },
                    { "id": "generator", "label": "Generator", "kind": "agent", "agentId": "generator", "status": "idle", "metadata": {} },
                    { "id": "verifier", "label": "Verifier", "kind": "agent", "agentId": "verifier", "status": "blocked", "metadata": {} }
                ],
                "edges": [
                    { "id": "run-generator", "source": "run", "target": "generator", "kind": "control", "label": "draft", "metadata": {} },
                    { "id": "generator-verifier", "source": "generator", "target": "verifier", "kind": "verification", "label": "check", "metadata": {} }
                ]
            },
            "planTemplate": [
                { "id": "draft", "title": "Draft candidate output", "ownerAgentId": "generator", "dependencies": [] },
                { "id": "verify", "title": "Verify against rubric", "ownerAgentId": "verifier", "dependencies": ["draft"] }
            ]
        }),
        "agent_teams" => json!({
            "id": "agent_teams",
            "label": "Agent Teams",
            "summary": "Persistent teammate agents coordinate around a shared backlog and memory.",
            "recommendedUse": "Use when long-running workers need identity and context across tasks.",
            "failureMode": "Unclear ownership can create duplicate work or stale worker memory.",
            "defaultConstraints": [
                "Assign every plan item to an owner.",
                "Keep worker memory explicit.",
                "Summarize handoffs."
            ],
            "defaultBudget": pattern_budget("agent_teams"),
            "profiles": [
                profile("team_lead", "Team Lead", "Prioritize backlog and coordinate workers.", "agent_teams", vec!["session", "project"]),
                profile("builder", "Builder", "Implement assigned work.", "agent_teams", vec!["session", "project", "worker"]),
                profile("checker", "Checker", "Validate completed work.", "agent_teams", vec!["session", "project", "worker", "artifact"])
            ],
            "topology": {
                "nodes": [
                    { "id": "team_lead", "label": "Team Lead", "kind": "agent", "agentId": "team_lead", "status": "idle", "metadata": {} },
                    { "id": "builder", "label": "Builder", "kind": "agent", "agentId": "builder", "status": "idle", "metadata": {} },
                    { "id": "checker", "label": "Checker", "kind": "agent", "agentId": "checker", "status": "idle", "metadata": {} },
                    { "id": "memory", "label": "Shared Memory", "kind": "capability", "status": "blocked", "metadata": {} }
                ],
                "edges": [
                    { "id": "lead-builder", "source": "team_lead", "target": "builder", "kind": "delegation", "label": "assign", "metadata": {} },
                    { "id": "builder-checker", "source": "builder", "target": "checker", "kind": "verification", "label": "validate", "metadata": {} },
                    { "id": "checker-lead", "source": "checker", "target": "team_lead", "kind": "control", "label": "report", "metadata": {} },
                    { "id": "lead-memory", "source": "team_lead", "target": "memory", "kind": "memory", "label": "scope", "metadata": {} }
                ]
            },
            "planTemplate": [
                { "id": "triage", "title": "Triage work into team backlog", "ownerAgentId": "team_lead", "dependencies": [] },
                { "id": "build", "title": "Complete assigned task", "ownerAgentId": "builder", "dependencies": ["triage"] },
                { "id": "check", "title": "Validate output", "ownerAgentId": "checker", "dependencies": ["build"] },
                { "id": "handoff", "title": "Record handoff and next action", "ownerAgentId": "team_lead", "dependencies": ["check"] }
            ]
        }),
        "message_bus" => json!({
            "id": "message_bus",
            "label": "Message Bus",
            "summary": "Agents coordinate through explicit publish, route, and respond stages.",
            "recommendedUse": "Use when you want inspectable message routing instead of direct delegation.",
            "failureMode": "Loose topic contracts can create dropped or duplicated work.",
            "defaultConstraints": [
                "Keep topics explicit.",
                "Route messages deterministically.",
                "Record correlation context."
            ],
            "defaultBudget": pattern_budget("message_bus"),
            "profiles": [
                profile("router", "Router", "Publish and route work across topics.", "message_bus", vec!["session", "project"]),
                profile("responder", "Responder", "Consume routed work and emit the final response.", "message_bus", vec!["session", "project", "artifact"])
            ],
            "topology": {
                "nodes": [
                    { "id": "run", "label": "Run", "kind": "run", "status": "idle", "metadata": {} },
                    { "id": "router", "label": "Router", "kind": "agent", "agentId": "router", "status": "idle", "metadata": {} },
                    { "id": "bus", "label": "Bus", "kind": "capability", "status": "blocked", "metadata": {} },
                    { "id": "responder", "label": "Responder", "kind": "agent", "agentId": "responder", "status": "idle", "metadata": {} }
                ],
                "edges": [
                    { "id": "run-router", "source": "run", "target": "router", "kind": "control", "label": "publish", "metadata": {} },
                    { "id": "router-bus", "source": "router", "target": "bus", "kind": "message", "label": "route", "metadata": {} },
                    { "id": "bus-responder", "source": "bus", "target": "responder", "kind": "message", "label": "deliver", "metadata": {} }
                ]
            },
            "planTemplate": [
                { "id": "publish", "title": "Publish task input onto the bus", "ownerAgentId": "router", "dependencies": [] },
                { "id": "route", "title": "Route work to the response topic", "ownerAgentId": "router", "dependencies": ["publish"] },
                { "id": "respond", "title": "Respond from the terminal topic", "ownerAgentId": "responder", "dependencies": ["route"] }
            ]
        }),
        "shared_state" => json!({
            "id": "shared_state",
            "label": "Shared State",
            "summary": "Agents converge by iteratively updating a shared board.",
            "recommendedUse": "Use when multiple agents should co-edit a visible shared artifact.",
            "failureMode": "Weak convergence rules can cause board churn or stale state.",
            "defaultConstraints": [
                "Keep the shared board visible.",
                "Use explicit convergence criteria.",
                "Record final state."
            ],
            "defaultBudget": pattern_budget("shared_state"),
            "profiles": [
                profile("planner", "Planner", "Seed and refine the shared board.", "shared_state", vec!["project", "session"]),
                profile("critic", "Critic", "Check convergence and remaining gaps.", "shared_state", vec!["project", "artifact"])
            ],
            "topology": {
                "nodes": [
                    { "id": "run", "label": "Run", "kind": "run", "status": "idle", "metadata": {} },
                    { "id": "planner", "label": "Planner", "kind": "agent", "agentId": "planner", "status": "idle", "metadata": {} },
                    { "id": "board", "label": "Shared Board", "kind": "capability", "status": "blocked", "metadata": {} },
                    { "id": "critic", "label": "Critic", "kind": "agent", "agentId": "critic", "status": "idle", "metadata": {} }
                ],
                "edges": [
                    { "id": "run-planner", "source": "run", "target": "planner", "kind": "control", "label": "seed", "metadata": {} },
                    { "id": "planner-board", "source": "planner", "target": "board", "kind": "memory", "label": "update", "metadata": {} },
                    { "id": "board-critic", "source": "board", "target": "critic", "kind": "control", "label": "review", "metadata": {} }
                ]
            },
            "planTemplate": [
                { "id": "seed", "title": "Seed the shared board", "ownerAgentId": "planner", "dependencies": [] },
                { "id": "refine", "title": "Refine the board with supporting detail", "ownerAgentId": "planner", "dependencies": ["seed"] },
                { "id": "converge", "title": "Check convergence and finalize", "ownerAgentId": "critic", "dependencies": ["refine"] }
            ]
        }),
        _ => json!({
            "id": "orchestrator_subagent",
            "label": "Orchestrator-Subagent",
            "summary": "An orchestrator decomposes the task and dispatches explicit subagents.",
            "recommendedUse": "Use as the default for decomposable tasks needing inspectable delegation.",
            "failureMode": "Over-decomposition can spend budget on coordination instead of progress.",
            "defaultConstraints": [
                "Keep subagents explicit in topology.",
                "Track plan items as Ora-owned records.",
                "Expose subagent state without leaking graph internals."
            ],
            "defaultBudget": pattern_budget("orchestrator_subagent"),
            "profiles": [
                profile("orchestrator", "Orchestrator", "Plan, dispatch, and synthesize results.", "orchestrator_subagent", vec!["session", "project"]),
                profile("researcher", "Research Subagent", "Gather focused context.", "orchestrator_subagent", vec!["session", "project"]),
                profile("reviewer", "Review Subagent", "Check completeness and risks.", "orchestrator_subagent", vec!["session", "artifact"])
            ],
            "topology": {
                "nodes": [
                    { "id": "run", "label": "Run", "kind": "run", "status": "idle", "metadata": {} },
                    { "id": "orchestrator", "label": "Orchestrator", "kind": "agent", "agentId": "orchestrator", "status": "idle", "metadata": {} },
                    { "id": "researcher", "label": "Research", "kind": "agent", "agentId": "researcher", "status": "idle", "metadata": {} },
                    { "id": "reviewer", "label": "Review", "kind": "agent", "agentId": "reviewer", "status": "idle", "metadata": {} },
                    { "id": "checkpoint", "label": "Checkpoint", "kind": "checkpoint", "status": "blocked", "metadata": {} }
                ],
                "edges": [
                    { "id": "run-orchestrator", "source": "run", "target": "orchestrator", "kind": "control", "label": "task", "metadata": {} },
                    { "id": "orchestrator-researcher", "source": "orchestrator", "target": "researcher", "kind": "delegation", "label": "research", "metadata": {} },
                    { "id": "orchestrator-reviewer", "source": "orchestrator", "target": "reviewer", "kind": "delegation", "label": "review", "metadata": {} },
                    { "id": "reviewer-checkpoint", "source": "reviewer", "target": "checkpoint", "kind": "artifact", "label": "state", "metadata": {} }
                ]
            },
            "planTemplate": [
                { "id": "decompose", "title": "Decompose task into inspectable plan", "ownerAgentId": "orchestrator", "dependencies": [] },
                { "id": "research", "title": "Gather focused supporting context", "ownerAgentId": "researcher", "dependencies": ["decompose"] },
                { "id": "review", "title": "Review result and surface risks", "ownerAgentId": "reviewer", "dependencies": ["research"] },
                { "id": "synthesize", "title": "Synthesize final response", "ownerAgentId": "orchestrator", "dependencies": ["review"] }
            ]
        }),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, params: Option<Value>) -> RuntimeJsonRpcRequest {
        RuntimeJsonRpcRequest {
            jsonrpc: Some(JSON_RPC_VERSION.to_string()),
            id: Some(json!(1)),
            method: method.to_string(),
            params,
        }
    }

    fn process_bridge_manager(
        command: RuntimeCommandSpec,
        available: bool,
    ) -> RuntimeSidecarManager {
        RuntimeSidecarManager::with_process_bridge(Some(command), available)
    }

    fn unique_custom_agent_name() -> String {
        format!("test-agent-{}-{}", std::process::id(), now_ms())
    }

    #[test]
    fn runtime_health_returns_facade_status() {
        let facade = RuntimeFacade::default();
        let response = facade.handle_runtime_json_rpc(request("runtime.health", None));

        assert!(response.error.is_none());
        assert_eq!(response.id, Some(json!(1)));
        assert_eq!(
            response.result.unwrap().get("bridge_mode").unwrap(),
            &json!(BRIDGE_MODE_FACADE)
        );
    }

    #[test]
    fn sidecar_manager_reports_facade_mode_without_process_spawn() {
        let manager = RuntimeSidecarManager::default();
        let status = manager.status();

        assert_eq!(status.runtime_mode, RUNTIME_MODE_FACADE);
        assert_eq!(status.command, PROD_RUNTIME_COMMAND_DISPLAY);
        assert!(!status.process_spawn_available);
        assert!(!status.sidecar_process_spawn_enabled);
        assert!(status.sidecar_spawn_enabled);
    }

    #[test]
    fn sidecar_manager_reports_process_mode_when_bridge_is_enabled() {
        let manager = process_bridge_manager(
            dev_runtime_command().expect("workspace tsx cli should be available in tests"),
            true,
        );
        let status = manager.status();

        assert_eq!(status.runtime_mode, RUNTIME_MODE_PROCESS);
        assert_eq!(status.bridge_mode, RUNTIME_MODE_PROCESS);
        assert_eq!(status.transport, BRIDGE_MODE_PROCESS);
        assert_eq!(status.command, DEV_RUNTIME_COMMAND_DISPLAY);
        assert!(status.process_spawn_available);
        assert!(status.sidecar_process_spawn_enabled);
    }

    #[test]
    fn dev_runtime_command_enables_managed_langfuse_env() {
        let command = dev_runtime_command().expect("workspace tsx cli should be available in tests");

        assert!(command
            .environment
            .iter()
            .any(|(key, value)| key == "ORA_LANGFUSE_ENABLED" && value == "true"));
        assert!(command
            .environment
            .iter()
            .any(|(key, value)| key == "LANGFUSE_BASE_URL" && value == MANAGED_LANGFUSE_BASE_URL));
        assert!(command.environment.iter().any(|(key, value)| {
            key == "LANGFUSE_PUBLIC_KEY" && value == MANAGED_LANGFUSE_PUBLIC_KEY
        }));
        assert!(command.environment.iter().any(|(key, value)| {
            key == "LANGFUSE_SECRET_KEY" && value == MANAGED_LANGFUSE_SECRET_KEY
        }));
    }

    #[test]
    fn runtime_json_rpc_uses_process_bridge_when_available() {
        let manager = process_bridge_manager(
            RuntimeCommandSpec::new(
                "sh -c one-shot-json-rpc",
                "sh",
                vec![
                    "-c".to_string(),
                    "read line; printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"bridge\":\"process\"}}'".to_string(),
                ],
                None,
                Vec::new(),
            ),
            true,
        );
        let facade = RuntimeFacade::default();
        let response = manager
            .try_process_json_rpc(&request("runtime.health", None))
            .unwrap_or_else(|| facade.handle_runtime_json_rpc(request("runtime.health", None)));

        assert_eq!(response.jsonrpc, JSON_RPC_VERSION);
        assert_eq!(response.id, Some(json!(1)));
        assert_eq!(response.result.unwrap()["bridge"], json!("process"));
    }

    #[test]
    fn process_bridge_returns_valid_response_before_child_cleanup_finishes() {
        let manager = process_bridge_manager(
            RuntimeCommandSpec::new(
                "sh -c delayed-cleanup-json-rpc",
                "sh",
                vec![
                    "-c".to_string(),
                    "read line; printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"bridge\":\"process\"}}'; sleep 3; exit 1".to_string(),
                ],
                None,
                Vec::new(),
            ),
            true,
        );

        let started = std::time::Instant::now();
        let response = manager
            .try_process_json_rpc(&request("runtime.health", None))
            .expect("valid JSON-RPC response should be returned before child cleanup");

        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "process bridge should not block on post-response child cleanup"
        );
        assert_eq!(response.jsonrpc, JSON_RPC_VERSION);
        assert_eq!(response.id, Some(json!(1)));
        assert_eq!(response.result.unwrap()["bridge"], json!("process"));
    }

    #[test]
    fn patterns_list_returns_contract_array() {
        let facade = RuntimeFacade::default();
        let response = facade.handle_runtime_json_rpc(request("patterns.list", None));

        let result = response.result.unwrap();
        assert_eq!(result.as_array().unwrap().len(), 5);
        assert_eq!(
            result[0].get("id").unwrap(),
            &json!("orchestrator_subagent")
        );
    }

    #[test]
    fn provider_keychain_service_rejects_unsanitized_ids() {
        assert_eq!(
            provider_keychain_service("openai-gpt").unwrap(),
            "ora.provider.openai-gpt"
        );
        assert!(provider_keychain_service("openai/gpt").is_err());
        assert!(provider_keychain_service("").is_err());
    }

    #[test]
    fn run_lifecycle_supports_state_stream_export_and_list() {
        let facade = RuntimeFacade::default();
        let start = facade.handle_runtime_json_rpc(request(
            "runs.start",
            Some(json!({
                "input": { "prompt": "Bridge smoke", "context": {} },
                "config": {
                    "pattern": "agent_teams",
                    "customAgentId": "bridge-smoke-agent"
                }
            })),
        ));
        let run_id = start.result.unwrap()["runId"].as_str().unwrap().to_string();

        let state = facade
            .handle_method("runs.state", Some(json!({ "runId": run_id.clone() })))
            .unwrap();
        assert_eq!(state["pattern"], json!("agent_teams"));
        assert_eq!(state["config"]["customAgentId"], json!("bridge-smoke-agent"));

        let stream = facade
            .handle_method(
                "runs.stream",
                Some(json!({ "runId": run_id.clone(), "afterSeq": 2 })),
            )
            .unwrap();
        assert_eq!(stream["fromSeq"], json!(3));

        let artifact = facade
            .handle_method(
                "runs.exportReport",
                Some(json!({ "runId": run_id.clone() })),
            )
            .unwrap();
        assert_eq!(artifact["kind"], json!("report"));

        let list = facade.handle_method("runs.list", None).unwrap();
        assert_eq!(list.as_array().unwrap()[0]["artifactCount"], json!(1));
    }

    #[test]
    fn run_start_preserves_provider_config_in_facade_snapshots() {
        let facade = RuntimeFacade::default();
        let start = facade.handle_runtime_json_rpc(request(
            "runs.start",
            Some(json!({
                "input": { "prompt": "Bridge provider handoff", "context": {} },
                "config": {
                    "pattern": "generator_verifier",
                    "providerId": "deepseek",
                    "modelRef": "deepseek-chat",
                    "providerConfig": {
                        "id": "deepseek",
                        "type": "openai_compatible",
                        "label": "DeepSeek",
                        "modelId": "deepseek-chat",
                        "enabled": true,
                        "baseUrl": "https://api.deepseek.com",
                        "apiKeyEnv": "DEEPSEEK_API_KEY",
                        "protocol": "chat_completions",
                        "capabilities": ["chat", "tool_use", "reasoning", "json_mode"],
                        "dropParams": [],
                        "headers": {}
                    }
                }
            })),
        ));
        let run_id = start.result.unwrap()["runId"].as_str().unwrap().to_string();

        let state = facade
            .handle_method("runs.state", Some(json!({ "runId": run_id })))
            .unwrap();

        assert_eq!(state["config"]["providerId"], json!("deepseek"));
        assert_eq!(state["config"]["modelRef"], json!("deepseek-chat"));
        assert_eq!(state["config"]["providerConfig"]["id"], json!("deepseek"));
        assert_eq!(
            state["config"]["providerConfig"]["baseUrl"],
            json!("https://api.deepseek.com")
        );
    }

    #[test]
    fn custom_agent_lifecycle_persists_to_workspace_files() {
        let facade = RuntimeFacade::default();
        let name = unique_custom_agent_name();
        let agent_dir = custom_agent_dir(&name).expect("custom agent dir should resolve");
        if agent_dir.exists() {
            let _ = fs::remove_dir_all(&agent_dir);
        }

        let created = facade
            .handle_method(
                "agents.create",
                Some(json!({
                    "name": name,
                    "description": "Tracks Hong Kong market research.",
                    "model": "claude-sonnet-4-20250514",
                    "toolGroups": ["web", "shell"],
                    "soul": "Always collect evidence before summarizing."
                })),
            )
            .unwrap();
        assert_eq!(created["name"], json!(name));
        assert!(custom_agent_config_path(&agent_dir).is_file());
        assert!(custom_agent_soul_path(&agent_dir).is_file());

        let list = facade.handle_method("agents.list", None).unwrap();
        assert!(list
            .as_array()
            .unwrap()
            .iter()
            .any(|agent| agent["name"] == json!(name)));

        let fetched = facade
            .handle_method("agents.get", Some(json!({ "name": name })))
            .unwrap();
        assert_eq!(
            fetched["soul"],
            json!("Always collect evidence before summarizing.")
        );

        let availability = facade
            .handle_method("agents.checkName", Some(json!({ "name": name })))
            .unwrap();
        assert_eq!(availability["available"], json!(false));

        let updated = facade
            .handle_method(
                "agents.update",
                Some(json!({
                    "name": name,
                    "description": "Updated description",
                    "model": null,
                    "toolGroups": null,
                    "soul": "Updated SOUL"
                })),
            )
            .unwrap();
        assert_eq!(updated["description"], json!("Updated description"));
        assert!(updated["model"].is_null());
        assert!(updated["toolGroups"].is_null());

        let deleted = facade
            .handle_method("agents.delete", Some(json!({ "name": name })))
            .unwrap();
        assert_eq!(deleted["deleted"], json!(true));
        assert!(!agent_dir.exists());

        let available_again = facade
            .handle_method("agents.checkName", Some(json!({ "name": name })))
            .unwrap();
        assert_eq!(available_again["available"], json!(true));
    }

    #[test]
    fn session_lifecycle_supports_create_get_and_turn_append() {
        let facade = RuntimeFacade::default();
        let project = facade
            .handle_method(
                "projects.create",
                Some(json!({ "rootPath": "/tmp/ora-ui", "label": "ora-ui" })),
            )
            .unwrap();
        let created = facade
            .handle_method(
                "sessions.create",
                Some(json!({ "projectId": project["projectId"] })),
            )
            .unwrap();
        let session_id = created["sessionId"].as_str().unwrap().to_string();
        assert_eq!(created["turnCount"], json!(0));

        let first = facade
            .handle_method(
                "runs.start",
                Some(json!({
                    "sessionId": session_id.clone(),
                    "input": { "prompt": "First turn" },
                    "config": { "pattern": "generator_verifier" }
                })),
            )
            .unwrap();
        let second = facade
            .handle_method(
                "runs.start",
                Some(json!({
                    "sessionId": session_id.clone(),
                    "input": { "prompt": "Second turn" },
                    "config": { "pattern": "shared_state" }
                })),
            )
            .unwrap();

        assert_eq!(first["turnIndex"], json!(1));
        assert_eq!(second["turnIndex"], json!(2));
        assert_eq!(second["sessionId"], json!(session_id));

        let detail = facade
            .handle_method("sessions.get", Some(json!({ "sessionId": session_id })))
            .unwrap();
        assert_eq!(detail["session"]["turnCount"], json!(2));
        assert_eq!(detail["session"]["latestPattern"], json!("shared_state"));
        assert_eq!(detail["turns"].as_array().unwrap().len(), 2);
        assert_eq!(detail["transcript"].as_array().unwrap().len(), 4);
        assert_eq!(detail["latestSnapshot"]["runId"], second["runId"]);
    }

    #[test]
    fn fork_and_resume_return_updated_snapshots() {
        let facade = RuntimeFacade::default();
        let start = facade.handle_runtime_json_rpc(request(
            "runs.start",
            Some(json!({
                "input": { "prompt": "Fork me", "context": {} },
                "config": { "pattern": "generator_verifier" }
            })),
        ));
        let source_run_id = start.result.unwrap()["runId"].as_str().unwrap().to_string();
        let checkpoints = facade
            .handle_method(
                "runs.checkpoints",
                Some(json!({ "runId": source_run_id.clone() })),
            )
            .unwrap();
        let checkpoint_id = checkpoints[0]["id"].as_str().unwrap().to_string();
        let fork = facade
            .handle_method(
                "runs.fork",
                Some(json!({ "runId": source_run_id, "checkpointId": checkpoint_id })),
            )
            .unwrap();

        let fork_id = fork["runId"].as_str().unwrap().to_string();
        let interrupted = facade
            .handle_method("runs.interrupt", Some(json!({ "runId": fork_id.clone() })))
            .unwrap();
        assert_eq!(interrupted["status"], json!("interrupted"));

        let resumed = facade
            .handle_method("runs.resume", Some(json!({ "runId": fork_id })))
            .unwrap();
        assert_eq!(resumed["status"], json!("succeeded"));
    }

    #[test]
    fn unsupported_method_returns_json_rpc_error() {
        let facade = RuntimeFacade::default();
        let response = facade.handle_runtime_json_rpc(request("runtime.nope", None));

        let error = response.error.unwrap();
        assert_eq!(error.code, -32601);
        assert!(response.result.is_none());
    }
}
