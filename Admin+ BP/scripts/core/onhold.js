// Built, but hidden until it is ready.
//
// Server presets are on hold (2.8.6), and in 2.12.9 the user said to hide the
// "coming soon" button: "since presets won't be here, not dropping it but
// hiding" (2026-11-14). So nothing was deleted. The screen
// (features/serverPresets.js), the four presets (core/serverPresets.js), the
// presets.apply permission that ranks already hold, and /scriptevent all stay.
// This one switch decides whether a player can see any of it. Set it to true
// and every place comes back as it was:
//
//   /admin ▸ Server ▸ Server presets, and "presets" on the Server button
//   Ranks ▸ a rank ▸ Permissions ▸ Administrative ▸ Server settings ▸ server presets
//   the second permission in the Server shape ready-made set
//   the Manager template's "Server presets" tick
//   the "Preset:" line in /version, and "ideas for new presets" in Credits
//
// This file imports nothing, so core/ranks.js can read it without a loop.
export const SERVER_PRESETS_SHOWN = false
