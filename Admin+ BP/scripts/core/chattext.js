import { has } from "./ranks.js"
import { stripCodes } from "./identity.js"

// Colour codes in what players type. With no rule, anyone could type § codes to
// dress a message up as something else, such as a fake rank tag or a fake
// system line. A tester wrote "[VOID START]" in purple brackets that way
// (game log, 2026-11-12). Since 2.10.1, typed codes need the "Colour codes in
// chat" permission. Without it the codes are taken out and the words stay.
// Owners, operators and the shipped staff ranks have it.

export const CHAT_CODES = "chat.codes"

/** What `player` typed, as it may appear in chat. */
export function chatText(player, text) {
    const raw = String(text ?? "")
    return has(player, CHAT_CODES) ? raw : stripCodes(raw)
}
