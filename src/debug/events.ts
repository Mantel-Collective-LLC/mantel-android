export const DEBUG_OPEN_EVENT = "mantel:debug-open";

export function openDebugScreen(): void {
  window.dispatchEvent(new CustomEvent(DEBUG_OPEN_EVENT));
}
