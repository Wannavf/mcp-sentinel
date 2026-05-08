export * from "./core/types.js";
export { hashContent, hashSchema, hashTool } from "./core/hasher.js";
export { readLockfile, validateLockfile, writeLockfile } from "./core/lockfile.js";
export {
  fetchLiveTools,
  snapshotServer,
  type LiveServerData as TransportLiveServerData,
} from "./core/transport.js";

export { filterByCompatibility, severityFromChanges } from "./diff/compatibility.js";
export {
  diffAll,
  diffServer,
  type LiveServerData as DiffLiveServerData,
} from "./diff/engine.js";
export { classifyChange, diffTool, type DiffInput } from "./diff/rules.js";

export { reportConsole, reportJson, reportMarkdown, reportSarif } from "./reporters/index.js";
