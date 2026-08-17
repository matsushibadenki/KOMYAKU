export function createRuntimeState() {
  let acceptingTraffic = true;

  return Object.freeze({
    isAcceptingTraffic() {
      return acceptingTraffic;
    },
    beginShutdown() {
      acceptingTraffic = false;
    }
  });
}

