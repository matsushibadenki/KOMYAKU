import { describe, expect, test } from "bun:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import {
  buildAssetObjectKey,
  buildVersionObjectKey,
  createObjectStore,
  ensureBucket,
  sha256
} from "../src/index.js";

describe("object storage boundary", () => {
  test("builds keys only from IDs, never document titles", () => {
    const workspaceId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    expect(buildVersionObjectKey({ workspaceId, documentId, versionId })).toBe(
      `workspaces/${workspaceId}/documents/${documentId}/versions/${versionId}.json`
    );
    expect(() => buildVersionObjectKey({
      workspaceId,
      documentId: "My private manuscript",
      versionId
    })).toThrow();
  });

  test("uses immutable writes with a content checksum", async () => {
    const commands = [];
    const store = createObjectStore({
      bucket: "komyaku-test",
      client: { send: async (command) => commands.push(command) }
    });

    const result = await store.putImmutable({
      key: "workspaces/test/object.json",
      body: "exact authored content",
      contentType: "application/json; charset=utf-8"
    });

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[0].input.IfNoneMatch).toBe("*");
    expect(result.contentHash).toHaveLength(64);
  });

  test("builds workspace-scoped content-addressed keys", async () => {
    const workspaceId = crypto.randomUUID();
    const hash = (await sha256("same bytes")).hex;
    expect(buildAssetObjectKey({ workspaceId, contentHash: hash })).toBe(
      `workspaces/${workspaceId}/assets/sha256/${hash.slice(0, 2)}/${hash}`
    );
    expect(() => buildAssetObjectKey({ workspaceId: "another tenant", contentHash: hash })).toThrow();
  });

  test("verifies an existing object before reporting a deduplicated write", async () => {
    const commands = [];
    const workspaceId = crypto.randomUUID();
    const body = new TextEncoder().encode("deduplicated payload");
    const hash = (await sha256(body)).hex;
    const client = {
      async send(command) {
        commands.push(command);
        if (command instanceof PutObjectCommand) {
          const error = new Error("already exists");
          error.name = "PreconditionFailed";
          throw error;
        }
        return { ContentLength: body.byteLength, Metadata: { "content-sha256": hash } };
      }
    };
    const store = createObjectStore({ bucket: "komyaku-test", client });

    expect(await store.putContentAddressed({
      workspaceId, body, contentType: "application/octet-stream"
    })).toEqual({
      key: buildAssetObjectKey({ workspaceId, contentHash: hash }),
      contentHash: hash,
      byteSize: body.byteLength,
      created: false
    });
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand);
  });

  test("rejects a conflicting object at a content-addressed key", async () => {
    const body = new TextEncoder().encode("expected payload");
    const client = {
      async send(command) {
        if (command instanceof PutObjectCommand) {
          const error = new Error("already exists");
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
        return { ContentLength: body.byteLength, Metadata: { "content-sha256": "0".repeat(64) } };
      }
    };
    const store = createObjectStore({ bucket: "komyaku-test", client });
    await expect(store.putContentAddressed({
      workspaceId: crypto.randomUUID(), body, contentType: "application/octet-stream"
    })).rejects.toThrow("integrity verification");
  });

  test("lists a bounded prefix page and deletes one exact key", async () => {
    const commands = [];
    const client = {
      async send(command) {
        commands.push(command);
        if (command instanceof ListObjectsV2Command) {
          return {
            Contents: [{ Key: "workspaces/w/assets/sha256/aa/hash", Size: 42 }],
            IsTruncated: true,
            NextContinuationToken: "next-page"
          };
        }
        return {};
      }
    };
    const store = createObjectStore({ bucket: "komyaku-test", client });
    expect(await store.listPrefix({ prefix: "workspaces/w/assets/", maxKeys: 20 })).toEqual({
      objects: [{ key: "workspaces/w/assets/sha256/aa/hash", byteSize: 42 }],
      nextContinuationToken: "next-page"
    });
    expect(await store.delete("workspaces/w/assets/sha256/aa/hash")).toEqual({
      key: "workspaces/w/assets/sha256/aa/hash", deleted: true
    });
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[0].input.MaxKeys).toBe(20);
    expect(commands[1]).toBeInstanceOf(DeleteObjectCommand);
  });

  test("reads only a bounded inspection range", async () => {
    const commands = [];
    const store = createObjectStore({
      bucket: "komyaku-test",
      client: { async send(command) { commands.push(command); return { Body: new Uint8Array() }; } }
    });
    await store.getRange("workspaces/w/assets/sha256/aa/hash", 0, 4095);
    expect(commands[0]).toBeInstanceOf(GetObjectCommand);
    expect(commands[0].input.Range).toBe("bytes=0-4095");
  });

  test("creates a missing bucket once", async () => {
    const commands = [];
    const client = {
      async send(command) {
        commands.push(command.constructor.name);
        if (commands.length === 1) {
          const error = new Error("missing");
          error.name = "NoSuchBucket";
          throw error;
        }
      }
    };

    expect(await ensureBucket({ client, bucket: "komyaku-test" })).toEqual({ created: true });
    expect(commands).toEqual(["HeadBucketCommand", "CreateBucketCommand"]);
  });
});
