import type { WebGameManifest } from "../manifest.js";
type Budgets = WebGameManifest["budgets"];
export function checkFileCount(count: number, budgets: Budgets): void {
  if (count > budgets.maxFileCount)
    throw new Error(
      `Game Package has ${String(count)} entries but budgets.maxFileCount is ${String(budgets.maxFileCount)}`,
    );
}
export function checkContentSize(size: number, budgets: Budgets): void {
  if (size > budgets.maxPackageBytes)
    throw new Error(
      `Game Package contains ${String(size)} bytes but budgets.maxPackageBytes is ${String(budgets.maxPackageBytes)}`,
    );
}
export function checkArchiveSize(size: number, budgets: Budgets): void {
  if (size > budgets.maxPackageBytes)
    throw new Error(
      `ZIP is ${String(size)} bytes but budgets.maxPackageBytes is ${String(budgets.maxPackageBytes)}`,
    );
}
