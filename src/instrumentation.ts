/**
 * Runs once when the server starts: logs configuration problems, and starts
 * OpenTelemetry to Azure Monitor when APPLICATIONINSIGHTS_CONNECTION_STRING is
 * set. The Node-only code lives in instrumentation.node.ts so it's never
 * bundled for the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
