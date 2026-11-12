// The Deck project a folder belongs to: one of whose folders it is (a multi-root project's other
// folders too). On a Deck without multi-root projects, matched by the main folder as before.
import { workspaceByCwd, workspaceHolding } from "../shim/terminals.js";

export const projectOf = (dir: string) => {
  try { return workspaceHolding(dir); } catch { return workspaceByCwd(dir); }
};
