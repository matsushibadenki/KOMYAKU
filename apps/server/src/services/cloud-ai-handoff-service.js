import { confirmedHandoffSchema } from "@komyaku/ai-gateway";
import { conversationMessageSchema } from "@komyaku/conversation-schema";
import { z } from "zod";

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  confirmed: confirmedHandoffSchema,
  responseMessage: conversationMessageSchema,
  providerResponseId: z.string().max(1000).nullable().default(null),
  completedAt: z.string().datetime({ offset: true })
});

export class CloudAiHandoffError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "CloudAiHandoffError";
    this.code = code;
  }
}

export function createCloudAiHandoffService({ repository }) {
  if (!repository?.persistCompletedHandoff) throw new Error("Cloud AI handoff repository is required");

  return Object.freeze({
    async persistCompleted(input) {
      let request;
      try {
        request = requestSchema.parse(input);
      } catch (cause) {
        throw new CloudAiHandoffError("invalid_cloud_ai_handoff", { cause });
      }
      const { confirmed, responseMessage } = request;
      if (confirmed.consentedBy !== request.actorId
        || responseMessage.conversationId !== confirmed.conversationId
        || responseMessage.role !== "assistant") {
        throw new CloudAiHandoffError("invalid_cloud_ai_handoff");
      }
      try {
        return await repository.persistCompletedHandoff(request);
      } catch (error) {
        if (error instanceof CloudAiHandoffError) throw error;
        throw new CloudAiHandoffError("cloud_ai_handoff_storage_failure", { cause: error });
      }
    }
  });
}
