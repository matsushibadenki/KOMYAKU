export function createApiClient({ baseUrl, fetchImpl = fetch }) {
  return {
    async health() {
      const response = await fetchImpl(`${baseUrl}/health`);
      if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
      return response.json();
    }
  };
}
