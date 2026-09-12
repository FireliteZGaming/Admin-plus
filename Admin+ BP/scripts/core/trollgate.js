import { flag } from "./settings.js"
import { has } from "./ranks.js"

// One answer to "may this person use a troll tool", for everything that is one.
//
// There are TWO switches and they ask different questions, which is why neither
// alone is the gate:
//
//   feature.troll   the OWNER's decision that this world has troll tools at
//                   all. Ships FALSE. A pack that arrives with them live hands
//                   a new owner a way to annoy people before they have decided
//                   they want one.
//   admin.troll     the LADDER's decision about who, among staff, gets them.
//                   It sits in Settings ▸ Ranks under Staff tools, where it
//                   shows as `troll`.
//
// This exists because the three things that are troll tools had drifted apart.
// `/smite` checked both. The **Knockback stick checked `admin.staffmode`** —
// so every staff member got it whatever the ladder said, and turning the whole
// section off did not take it away. The Orbital Strike checked both plus its
// own two locks. Three tools, three answers, one question.
//
// Worse, the stick checked `admin.staffmode` in TWO places — when the chest was
// drawn and again when it was swung — and fixing one and not the other would
// have handed somebody an item that did nothing when they hit with it.

/** May this player use troll tools here? Both switches, always. */
export function trollAllowed(player) {
    return flag("feature.troll") && has(player, "admin.troll")
}

/**
 * Which switch is shut, phrased for the person who just tried to use one.
 *
 * The owner's switch and the ladder's need different sentences: one is
 * "nobody here can", which an owner fixes in Settings, and the other is "you
 * cannot", which only somebody who can edit ranks fixes.
 */
export function trollBlockedBy(player) {
    if (!flag("feature.troll")) {
        return "Troll commands are switched off. An owner turns them on in Settings ▸ Troll commands."
    }
    if (!has(player, "admin.troll")) {
        return "Your rank doesn't hold troll tools. Settings ▸ Ranks ▸ Staff tools ▸ troll."
    }
    return undefined
}
