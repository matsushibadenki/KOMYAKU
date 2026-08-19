import { z } from "zod";
import { hashOpaqueToken } from "../security/session-tokens.js";
import { NotificationEnvelopeError } from "../notifications/notification-envelope.js";
import { JobExecutionError } from "./job-runner.js";

const jobPayloadSchema = z.object({
  deliveryId: z.string().uuid(),
  envelope: z.string().min(1).max(4096)
}).strict();

export function createNotificationDeliveryHandler({
  notificationEnvelope,
  notificationService,
  identityRepository,
  now = () => new Date()
}) {
  if (!notificationEnvelope?.open) throw new Error("Notification envelope is required");
  if (!notificationService?.sendEmailVerification || !notificationService?.sendPasswordReset) {
    throw new Error("Notification service is required");
  }
  if (!identityRepository?.isOneTimeTokenActive) throw new Error("Identity repository is required");

  return async function deliverNotification(job) {
    let jobPayload;
    let payload;
    try {
      jobPayload = jobPayloadSchema.parse(job.payload);
      payload = notificationEnvelope.open(jobPayload.envelope);
    } catch (error) {
      if (error instanceof NotificationEnvelopeError || error instanceof z.ZodError) {
        throw new JobExecutionError("notification_payload_invalid", { retryable: false });
      }
      throw error;
    }

    if (new Date(payload.expiresAt).getTime() <= now().getTime()) {
      throw new JobExecutionError("notification_token_expired", { retryable: false });
    }

    const active = await identityRepository.isOneTimeTokenActive({
      kind: payload.kind,
      userId: payload.userId,
      tokenHash: await hashOpaqueToken(payload.token)
    });
    if (!active) {
      throw new JobExecutionError("notification_token_superseded", { retryable: false });
    }

    try {
      const method = payload.kind === "email_verification"
        ? "sendEmailVerification"
        : "sendPasswordReset";
      const result = await notificationService[method](payload);
      if (result?.accepted !== true) {
        throw new JobExecutionError("notification_rejected", { retryable: true });
      }
      return { deliveryId: jobPayload.deliveryId };
    } catch (error) {
      if (error instanceof JobExecutionError) throw error;
      throw new JobExecutionError("notification_transport_failed", { retryable: true });
    }
  };
}
