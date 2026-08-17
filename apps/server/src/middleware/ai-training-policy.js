import { AI_TRAINING_POLICIES } from "@komyaku/shared";

export function aiTrainingPolicy({ defaultPolicy }) {
  return async (context, next) => {
    await next();

    if (defaultPolicy === AI_TRAINING_POLICIES.DENY) {
      context.header("X-Robots-Tag", "noai, noimageai");
      context.header("TDM-Reservation", "1");
    }
  };
}

