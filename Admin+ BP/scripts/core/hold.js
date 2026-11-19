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

/**
 * All of automod, since 2.12.14. The user, 2026-11-19: "we will be temp
 * removing automod entirely", then "just put a hold on automod and /disguise
 * since those aren't working".
 *
 * Wider than CHAT_AUTOMOD_ON_HOLD, which stays as it is: ore alerts and fast
 * breaking stop too, because installAutomod listens for nothing. The engine
 * (core/automod.js), its settings and its screens stay, and stay tested.
 * While this is true nobody sees:
 *   /admin ▸ Server ▸ Automod, and "automod" on the Server button and tile
 *   Ranks ▸ a rank ▸ Permissions ▸ Administrative ▸ Server settings ▸ automod
 *   automod in the "Moderation, full" ready-made set
 *   "automod" in Credits' list of what Admin+ does
 */
export const AUTOMOD_ON_HOLD = true

/**
 * /disguise, since 2.12.14 (built in 2.12.8). The user, 2026-11-19: "just put
 * a hold on automod and /disguise since those aren't working".
 *
 * The command is not registered, so /disguise doesn't exist in game. Joining
 * still ends a disguise left on the books (onJoin), and stray bodies are
 * still swept, so nobody stays a mob. Its switch leaves Ranks ▸ a rank ▸
 * Permissions ▸ Administrative ▸ Pranks. The engine and its 76 looks stay,
 * and tests/disguise.test.js registers the command itself to keep testing it.
 */
export const DISGUISE_ON_HOLD = true
