use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const JSON_RPC_VERSION: &str = "2.0";
const RUNTIME_COMMAND: &str = "ora-runtime-sidecar";
const BRIDGE_MODE: &str = "in-process-facade";
const STATUS_REASON: &str =
    "Runtime process spawning is disabled; Rust is serving deterministic Ora facade responses.";
const DEFAULT_PATTERN: &str = "orchestrator_subagent";

#[derive(Default)]
pub struct RuntimeFacade {
    state: Mutex<FacadeState>,
}

#[derive(Default)]
struct FacadeState {
    runs: HashMap<String, Value>,
    run_order: Vec<String>,
    next_run_number: u64,
}

#[derive(Serialize)]
pub struct SidecarStatus {
    configured: bool,
    sidecar_configured: bool,
    json_rpc_facade_enabled: bool,
    transport: &'static str,
    command: &'static str,
    bridge_mode: &'static str,
    sidecar_spawn_enabled: bool,
    sidecar_process_spawn_enabled: bool,
    shell_authority_exposed: bool,
    reason: &'static str,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RuntimeJsonRpcRequest {
    #[serde(default)]
    pub jsonrpc: Option<String>,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeJsonRpcResponse {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RuntimeJsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeJsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[tauri::command]
pub fn runtime_sidecar_status() -> SidecarStatus {
    SidecarStatus {
        configured: true,
        sidecar_configured: false,
        json_rpc_facade_enabled: true,
        transport: "in-process-json-rpc-facade",
        command: RUNTIME_COMMAND,
        bridge_mode: BRIDGE_MODE,
        sidecar_spawn_enabled: true,
        sidecar_process_spawn_enabled: false,
        shell_authority_exposed: false,
        reason: STATUS_REASON,
    }
}

#[tauri::command]
pub fn preview_sidecar_command() -> Vec<&'static str> {
    vec![
        "ora-runtime-sidecar",
        "--transport",
        "stdio",
        "--event-format",
        "ora-envelope-v1",
    ]
}

#[tauri::command]
pub fn runtime_json_rpc(
    request: RuntimeJsonRpcRequest,
    facade: State<'_, RuntimeFacade>,
) -> RuntimeJsonRpcResponse {
    facade.handle_runtime_json_rpc(request)
}

#[tauri::command]
pub fn runtime_start_run(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.start", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_stream_run(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.stream", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_list_runs(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.list", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_fork_run(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.fork", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_resume_run(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.resume", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_cancel_run(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.cancel", params).map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_export_report(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade
        .handle_method("runs.exportReport", params)
        .map_err(|error| error.message)
}

#[tauri::command]
pub fn runtime_run_status(params: Option<Value>, facade: State<'_, RuntimeFacade>) -> Result<Value, String> {
    facade.handle_method("runs.state", params).map_err(|error| error.message)
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
                jsonrpc: JSON_RPC_VERSION,
                id: request.id,
                result: None,
                error: Some(error),
            },
        }
    }

    fn handle_method(&self, method: &str, params: Option<Value>) -> Result<Value, RuntimeJsonRpcError> {
        match method {
            "runtime.health" => Ok(runtime_health()),
            "patterns.list" => Ok(patterns_list()),
            "runs.start" => self.runs_start(params.as_ref()),
            "runs.list" => self.runs_list(params.as_ref()),
            "runs.stream" => self.runs_stream(params.as_ref()),
            "runs.interrupt" => self.runs_interrupt(params.as_ref()),
            "runs.resume" => self.runs_resume(params.as_ref()),
            "runs.cancel" => self.runs_cancel(params.as_ref()),
            "runs.state" => self.runs_state(params.as_ref()),
            "runs.checkpoints" => self.runs_checkpoints(params.as_ref()),
            "runs.replay" => self.runs_replay(params.as_ref()),
            "runs.fork" => self.runs_fork(params.as_ref()),
            "runs.exportReport" => self.runs_export_report(params.as_ref()),
            _ => Err(runtime_error(
                -32601,
                "Method not found",
                Some(json!({
                    "method": method,
                    "bridge_mode": BRIDGE_MODE,
                    "reason": "The in-process facade implements Ora MVP runtime methods without exposing shell authority."
                })),
            )),
        }
    }

