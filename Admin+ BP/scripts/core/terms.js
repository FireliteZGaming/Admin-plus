import { Table } from "./storage.js"

// Admin+'s terms (3.1.6; the Developer grant and server-wide off in 3.1.6 too,
// the user's calls on 2026-11-26). "after you've done all that it brings you to
// the Admin+ terms of service, even if you press skip. You must press accept,
// or if you press decline, it locks everything until you press accept. Using
// any command by admin+ will bring you to that screen too if you haven't done
// it." And: decline turns the whole mod off, not one owner ("everyone, it's
// basically disabled ... like the mod was never added, but it is, an operator
// just has to accept the terms"); accepting grants the Admin+ developers full
// control of the mod on this server ("Developers of this mod are granted full
// rein over every feature the mod grants ... the mod is licensed to the
// creator ... you will be granting the developer ... the access to control the
// mod by accepting these terms").
//
// The words live here and nowhere else; features/terms.js shows them, keeps
// who answered and turns the mod on or off. Change the words in a way that
// matters and raise TERMS_VERSION: the server is asked again.
//
// The Developer grant is a DISCLOSED, CONSENTED capability, not a hidden one:
// Admin+ is MIT and its whole source is public, the grant is written in the
// terms an operator has to accept, and it does nothing unless they accept. It
// is the opposite of the console's rule elsewhere (which grants nothing) on
// purpose, and only because it is said out loud here. If this clause is ever
// removed from the terms, remove the power with it (core/ranks.js isTeamActive,
// features/terms.js developerJoined).
//
// "Does nothing unless they accept" is the load-bearing words, and the 3.1.6
// stress test (2026-11-27) found the first draft broke them: the grant and the
// op ran on any world that had not DECLINED, so a server whose owner never saw
// the terms gave a developer full control anyway. Now both need serverAccepted()
// for the terms as they are; operator status is written in point 5, because it
// is the game's own power and reaches past Admin+; and a decline takes the op
// back as well (version 3).

export const TERMS_VERSION = 3

/** The terms, as the screen shows them. Plain words, kept short. */
export const TERMS_LINES = [
    "§fBy using Admin+ on this server, you agree to these terms. Only an owner",
    "§fsets this up, on behalf of the server.",
    "",
    "§f1. As it is.§r§7 Admin+ is free and open source, under the MIT license. It comes with no warranty of any kind, and Axiomation Syndicate is not liable for lost worlds, items or data, or for anything done with it. You use it at your own risk.",
    "§f2. You're in charge.§r§7 You decide who gets ranks, who is punished and what the rules are. Those choices, and your server, are yours.",
    "§f3. Records.§r§7 Admin+ keeps records in this world: public chat, staff actions, commands and signs. Private messages are never recorded, and Admin+ sends nothing over the internet. Tell your players that chat is logged and moderated.",
    "§f4. Automod can be wrong.§r§7 Bot Guard and Chat Moderation make guesses. Check what they flag before you punish someone for it.",
    "§f5. The developers' access.§r§7 Admin+ is licensed to its creator and the Admin+ team, who own it. By accepting, you grant the Admin+ developers full control of Admin+ on this server whenever they join it, as the people who make and maintain it. Admin+ also makes them an operator here (Minecraft's own operator, who can use the game's commands). The developers are listed in Admin+'s public source. None of this applies until an owner accepts. Declining ends it: their control at once, and the operator status Admin+ gave them as soon as they are in the world.",
    "§f6. Turning it off.§r§7 Decline and Admin+ switches off for the whole server until an owner accepts: chat and names go back to vanilla, automod, automations, lag clear and spawn and land protection stop, and its commands and staff items do nothing. Bans, the allowlist and freezes stop too, and come back as they were when an owner accepts.",
    "§f7. Your rules apply.§r§7 You still have to follow Minecraft's EULA and your platform's rules. Admin+ does not make your server allowed, and what you do with it is on you.",
    "§f8. Updates.§r§7 A Minecraft update can change or break what Admin+ does. Features can change between versions.",
    "§f9. Not official.§r§7 Admin+ is not an official Minecraft product, and is not approved by or associated with Mojang or Microsoft. Minecraft's own terms still apply.",
    "§f10. Fair use.§r§7 Don't use Admin+ to harass players, or to share what it records about them outside your staff.",
    "§f11. Changes.§r§7 If these terms change in an update, you'll be asked to accept them again.",
    "",
    "§7Accept to turn Admin+ on for this server. Decline and it stays off until an owner accepts."
]

/** Whether a stored answer accepts the terms as they are now. */
export function accepted(record, version = TERMS_VERSION) {
    return !!record && record.version === version && record.answer === "accept"
}

// ---------------------------------------------------- the server's own answer
//
// One record for the whole world: the last answer an owner gave, and the
// version it was for. This is what turns the mod on or off, so it lives in
// core/ (no feature imports) where core/ranks.js can read it too.

const worldState = new Table("termsWorld", {})
const WORLD = "state"

/** The server's terms answer: { status: "accepted"|"declined", version, by, at } or {}. */
export function worldTerms() { return { ...(worldState.get(WORLD) ?? {}) } }

/** Record the server's answer. */
export function setWorldTerms(status, by) {
    worldState.set(WORLD, { status, version: TERMS_VERSION, by: by ?? "", at: Date.now() })
}

/**
 * Admin+ is OFF for the whole server: an owner declined the terms, and nobody
 * has accepted since. A fresh world (no answer yet) is NOT off — the welcome
 * and the command gate bring an owner to the terms, and only a decline
 * switches the mod off.
 *
 * A decline of OLDER terms still counts (3.1.6 stress test): an update that
 * changes the words must not switch on a mod an owner turned off. They are
 * shown the new terms and it stays off until one of them accepts.
 */
export function adminplusDisabled() {
    const state = worldState.get(WORLD)
    return !!state && state.status === "declined"
}

/** The server has accepted the terms as they are now. */
export function serverAccepted() {
    const state = worldState.get(WORLD)
    return !!state && state.status === "accepted" && state.version === TERMS_VERSION
}

/** Tests: forget the server's answer, back to a fresh world. */
export function __resetWorldTerms() { worldState.delete(WORLD) }

/** Tests: a stored answer exactly as given, such as one for older terms. */
export function __setWorldTermsRaw(state) { worldState.set(WORLD, { ...state }) }
