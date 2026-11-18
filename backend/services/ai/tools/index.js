/**
 * The AI tool catalogue and the shared registry instance.
 *
 * Adding an intent to the assistant without adding a tool here is impossible:
 * the registry is the only execution path, and it is default-deny.
 */

import { createToolRegistry } from "../registry.js";
import { adminInventoryTools } from "./admin/inventory.js";
import { adminOrderTools } from "./admin/orders.js";
import { adminSnapshotTools } from "./admin/snapshot.js";
import { adminTrendTools } from "./admin/trends.js";
import { customerTools } from "./customer/index.js";

/** Every tool the assistant may call, in one reviewable list. */
export const AI_TOOLS = Object.freeze([
  ...adminSnapshotTools,
  ...adminTrendTools,
  ...adminInventoryTools,
  ...adminOrderTools,
  ...customerTools,
]);

export const aiRegistry = createToolRegistry(AI_TOOLS);

export { createToolRegistry };
export { PERIODS, detectPeriod } from "./customer/periods.js";