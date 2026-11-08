export type BackState = { subScreen: boolean; tab: "connect" | "locations" | "support" | "settings" };
export type BackAction = "close-sub-screen" | "show-connect" | null;

export function resolveBack(state: BackState): BackAction {
  if (state.subScreen) return "close-sub-screen";
  if (state.tab !== "connect") return "show-connect";
  return null;
}
