/** Serial effect scheduling keeps scan/dispose ordering at the loader interface. */
type ModuleOperationQueue = <T>(work: () => Promise<T>) => Promise<T>;

function operationSettled(): undefined {
  return undefined;
}

export function createModuleOperationQueue(): ModuleOperationQueue {
  let tail = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(operationSettled, operationSettled);
    return result;
  };
}
