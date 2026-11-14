// What is ON HOLD: built, kept and tested, but off in every world whatever
// its settings say, until the user brings it back. Each hold is one line here,
// so bringing something back is one line too.

/**
 * Chat automod, since 2.9.2. The user, 2026-11-12: "putting automod for chat
 * in a complete hold, so disabling it and graying out the button to
 * inactive".
 *
 * Both chat parts stop: chat screening holds nothing, and chat flooding warns
 * and mutes nobody. Ore alerts and fast breaking carry on. The engines
 * (core/chatfilter.js, core/automod.js) are untouched and still tested; only
 * the places that act on them read this. Server ▸ Automod shows Chat
 * screening greyed out, and its Checks screen leaves out Chat flooding.
 */
export const CHAT_AUTOMOD_ON_HOLD = true

/**
 * Server presets, since 2.12.9. On hold since 2.8.6 (the screen asks for
 * ideas on the Discord); the user, 2026-11-14, on its "coming soon" button:
 * "since presets won't be here, not dropping it but hiding".
 *
 * Nothing was deleted. The screen (features/serverPresets.js), the four
 * presets (core/serverPresets.js), the presets.apply permission that ranks
 * already hold, and /scriptevent all stay. While this is true nobody sees:
 *   /admin ▸ Server ▸ Server presets, and "presets" on the Server button
 *   Ranks ▸ a rank ▸ Permissions ▸ Administrative ▸ Server settings ▸ server presets
 *   the second permission in the Server shape ready-made set
 *   the Manager template's "Server presets" tick
 *   the "Preset:" line in /version, and "ideas for new presets" in Credits
 */
export const SERVER_PRESETS_ON_HOLD = true
