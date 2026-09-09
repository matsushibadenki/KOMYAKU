export function createLocalMutationGate(onBusy) {
  let busy = false;
  return Object.freeze({
    get busy() { return busy; },
    async run(operation) {
      if (busy) return false;
      busy = true;
      try {
        onBusy(true);
        return await operation();
      } finally {
        busy = false;
        onBusy(false);
      }
    }
  });
}
