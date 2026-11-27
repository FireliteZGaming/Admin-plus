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
 * the places that act on them read this. Its Checks screen leaves out Chat
 * flooding.
 *
 * 3.1.0: /automod ▸ Chat (features/chatcheck.js) runs UNDER this hold, the
 * user's call, 2026-11-26 ("the official feature is in 4.0.0 but i still
 * would need to test it myself"). Test a message and Watch chat only read
 * and tell staff, so nothing is held or muted while this is true. The Chat
 * page took the hub row that was a greyed Chat screening button, and says
 * that screening and flooding are on hold.
 *
 * 3.1.4: Chat Moderation (features/chatmod.js, the user's layout) replaces
 * both: its level, "Ask the player first", and Harassment, Hate speech,
 * Sexual content, Profanity and Spam switches, with the word list inside its
 * categories and spam dropped before it's sent. It is Off until an owner
 * picks a level. THIS hold still keeps the OLD engines' paths (chat.js's
 * screen(), automod.js's flood check) shut, so the two can never both act.
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
 * The Automod SECTION, back in 3.0.1 for bot detection. The user,
 * 2026-11-20: "this would fit into automod, as a 'bot detection' and as a
 * /automod command ... the first semi-introduction to automod, an emergency
 * introduction basicly". AUTOMOD_ON_HOLD still holds the old checks (ore
 * alerts, fast breaking, chat flooding); this one says whether people see
 * Server ▸ Automod, /automod's screens, the admin.automod switch, and
 * automod in the "Moderation, full" set and in Credits. Bot detection
 * (core/botcheck.js, features/bots.js) runs whatever AUTOMOD_ON_HOLD says.
 */
export const AUTOMOD_SECTION_ON_HOLD = false

