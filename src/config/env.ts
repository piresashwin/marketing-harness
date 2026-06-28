import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const PORT = Number(optional("PORT", "8787"));
const PUBLIC_BASE_URL = optional("PUBLIC_BASE_URL", `http://localhost:${PORT}`);

export const env = {
  port: PORT,
  publicBaseUrl: PUBLIC_BASE_URL.replace(/\/$/, ""),
  // Where the web UI is served (Vite dev origin in dev, harness origin in prod).
  appBaseUrl: optional("APP_BASE_URL", PUBLIC_BASE_URL).replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",

  databaseUrl: required("DATABASE_URL"),

  // AES-256-GCM key for encryption-at-rest (32 bytes, hex => 64 chars).
  // Required by the crypto helper, but not at app import: encrypt()/decrypt()
  // surface a clear error if it's missing/wrong length when actually used.
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY || "",
  // Optional previous key, used ONLY for decrypt fallback during rotation.
  // encrypt() always uses the primary key. Remove after `npm run reencrypt`.
  appEncryptionKeyOld: process.env.APP_ENCRYPTION_KEY_OLD || "",

  email: {
    resendApiKey: process.env.RESEND_API_KEY || "",
    from: optional("RESEND_FROM", "Marketing Harness <onboarding@resend.dev>"),
  },

  instagram: {
    clientId: process.env.IG_CLIENT_ID || "",
    clientSecret: process.env.IG_CLIENT_SECRET || "",
    redirectUri:
      process.env.IG_REDIRECT_URI ||
      `${PUBLIC_BASE_URL.replace(/\/$/, "")}/connectors/instagram/callback`,
    graphVersion: optional("IG_GRAPH_VERSION", "v21.0"),
  },

  media: {
    store: optional("MEDIA_STORE", "s3") as "s3" | "local",
    s3: {
      endpoint: process.env.S3_ENDPOINT || "",
      region: optional("S3_REGION", "us-east-1"),
      bucket: optional("S3_BUCKET", "marketing-harness-media"),
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
      publicBaseUrl: (
        process.env.S3_PUBLIC_BASE_URL ||
        `${process.env.S3_ENDPOINT || ""}/${optional("S3_BUCKET", "marketing-harness-media")}`
      ).replace(/\/$/, ""),
    },
    local: {
      dir: optional("LOCAL_MEDIA_DIR", ".media"),
      baseUrl: optional(
        "LOCAL_MEDIA_BASE_URL",
        `${PUBLIC_BASE_URL.replace(/\/$/, "")}/media`,
      ).replace(/\/$/, ""),
    },
  },
};

export function assertInstagramConfigured(): void {
  if (!env.instagram.clientId || !env.instagram.clientSecret) {
    throw new Error(
      "Instagram connector not configured: set IG_CLIENT_ID and IG_CLIENT_SECRET in .env",
    );
  }
}
