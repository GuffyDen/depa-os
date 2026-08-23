import { createRequestId, emitStructuredLog } from "./structured-logger.mjs";

export type ActorType = "EMPLOYEE" | "CLIENT" | "ANONYMOUS" | "SYSTEM";
type RequestLogBase = { route: string; action?: string | null; method?: string; actorType?: ActorType; actorId?: string | null; projectId?: string | null; clientId?: string | null; entityId?: string | null };
type RequestLogDetails = Record<string, unknown> & { projectId?: string | null; clientId?: string | null; entityId?: string | null; errorCode?: string | null };

export function createRequestLogger(request: Request, base: RequestLogBase) {
  const requestId = createRequestId(request);
  const startedAt = performance.now();
  function write(level: "INFO" | "WARN" | "ERROR", status: "START" | "SUCCESS" | "FAILURE", eventCode: string, details: RequestLogDetails = {}) {
    return emitStructuredLog({ ...base, method: base.method ?? request.method, level, requestId, eventCode, status, durationMs: Math.max(0, Math.round(performance.now() - startedAt)), ...details });
  }
  return {
    requestId,
    start: (eventCode: string, details?: RequestLogDetails) => write("INFO", "START", eventCode, details),
    success: (eventCode: string, details?: RequestLogDetails) => write("INFO", "SUCCESS", eventCode, details),
    failure: (eventCode: string, error: unknown, details: RequestLogDetails = {}) => write("ERROR", "FAILURE", eventCode, { ...details, errorCode: details.errorCode ?? (error instanceof Error ? error.name : "UNKNOWN_ERROR"), error: error instanceof Error ? error : new Error("Unknown failure") }),
    withRequestId(response: Response) { response.headers.set("X-Request-ID", requestId); return response; },
    json(body: unknown, init?: ResponseInit) { return this.withRequestId(Response.json(body, init)); },
  };
}
