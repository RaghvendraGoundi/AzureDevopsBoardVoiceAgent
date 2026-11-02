import { configWarnings } from "@/lib/configCheck";

for (const w of configWarnings()) console.warn(`[config] ${w}`);

/**
 * OpenTelemetry to Azure Monitor (Application Insights): traces requests,
 * outbound HTTP (Azure DevOps, models) and Postgres; tool calls get their own
 * spans (see src/lib/devops/toolRoute.ts). Off unless configured.
 */
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()) {
  const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING },
    instrumentationOptions: { http: { enabled: true }, postgreSql: { enabled: true } },
  });
  console.info("[telemetry] OpenTelemetry → Azure Monitor enabled");
}
