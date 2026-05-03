declare module 'chrome-remote-interface' {
  interface RuntimeEvaluateParams {
    expression: string;
    returnByValue?: boolean;
    awaitPromise?: boolean;
  }
  interface RuntimeEvaluateResult {
    result: { value?: unknown };
    exceptionDetails?: { text: string };
  }
  interface InputDispatchMouseEventParams {
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved';
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle' | 'none';
    buttons?: number;
    clickCount?: number;
  }
  interface InputDispatchKeyEventParams {
    type: 'keyDown' | 'keyUp' | 'char';
    key?: string;
    text?: string;
    code?: string;
    windowsVirtualKeyCode?: number;
  }
  interface CDPClient {
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: RuntimeEvaluateParams): Promise<RuntimeEvaluateResult>;
    };
    Page: { enable(): Promise<void> };
    DOM: { enable(): Promise<void> };
    Input: {
      dispatchMouseEvent(params: InputDispatchMouseEventParams): Promise<void>;
      dispatchKeyEvent(params: InputDispatchKeyEventParams): Promise<void>;
    };
    close(): Promise<void>;
  }
  interface CDPOptions {
    host?: string;
    port?: number;
    target?: string;
  }
  function CDP(options?: CDPOptions): Promise<CDPClient>;
  export default CDP;
}
