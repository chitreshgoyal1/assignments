// Point @monaco-editor/react at the locally-installed monaco-editor package
// instead of the default CDN loader (cdn.jsdelivr.net). The user explicitly
// wanted Monaco bundled as a library so subsequent demos / offline sessions
// don't re-download ~3 MB every time. Vite's ?worker imports produce
// separate worker chunks at build time; they're only loaded when this
// setup runs, which itself is lazy-imported from DiffViewer.
//
// Safe to call multiple times — guarded by `configured`.
//
// References:
//   https://github.com/suren-atoyan/monaco-react#using-local-monaco-package
//   https://vitejs.dev/guide/features.html#web-workers

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker   from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker    from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker   from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker     from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let configured = false;

export default function setupMonaco() {
  if (configured) return;

  // Monaco discovers language workers via `self.MonacoEnvironment.getWorker`.
  // Each ?worker import gives us a Worker constructor that Vite bundled.
  self.MonacoEnvironment = {
    getWorker(_, label) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };

  loader.config({ monaco });
  configured = true;
}
