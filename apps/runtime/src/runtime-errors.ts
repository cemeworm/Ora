export class OraRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code = -32000,
    public readonly data?: unknown
  ) {
    super(message);
  }
}
