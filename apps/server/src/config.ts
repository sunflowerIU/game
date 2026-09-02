import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVER_HOST: z.string().min(1).default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  ADMIN_ORIGIN: z.url().default("http://127.0.0.1:3001")
}).superRefine((environment, context) => {
  if (environment.NODE_ENV !== "production") return;
  if (!environment.WEB_ORIGIN.startsWith("https://")) context.addIssue({ code: "custom", path: ["WEB_ORIGIN"], message: "Production WEB_ORIGIN must use HTTPS" });
  if (!environment.ADMIN_ORIGIN.startsWith("https://")) context.addIssue({ code: "custom", path: ["ADMIN_ORIGIN"], message: "Production ADMIN_ORIGIN must use HTTPS" });
  if (!environment.TRUST_PROXY) context.addIssue({ code: "custom", path: ["TRUST_PROXY"], message: "Production requires TRUST_PROXY=true behind Nginx" });
});

export interface ServerConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  readonly nodeEnv: z.infer<typeof environmentSchema>["NODE_ENV"];
  readonly port: number;
  readonly trustProxy: boolean;
  readonly webOrigin: string | string[];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.SERVER_HOST,
    logLevel: parsed.LOG_LEVEL,
    nodeEnv: parsed.NODE_ENV,
    port: parsed.SERVER_PORT,
    trustProxy: parsed.TRUST_PROXY,
    webOrigin: [parsed.WEB_ORIGIN, parsed.ADMIN_ORIGIN]
  };
}
