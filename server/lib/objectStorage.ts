import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function envStr(name: string): string {
  return String(process.env[name] || "").trim();
}

export function getObjectStorageConfigFromEnv(): ObjectStorageConfig | null {
  const endpoint = envStr("OBJECT_STORAGE_ENDPOINT");
  const region = envStr("OBJECT_STORAGE_REGION");
  const bucket = envStr("OBJECT_STORAGE_BUCKET");
  const accessKeyId = envStr("OBJECT_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = envStr("OBJECT_STORAGE_SECRET_ACCESS_KEY");

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function buildClient(cfg: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

async function readableToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof body?.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  if (typeof body?.arrayBuffer === "function") {
    const ab = await body.arrayBuffer();
    return Buffer.from(ab);
  }
  return Buffer.alloc(0);
}

export async function putPdfObject(opts: {
  key: string;
  pdf: Buffer;
  contentType?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = getObjectStorageConfigFromEnv();
  if (!cfg) return { ok: false, error: "Object Storage não configurado (env vars ausentes)." };

  try {
    const client = buildClient(cfg);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: opts.key,
        Body: opts.pdf,
        ContentType: opts.contentType || "application/pdf",
        CacheControl: "private, max-age=0, no-transform",
      }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPdfObject(opts: {
  key: string;
}): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string }> {
  const cfg = getObjectStorageConfigFromEnv();
  if (!cfg) return { ok: false, error: "Object Storage não configurado (env vars ausentes)." };

  try {
    const client = buildClient(cfg);
    const out = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: opts.key,
      }),
    );
    const buf = await readableToBuffer((out as any).Body);
    if (!buf.length) return { ok: false, error: "Objeto retornou vazio." };
    return { ok: true, pdf: buf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

