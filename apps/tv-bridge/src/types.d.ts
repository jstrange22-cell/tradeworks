/**
 * Minimal type shim for chrome-remote-interface. Upstream ships no .d.ts.
 * We only use Runtime.evaluate + close, so a thin surface is sufficient.
 */
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
  interface CDPClient {
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: RuntimeEvaluateParams): Promise<RuntimeEvaluateResult>;
    };
    Page: { enable(): Promise<void> };
    DOM: { enable(): Promise<void> };
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
