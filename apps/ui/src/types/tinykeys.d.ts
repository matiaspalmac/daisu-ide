declare module "tinykeys" {
  export type KeyBindingMap = Record<string, (event: KeyboardEvent) => void>;
  export interface KeyBindingOptions {
    event?: "keydown" | "keyup";
    capture?: boolean;
  }
  export function tinykeys(
    target: Window | HTMLElement,
    keyBindingMap: KeyBindingMap,
    options?: KeyBindingOptions,
  ): () => void;
  const _default: typeof tinykeys;
  export default _default;
}
