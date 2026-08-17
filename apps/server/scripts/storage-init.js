import {
  createS3Client,
  ensureBucket,
  objectStorageConfigSchema
} from "@komyaku/storage-core";

const config = objectStorageConfigSchema.parse({
  endpoint: Bun.env.OBJECT_STORAGE_ENDPOINT || "http://127.0.0.1:9000",
  region: Bun.env.OBJECT_STORAGE_REGION || "us-east-1",
  bucket: Bun.env.OBJECT_STORAGE_BUCKET || "komyaku-local",
  accessKeyId: Bun.env.OBJECT_STORAGE_ACCESS_KEY || "komyaku",
  secretAccessKey: Bun.env.OBJECT_STORAGE_SECRET_KEY || "change-me-now",
  forcePathStyle: true
});

const client = createS3Client(config);
try {
  const result = await ensureBucket({ client, bucket: config.bucket });
  console.info(JSON.stringify({
    level: "info",
    event: "object_storage_initialized",
    bucket: config.bucket,
    created: result.created
  }));
} finally {
  client.destroy();
}
