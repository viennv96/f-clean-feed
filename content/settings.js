// Shared defaults (loaded by the popup; bridge.js keeps an inline copy since
// content scripts declared in the manifest cannot import modules).
export const KINDS = [
  "sponsored", "suggested", "reels", "pymk", "groups", "stories",
  "market", "search", "rail", "birthdays", "badges", "clean",
];

export const DEFAULTS = {
  enabled: true,
  mode: "hide", // "hide" | "collapse"
  allowFriendReels: false,
  kinds: {
    sponsored: true, suggested: true, reels: true, pymk: true, groups: true, stories: false,
    market: true, search: true, rail: true, birthdays: false, badges: false, clean: false,
  },
};
