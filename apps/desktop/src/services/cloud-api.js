import { createApiClient } from "@komyaku/api-client";

export const cloudApiBaseUrl = import.meta.env.VITE_KOMYAKU_API_BASE_URL
  ?? "http://127.0.0.1:3000/api/v1";

export const cloudApiClient = createApiClient({ baseUrl: cloudApiBaseUrl });
