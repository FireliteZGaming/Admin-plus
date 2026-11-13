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
