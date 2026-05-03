// Vitest stub for `*?worker` imports — Monaco's web worker constructors get
// replaced with this no-op class so the editor module can be parsed in tests
// without bundling actual workers.
export default class WorkerStub {
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
