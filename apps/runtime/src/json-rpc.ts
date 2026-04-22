import {
  JsonRpcRequest,
  JsonRpcRequestSchema,
  JsonRpcResponse,
  JsonRpcResponseSchema
} from "@ora/shared";
import { ZodError } from "zod";
import { LocalRunStore, OraRuntimeError } from "./run-store.js";
import { SessionManager } from "./session/session-manager.js";

export type JsonRpcMethodHandler = (request: JsonRpcRequest) => Promise<unknown> | unknown;

export function createRuntimeMethodHandler(
  store = new LocalRunStore(),
  sessionManager = new SessionManager(process.env.ORA_LANGGRAPH_ENABLED === "true")
): JsonRpcMethodHandler {
  return (request) => {
    switch (request.method) {
      case "runtime.health":
        return store.health();
      case "patterns.list":
        return store.listPatterns();
      case "runs.start":
        // When LangGraph is enabled, SessionManager handles the graph invocation.
        // For now, always delegates to the deterministic LocalRunStore.
        return store.startRun(request.params);
      case "runs.list":
        return store.listRuns(request.params);
      case "runs.stream":
        return store.streamRun(request.params);
      case "runs.interrupt":
        return store.interruptRun(request.params);
      case "runs.resume":
        return store.resumeRun(request.params);
      case "runs.cancel":
        return store.cancelRun(request.params);
      case "runs.state":
        return store.getRunState(request.params);
      case "runs.checkpoints":
        return store.listCheckpoints(request.params);
      case "runs.replay":
        return store.replayRun(request.params);
      case "runs.fork":
        return store.forkRun(request.params);
      case "runs.exportReport":
        return store.exportReport(request.params);
      default:
        throw new OraRuntimeError(`Method not found: ${request.method}`, -32601, {
          method: request.method
        });
    }
  };
}

export async function handleJsonRpcLine(
  line: string,
  handler: JsonRpcMethodHandler
): Promise<JsonRpcResponse | undefined> {
  if (!line.trim()) {
    return undefined;
  }

  let id: JsonRpcResponse["id"] = null;

  try {
    const decoded = JSON.parse(line);
    id = typeof decoded?.id === "string" || typeof decoded?.id === "number" ? decoded.id : null;
    const request = JsonRpcRequestSchema.parse(decoded);
    const result = await handler(request);

    if (request.id === undefined) {
      return undefined;
    }

    return JsonRpcResponseSchema.parse({
      jsonrpc: "2.0",
      id: request.id,
      result
    });
  } catch (error) {
    return JsonRpcResponseSchema.parse({
      jsonrpc: "2.0",
      id,
      error: normalizeError(error)
    });
  }
}

function normalizeError(error: unknown) {
  if (error instanceof SyntaxError) {
    return {
      code: -32700,
      message: "Parse error"
    };
  }

  if (error instanceof ZodError) {
    return {
      code: -32602,
      message: "Invalid params",
      data: error.flatten()
    };
  }

  if (error instanceof OraRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data
    };
  }

  return {
    code: -32603,
    message: error instanceof Error ? error.message : "Internal error"
  };
}
