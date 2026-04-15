import { loader } from "@monaco-editor/react";

let configured = false;

export function configureMonaco(): void {
  if (configured) {
    return;
  }

  configured = true;

  const vsPath = new URL("./vendor/monaco/vs", window.location.href).toString();

  loader.config({
    paths: {
      vs: vsPath,
    },
  });
}