    fn runs_start(&self, params: Option<&Value>) -> Result<Value, RuntimeJsonRpcError> {
        let prompt = start_prompt(params)?;
        let pattern = start_pattern(params)?;
        let started_at = now_ms();
        let mut state = self.lock_state()?;
        state.next_run_number += 1;
        let run_id = format!("run-{:04}", state.next_run_number);
        let snapshot = create_snapshot(&run_id, pattern, &prompt, started_at, None);
        state.runs.insert(run_id.clone(), snapshot.clone());
        state.run_order.push(run_id.clone());

        Ok(json!({
            "runId": run_id,
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
        let state = self.lock_state()?;
        let mut summaries = Vec::new();

        for run_id in state.run_order.iter().rev() {
            if let Some(snapshot) = state.runs.get(run_id) {
                let status = snapshot["status"].as_str().unwrap_or("failed");
                if status_filter.map_or(false, |expected| expected != status) {
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
        self.transition_run(params, "interrupted", "run.interrupted", json!({ "reason": reason }))
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
        let snapshot = get_run_mut(&mut state, &run_id)?;
        append_event(snapshot, "run.resumed", json!({ "reason": reason, "patch": patch }), None);
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
        Ok(snapshot.clone())
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
        Ok(artifact)
    }

    fn create_child_run(&self, params: Option<&Value>, is_fork: bool) -> Result<Value, RuntimeJsonRpcError> {
        let source_run_id = require_run_id(params)?;
        let checkpoint_id = require_checkpoint_id(params)?;
        let mut state = self.lock_state()?;
        let source = get_run(&state, &source_run_id)?;
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
        let started_at = now_ms();
        state.next_run_number += 1;
        let child_run_id = format!("run-{:04}", state.next_run_number);
        let forked_from = json!({
            "runId": source_run_id,
            "checkpointId": checkpoint_id,
            "eventSeq": checkpoint["eventSeq"],
            "mode": if is_fork { "fork" } else { "replay" }
        });
        let snapshot = create_snapshot(
            &child_run_id,
            &pattern,
            &prompt,
            started_at,
            Some(forked_from),
        );
        state.runs.insert(child_run_id.clone(), snapshot.clone());
        state.run_order.push(child_run_id.clone());

        Ok(json!({
            "runId": child_run_id,
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
        let snapshot = get_run_mut(&mut state, &run_id)?;
        append_event(snapshot, event_type, payload, None);
        set_snapshot_status(snapshot, status);
        Ok(snapshot.clone())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, FacadeState>, RuntimeJsonRpcError> {
        self.state
            .lock()
            .map_err(|_| runtime_error(-32000, "Runtime facade state lock failed", None))
    }
}

fn json_rpc_result(id: Option<Value>, result: Value) -> RuntimeJsonRpcResponse {
    RuntimeJsonRpcResponse {
        jsonrpc: JSON_RPC_VERSION,
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
        jsonrpc: JSON_RPC_VERSION,
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
        "bridge_mode": BRIDGE_MODE,
        "transport": "in-process-json-rpc-facade",
        "sidecar_spawn_enabled": true,
        "sidecar_process_spawn_enabled": false,
        "shell_authority_exposed": false,
        "reason": STATUS_REASON
    })
}

fn patterns_list() -> Value {
    Value::Array(vec![
        pattern_definition("orchestrator_subagent"),
        pattern_definition("generator_verifier"),
        pattern_definition("agent_teams"),
    ])
}

fn create_snapshot(
    run_id: &str,
    pattern: &str,
    prompt: &str,
    started_at: u64,
    forked_from: Option<Value>,
) -> Value {
    let definition = pattern_definition(pattern);
    let topology = definition["topology"].clone();
    let plan_template = definition["planTemplate"].as_array().cloned().unwrap_or_default();
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
                "{} accepted a local smoke task: {}",
                definition["label"].as_str().unwrap_or("Ora"),
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

    json!({
        "runId": run_id,
        "status": "succeeded",
        "pattern": pattern,
        "input": {
            "prompt": prompt,
            "projectId": "ora-mvp",
            "context": forked_from.map_or_else(|| json!({}), |fork_info| json!({ "forkedFrom": fork_info })),
            "createdAt": started_at
        },
        "config": {
            "pattern": pattern,
            "profileIds": definition["profiles"].as_array().map(|profiles| {
                profiles.iter().filter_map(|profile| profile["id"].as_str()).collect::<Vec<&str>>()
            }).unwrap_or_default(),
            "modelRef": "local/smoke-model",
            "budget": definition["defaultBudget"],
            "metadata": { "source": "tauri-facade" },
            "deterministicSeed": "ora-smoke"
        },
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
                "Smoke result for {}: {}",
                definition["label"].as_str().unwrap_or("Ora"),
                prompt
            )
        },
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

fn append_event(snapshot: &mut Value, event_type: &str, payload: Value, checkpoint_id: Option<&str>) {
    let seq = snapshot["events"].as_array().map_or(0, Vec::len) as u64;
    let pattern = snapshot["pattern"].as_str().unwrap_or(DEFAULT_PATTERN).to_string();
    let run_id = snapshot["runId"].as_str().unwrap_or("run").to_string();
    let updated_at = now_ms();
    let event = create_event(&run_id, seq, event_type, payload, &pattern, updated_at, checkpoint_id);
    push_array_item(snapshot, "events", event);
    set_object_value(snapshot, "updatedAt", json!(updated_at));
}

fn run_summary(snapshot: &Value) -> Value {
    json!({
        "runId": snapshot["runId"],
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

fn get_run<'a>(state: &'a FacadeState, run_id: &str) -> Result<&'a Value, RuntimeJsonRpcError> {
    state.runs.get(run_id).ok_or_else(|| {
        runtime_error(
            -32004,
            "Run not found",
            Some(json!({ "runId": run_id })),
        )
    })
}

fn get_run_mut<'a>(
    state: &'a mut FacadeState,
    run_id: &str,
) -> Result<&'a mut Value, RuntimeJsonRpcError> {
    state.runs.get_mut(run_id).ok_or_else(|| {
        runtime_error(
            -32004,
            "Run not found",
            Some(json!({ "runId": run_id })),
        )
    })
}

fn require_run_id(params: Option<&Value>) -> Result<String, RuntimeJsonRpcError> {
    params
        .and_then(|value| value.get("runId"))
        .and_then(Value::as_str)
        .filter(|run_id| !run_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| runtime_error(-32602, "Missing runId", None))
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
        .or_else(|| params.and_then(|value| value.get("pattern")).and_then(Value::as_str))
        .unwrap_or(DEFAULT_PATTERN);
    ensure_pattern(pattern)?;
    Ok(pattern)
}

fn ensure_pattern(pattern: &str) -> Result<(), RuntimeJsonRpcError> {
    match pattern {
        "generator_verifier" | "orchestrator_subagent" | "agent_teams" => Ok(()),
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

    #[test]
    fn runtime_health_returns_facade_status() {
        let facade = RuntimeFacade::default();
        let response = facade.handle_runtime_json_rpc(request("runtime.health", None));

        assert!(response.error.is_none());
        assert_eq!(response.id, Some(json!(1)));
        assert_eq!(
            response.result.unwrap().get("bridge_mode").unwrap(),
            &json!(BRIDGE_MODE)
        );
    }

    #[test]
    fn patterns_list_returns_contract_array() {
        let facade = RuntimeFacade::default();
        let response = facade.handle_runtime_json_rpc(request("patterns.list", None));

        let result = response.result.unwrap();
        assert_eq!(result.as_array().unwrap().len(), 3);
        assert_eq!(result[0].get("id").unwrap(), &json!("orchestrator_subagent"));
    }

    #[test]
    fn run_lifecycle_supports_state_stream_export_and_list() {
        let facade = RuntimeFacade::default();
        let start = facade.handle_runtime_json_rpc(request(
            "runs.start",
            Some(json!({
                "input": { "prompt": "Bridge smoke", "context": {} },
                "config": { "pattern": "agent_teams" }
            })),
        ));
        let run_id = start.result.unwrap()["runId"].as_str().unwrap().to_string();

        let state = facade
            .handle_method("runs.state", Some(json!({ "runId": run_id.clone() })))
            .unwrap();
        assert_eq!(state["pattern"], json!("agent_teams"));

        let stream = facade
            .handle_method("runs.stream", Some(json!({ "runId": run_id.clone(), "afterSeq": 2 })))
            .unwrap();
        assert_eq!(stream["fromSeq"], json!(3));

        let artifact = facade
            .handle_method("runs.exportReport", Some(json!({ "runId": run_id.clone() })))
            .unwrap();
        assert_eq!(artifact["kind"], json!("report"));

        let list = facade.handle_method("runs.list", None).unwrap();
        assert_eq!(list.as_array().unwrap()[0]["artifactCount"], json!(1));
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
            .handle_method("runs.checkpoints", Some(json!({ "runId": source_run_id.clone() })))
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
