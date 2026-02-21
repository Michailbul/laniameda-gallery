const runAbortControllers = new Map<string, AbortController>();

export const registerRunAbortController = (runId: string, controller: AbortController) => {
  runAbortControllers.set(runId, controller);
};

export const clearRunAbortController = (runId: string) => {
  runAbortControllers.delete(runId);
};

export const cancelRunExecution = (runId: string) => {
  const controller = runAbortControllers.get(runId);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
};
