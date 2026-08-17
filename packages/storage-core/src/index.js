import {
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

export const objectStorageConfigSchema = z.object({
  endpoint: z.string().url(),
  region: z.string().min(1),
  bucket: z.string().min(3),
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  forcePathStyle: z.boolean().default(true)
}).refine(
  (config) => Boolean(config.accessKeyId) === Boolean(config.secretAccessKey),
  { message: "Object storage credentials must be provided together" }
);

const uuidSchema = z.string().uuid();

export function buildVersionObjectKey({ workspaceId, documentId, versionId }) {
  const workspace = uuidSchema.parse(workspaceId);
  const document = uuidSchema.parse(documentId);
  const version = uuidSchema.parse(versionId);
  return `workspaces/${workspace}/documents/${document}/versions/${version}.json`;
}

export function buildImportObjectKey({ workspaceId, importId }) {
  const workspace = uuidSchema.parse(workspaceId);
  const conversationImport = uuidSchema.parse(importId);
  return `workspaces/${workspace}/conversation-imports/${conversationImport}/source.bin`;
}

export async function sha256(bytes) {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return {
    hex: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    base64: Buffer.from(digest).toString("base64")
  };
}

export function createS3Client(configInput) {
  const config = objectStorageConfigSchema.parse(configInput);
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: config.accessKeyId
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined
  });
}

export async function ensureBucket({ client, bucket }) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { created: false };
  } catch (error) {
    const missing = error?.$metadata?.httpStatusCode === 404
      || error?.name === "NotFound"
      || error?.name === "NoSuchBucket";
    if (!missing) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return { created: true };
  }
}

export function createObjectStore({ client, bucket }) {
  if (!client || typeof client.send !== "function") throw new Error("Object store client is required");
  const parsedBucket = z.string().min(3).parse(bucket);

  return Object.freeze({
    async putImmutable({ key, body, contentType, metadata = {} }) {
      const checksum = await sha256(body);
      await client.send(new PutObjectCommand({
        Bucket: parsedBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { ...metadata, "content-sha256": checksum.hex },
        ChecksumSHA256: checksum.base64,
        IfNoneMatch: "*"
      }));
      return { key, contentHash: checksum.hex };
    },

    async head(key) {
      return client.send(new HeadObjectCommand({ Bucket: parsedBucket, Key: key }));
    },

    async get(key) {
      return client.send(new GetObjectCommand({ Bucket: parsedBucket, Key: key }));
    },

    async createReadUrl(key, expiresIn = 300) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: parsedBucket, Key: key }),
        { expiresIn }
      );
    }
  });
}
