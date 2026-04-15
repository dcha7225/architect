import { loader } from "@monaco-editor/react";

let configured = false;

export function configureMonaco(): void {
  if (configured) {
    return;
  }

  configured = true;

  // VS Code webviews restrict worker script URLs via CSP. Create workers
  // from blob URLs (allowed by the worker-src policy) so Monaco's language
  // services initialise without hanging.
  (self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker() {
      const blob = new Blob(["self.onmessage = function() {}"], {
        type: "text/javascript",
      });
      return new Worker(URL.createObjectURL(blob));
    },
  };

  const vsPath = new URL("./vendor/monaco/vs", window.location.href).toString();

  loader.config({
    paths: {
      vs: vsPath,
    },
  });
}
