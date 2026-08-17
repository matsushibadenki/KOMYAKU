import { readBearerToken } from "../security/session-tokens.js";

export function sessionAuth({ identityService }) {
  if (!identityService?.authenticateToken) throw new Error("Identity service is required");

  return async function authenticateSession(context, next) {
    const token = readBearerToken(context.req.header("Authorization"));
    const identity = token ? await identityService.authenticateToken(token) : null;
    if (!identity) {
      context.header("WWW-Authenticate", "Bearer");
      context.header("Cache-Control", "no-store");
      return context.json({ error: "unauthorized" }, 401);
    }
    context.set("identity", identity);
    await next();
  };
}

export function workspaceConversationImportAuthorizer(identityRepository) {
  if (!identityRepository?.canImportConversations) {
    throw new Error("Identity repository authorization query is required");
  }
  return ({ workspaceId, actorId, action }) => {
    if (action !== "conversation:import") return false;
    return identityRepository.canImportConversations({ workspaceId, userId: actorId });
  };
}
