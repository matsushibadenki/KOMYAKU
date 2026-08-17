import { describe, expect, test } from "bun:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  buildVersionObjectKey,
  createObjectStore,
  ensureBucket
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
