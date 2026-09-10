import { CustomCommandParamType } from "@minecraft/server"

// The parameter table: what every vanilla command on the allowlist actually
// takes, in the types Bedrock knows about.
//
// WHY THIS FILE EXISTS. /cmd used to be one command with one text parameter,
// and a Bedrock text parameter is a single token — so `/cmd kill @e[type=cow]`
// was a syntax error, and the playtest found it. Widening it to an Enum plus
// seven loose words fixed that, but it still could not complete an ARGUMENT:
// you got the command name offered and nothing after it.
//
// The reason is worth writing down, because it is what shapes this file: a
// command registration has ONE fixed parameter list. /cmd cannot be typed
// `EntitySelector` for kill and `Location BlockType` for setblock at the same
// time. Real completion therefore needs one registration PER command, which is
// what `cmd:kill`, `cmd:give` and the rest are.
//
// What that buys, and it is a lot: the GAME parses the arguments. `@e[type=…]`
// gets the engine's own selector completion, every filter it supports, and it
// is validated before a line of our code runs. Item and block names complete
// too. Nothing here parses text.
//
// The eleven types are BlockType, Boolean, EntitySelector, EntityType, Enum,
// Float, Integer, ItemType, Location, PlayerSelector and String — verified
// against the API reference, not remembered.

const P = CustomCommandParamType

/**
 * Enum value sets. These are the vocabularies the game itself offers, so
 * spelling them out here is what makes `/cmd:gamemode ` open a list of four
 * words instead of a blank.
 *
 * Where a vocabulary is enormous and changes with the game version (sounds,
 * particles, structures) the parameter stays String — a stale enum would be
 * WORSE than free text, because it would refuse a value the game accepts.
 */
export const ENUMS = {
    gamemode:   ["survival", "creative", "adventure", "spectator", "default"],
    difficulty: ["peaceful", "easy", "normal", "hard"],
    weather:    ["clear", "rain", "thunder"],
    timeset:    ["day", "noon", "sunset", "night", "midnight", "sunrise"],
    timeop:     ["set", "add", "query"],
    tagop:      ["add", "remove", "list"],
    titleop:    ["clear", "reset", "title", "subtitle", "actionbar", "times"],
    fillmode:   ["destroy", "hollow", "keep", "outline", "replace"],
    setblockmode: ["destroy", "keep", "replace"],
    clonemask:  ["replace", "masked", "filtered"],
    clonemode:  ["normal", "force", "move"],
    scanmode:   ["all", "masked"],
    rideop:     ["start_riding", "stop_riding", "evict_riders", "summon_rider", "summon_ride"],
    ridefill:   ["until_full", "if_group_fits"],
    riderule:   ["no_ride_change", "reassign_rides", "skip_riders"],
    recipeop:   ["give", "take"],
    musicop:    ["play", "queue", "stop", "volume"],
    hudvis:     ["hide", "reset"],
    hudelement: ["all", "air_bubbles", "armor", "crosshair", "health", "hotbar",
                 "horse_health", "hunger", "item_text", "paperdoll", "progress_bar",
                 "tooltips", "touch_controls", "status_effects", "vehicle_health"],
    inputperm:  ["camera", "movement"],
    permstate:  ["enabled", "disabled"],
    aimassistop: ["set", "clear"],
    // ReplaceMode. Only two values, and both are bare words — unlike the slot
    // NAMES this command also takes, which carry dots and therefore cannot be
    // an enum at all. See the replaceitem row.
    replacemode: ["destroy", "keep"],
    // Which target aim assist prefers: the CLOSEST one, or the one nearest to
    // where the crosshair already points. Microsoft's docs call this
    // AimAssistTargetMode.
    aimmode:    ["distance", "angle"],
    locateop:   ["biome", "structure"],
    xpunit:     ["levels", "points"],
    damagecause: ["anvil", "block_explosion", "campfire", "charging", "contact", "drowning",
                  "entity_attack", "entity_explosion", "fall", "falling_block", "fire",
                  "fire_tick", "fireworks", "fly_into_wall", "freezing", "lava", "lightning",
                  "magic", "magma", "none", "override", "piston", "projectile", "ram_attack",
                  "self_destruct", "sonic_boom", "soul_campfire", "stalactite", "stalagmite",
                  "starve", "suffocation", "suicide", "temperature", "thorns", "void", "wither"],
    effect: ["absorption", "bad_omen", "blindness", "conduit_power", "darkness", "fatal_poison",
             "fire_resistance", "haste", "health_boost", "hunger", "instant_damage",
             "instant_health", "invisibility", "jump_boost", "levitation", "mining_fatigue",
             "nausea", "night_vision", "poison", "regeneration", "resistance", "saturation",
             "slow_falling", "slowness", "speed", "strength", "water_breathing",
             "weakness", "wither", "village_hero", "clear"],
    enchantment: ["aqua_affinity", "bane_of_arthropods", "binding", "blast_protection",
                  "channeling", "density", "depth_strider", "efficiency", "feather_falling",
                  "fire_aspect", "fire_protection", "flame", "fortune", "frost_walker",
                  "impaling", "infinity", "knockback", "looting", "loyalty", "luck_of_the_sea",
                  "lure", "mending", "multishot", "piercing", "power", "projectile_protection",
                  "protection", "punch", "quick_charge", "respiration", "riptide", "sharpness",
                  "silk_touch", "smite", "soul_speed", "swift_sneak", "thorns", "unbreaking",
                  "vanishing", "wind_burst"]
}

// Every enum value has to be a bare identifier: the game refuses a registration
// carrying anything else, and refuses it silently.
for (const key of Object.keys(ENUMS)) {
    ENUMS[key] = ENUMS[key].filter(v => /^[a-z_0-9]+$/.test(v))
}

/**
 * How each argument turns back into command text.
 *
 * Selectors are the interesting case. The game hands back resolved `Entity[]`
 * and `Player[]`, not the text that was typed, so the selector cannot simply be
 * pasted back. Every entity gets a one-shot TAG instead, and the rebuilt line
 * targets `@e[tag=…]`.
 *
 * That is not a workaround for its own sake — it means the resolved set is
 * exactly what gets acted on, so `@e[type=cow,r=10,c=3]` picks its three cows
 * once, and the command cannot re-resolve to a different set a tick later.
 *
 * Everything else is already a value: Location is numbers, ItemType and
 * BlockType carry an id, the rest are primitives.
 */
export const SELECTOR_TYPES = new Set([P.EntitySelector, P.PlayerSelector])

/** One command's shape. `params` are in order; `optional` splits the list. */
export const COMMANDS = [
    // ---------------------------------------------------------- entities
    { name: "kill", help: "Kill entities",
      params: [["targets", P.EntitySelector, true]] },

    { name: "damage", help: "Damage entities",
      params: [["targets", P.EntitySelector], ["amount", P.Integer],
               ["cause", P.Enum, true, "damagecause"]] },

    { name: "effect", help: "Give or clear an effect",
      params: [["targets", P.EntitySelector], ["effect", P.Enum, false, "effect"],
               ["seconds", P.Integer, true], ["amplifier", P.Integer, true],
               ["hideParticles", P.Boolean, true]] },

    { name: "tag", help: "Add, remove or list entity tags",
      params: [["targets", P.EntitySelector], ["action", P.Enum, false, "tagop"],
               ["name", P.String, true]] },

    { name: "testfor", help: "Count entities matching a selector",
      params: [["targets", P.EntitySelector]] },

    { name: "ride", help: "Make entities ride other entities",
      params: [["riders", P.EntitySelector], ["action", P.Enum, false, "rideop"],
               ["ride", P.EntitySelector, true], ["fill", P.Enum, true, "ridefill"],
               ["rule", P.Enum, true, "riderule"]] },

    { name: "event", help: "Fire an entity event",
      params: [["targets", P.EntitySelector], ["event", P.String]] },

    { name: "playanimation", help: "Play an animation on entities",
      params: [["targets", P.EntitySelector], ["animation", P.String],
               ["nextState", P.String, true], ["blendTime", P.Float, true],
               ["stopExpression", P.String, true], ["controller", P.String, true]] },

    { name: "summon", help: "Summon an entity",
      params: [["entity", P.EntityType], ["position", P.Location, true],
               ["nameTag", P.String, true]] },

    // ---------------------------------------------------------- players
    { name: "give", help: "Give an item",
      params: [["players", P.PlayerSelector], ["item", P.ItemType],
               ["amount", P.Integer, true], ["data", P.Integer, true]] },

    { name: "clear", help: "Clear items from inventory",
      params: [["players", P.PlayerSelector, true], ["item", P.ItemType, true],
               ["data", P.Integer, true], ["maxCount", P.Integer, true]] },

    { name: "enchant", help: "Enchant the held item",
      params: [["players", P.PlayerSelector], ["enchantment", P.Enum, false, "enchantment"],
               ["level", P.Integer, true]] },

    { name: "gamemode", help: "Set a game mode",
      params: [["mode", P.Enum, false, "gamemode"], ["players", P.PlayerSelector, true]] },

    { name: "xp", help: "Give experience",
      params: [["amount", P.Integer], ["unit", P.Enum, false, "xpunit"],
               ["players", P.PlayerSelector, true]] },

    { name: "spawnpoint", help: "Set a player's spawn",
      params: [["players", P.PlayerSelector, true], ["position", P.Location, true]] },

    { name: "clearspawnpoint", help: "Clear a player's spawn",
      params: [["players", P.PlayerSelector, true]] },

    { name: "recipe", help: "Give or take recipes",
      params: [["action", P.Enum, false, "recipeop"], ["players", P.PlayerSelector],
               ["recipe", P.String]] },

    { name: "inputpermission", help: "Allow or deny a player's input",
      params: [["players", P.PlayerSelector], ["permission", P.Enum, false, "inputperm"],
               ["state", P.Enum, false, "permstate"]] },

    { name: "controlscheme", help: "Set a player's control scheme",
      params: [["players", P.PlayerSelector], ["scheme", P.String]] },

    { name: "hud", help: "Hide or reset HUD elements",
      params: [["players", P.PlayerSelector], ["visible", P.Enum, false, "hudvis"],
               ["element", P.Enum, true, "hudelement"]] },

    { name: "camerashake", help: "Shake a player's camera",
      params: [["players", P.PlayerSelector], ["intensity", P.Float, true],
               ["seconds", P.Float, true], ["shakeType", P.String, true]] },

    { name: "fog", help: "Push or pop a fog setting",
      params: [["players", P.PlayerSelector], ["mode", P.String],
               ["fogId", P.String, true], ["userId", P.String, true]] },

    { name: "camera", help: "Control a player's camera",
      params: [["players", P.PlayerSelector], ["rest", P.String, true],
               ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true]] },

    // Typed from Microsoft's own reference, not from guessing at the five loose
    // strings this used to be:
    //
    //   /aimassist <players: target> set [x angle] [y angle] [max distance]
    //                                    [target mode] [preset id]
    //   /aimassist <players: target> clear
    //
    // The selector comes FIRST and is MANDATORY, which nothing else in this
    // table does — everywhere else the target is either later or optional. Get
    // that order wrong and every argument lands one place off.
    //
    // Aim assist is the help Bedrock gives controller and touch players, easing
    // the crosshair toward a target. The angles are the cone it reaches
    // through, max distance how far it looks, and target mode decides whether
    // it prefers the NEAREST target or the one already closest to the
    // crosshair. A preset id names an aim-assist preset defined in a pack.
    { name: "aimassist", help: "Tune or clear a player's aim assist",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "aimassistop"],
               ["xAngle", P.Float, true], ["yAngle", P.Float, true],
               ["maxDistance", P.Float, true], ["targetMode", P.Enum, true, "aimmode"],
               ["presetId", P.String, true]] },

    // ---------------------------------------------------------- movement
    //
    // Retyped from Microsoft's reference. The row this replaced was WRONG in
    // three ways, and had been since it was written from memory:
    //
    //   * `facing` was declared a bare Location. In the real grammar `facing`
    //     is a LITERAL KEYWORD followed by a position or an entity, so the old
    //     row emitted `tp @s ~ ~10 ~ 10 20 30` — not a valid command. It could
    //     not have worked, and nothing caught it because nothing typed it.
    //   * yRot / xRot, the rotation form, were missing entirely.
    //   * checkForBlocks was missing entirely.
    //
    // /teleport has TEN overloads and a registration has one parameter list, so
    // they cannot all be offered. Bedrock ships `tp` and `teleport` as the same
    // command under two names, and this table carries both — so rather than
    // registering the same shape twice, each takes a different real overload:
    //
    //   /port  <victim> <x y z>    [yRot] [xRot] [checkForBlocks]
    //   /move  <victim> <target>   [checkForBlocks]
    //
    // Coordinates on one, an entity destination on the other. The pack's OWN
    // /a:tp already does player-to-player with rank protection, so /move is the
    // unprotected any-entity version of that, and /port is the one thing
    // neither of the others can do.
    //
    // `facing` is deliberately not offered by either. It needs a literal word
    // in the MIDDLE of the line, which buildLine's `fixed` cannot express (that
    // only emits after the command name), and it occupies the same argument
    // positions as yRot/xRot. Offering it broken is worse than not offering it.
    { name: "tp", help: "Teleport to coordinates — /port <target> <x y z> [yRot] [xRot]",
      params: [["victim", P.EntitySelector], ["destination", P.Location],
               ["yRot", P.Float, true], ["xRot", P.Float, true],
               ["checkForBlocks", P.Boolean, true]] },

    // The other half of the pair above: an ENTITY destination rather than
    // coordinates. `/teleport <victim: target> <destination: target>
    // [checkForBlocks]` is a real overload, and it is the one /port cannot
    // reach, because a registration cannot type its second parameter as both a
    // position and a selector.
    { name: "teleport", help: "Teleport one entity to another — /move <target> <destination>",
      params: [["victim", P.EntitySelector], ["destination", P.EntitySelector],
               ["checkForBlocks", P.Boolean, true]] },

    { name: "spreadplayers", help: "Scatter players around a point",
      params: [["centre", P.Location], ["spread", P.Float], ["maxRange", P.Float],
               ["targets", P.EntitySelector]] },

    // ---------------------------------------------------------- the world
    { name: "setblock", help: "Place one block",
      params: [["position", P.Location], ["block", P.BlockType],
               ["mode", P.Enum, true, "setblockmode"]] },

    { name: "fill", help: "Fill a region with a block",
      params: [["from", P.Location], ["to", P.Location], ["block", P.BlockType],
               ["mode", P.Enum, true, "fillmode"], ["replace", P.BlockType, true]] },

    { name: "clone", help: "Copy a region",
      params: [["from", P.Location], ["to", P.Location], ["destination", P.Location],
               ["maskMode", P.Enum, true, "clonemask"], ["cloneMode", P.Enum, true, "clonemode"]] },

    { name: "testforblock", help: "Test for a block",
      params: [["position", P.Location], ["block", P.BlockType]] },

    { name: "testforblocks", help: "Compare two regions",
      params: [["from", P.Location], ["to", P.Location], ["destination", P.Location],
               ["mode", P.Enum, true, "scanmode"]] },

    { name: "setworldspawn", help: "Set the world spawn",
      params: [["position", P.Location, true]] },

    { name: "locate", help: "Find a structure or biome",
      params: [["kind", P.Enum, false, "locateop"], ["name", P.String]] },

    { name: "place", help: "Place a feature or structure",
      params: [["what", P.String], ["name", P.String, true], ["position", P.Location, true]] },

    { name: "structure", help: "Save or load a structure",
      params: [["action", P.String], ["name", P.String, true],
               ["from", P.Location, true], ["to", P.Location, true]] },

    { name: "tickingarea", help: "Manage ticking areas",
      params: [["action", P.String], ["from", P.Location, true],
               ["to", P.Location, true], ["name", P.String, true]] },

    { name: "loot", help: "Drop or give loot",
      params: [["action", P.String], ["rest", P.String, true], ["rest2", P.String, true],
               ["rest3", P.String, true], ["rest4", P.String, true]] },

    // Typed from Microsoft's reference. /replaceitem has FOUR overloads:
    //
    //   replaceitem block  <x y z>  slot.container <slotId> [mode] <item> [amount] [data]
    //   replaceitem entity <target> <slotType>     <slotId> [mode] <item> [amount] [data]
    //
    // A Bedrock registration has ONE parameter list, and position two is a
    // POSITION in the block form and a TARGET in the entity form, so the two
    // cannot share one. This row is the ENTITY form — the common case, and the
    // one the name /slot implies. The block form (putting an item into a chest
    // at coordinates) would need its own command; it is not registered.
    //
    // `mode` is mandatory here even though vanilla lets you leave it out. It
    // sits BEFORE the item, so making it optional would put a mandatory
    // parameter after an optional one, which Bedrock fills positionally and
    // this pack's own test forbids. One extra word buys an explicit answer to
    // "what happens to what was already in the slot".
    //
    // slotType is a STRING, not an Enum, and it is not an oversight: every
    // value carries dots (slot.armor.head, slot.weapon.mainhand) and Bedrock
    // refuses an enum whose values are not bare identifiers — silently. The
    // filter above this table would strip all fourteen of them.
    { name: "replaceitem", help: "Put an item in an entity's slot — slotType is slot.armor.head, slot.weapon.mainhand, slot.inventory, slot.hotbar, slot.enderchest…",
      fixed: ["entity"],
      params: [["target", P.EntitySelector], ["slotType", P.String],
               ["slotId", P.Integer], ["mode", P.Enum, false, "replacemode"],
               ["item", P.ItemType], ["amount", P.Integer, true],
               ["data", P.Integer, true]] },

    // ---------------------------------------------------------- world state
    { name: "time", help: "Set or query the time",
      params: [["action", P.Enum, false, "timeop"], ["value", P.String, true]] },

    { name: "weather", help: "Set the weather",
      params: [["kind", P.Enum, false, "weather"], ["duration", P.Integer, true]] },

    { name: "difficulty", help: "Set the difficulty",
      params: [["level", P.Enum, false, "difficulty"]] },

    { name: "daylock", help: "Lock or unlock the day cycle",
      params: [["locked", P.Boolean, true]] },

    { name: "toggledownfall", help: "Toggle the weather", params: [] },

    { name: "gamerule", help: "Set a game rule",
      params: [["rule", P.String], ["value", P.String, true]] },

    { name: "mobevent", help: "Turn a mob event on or off",
      params: [["event", P.String], ["enabled", P.Boolean, true]] },

    // ---------------------------------------------------------- presentation
    //
    // `say` is deliberately NOT here. /broadcast is the same act done better:
    // it picks an audience (all or a chat channel), it writes an audit record,
    // and it reports how many people it reached. A passthrough beside it would
    // have been a second way to do one thing, with the worse one unlogged.
    { name: "tellraw", help: "Send raw JSON text",
      params: [["players", P.PlayerSelector], ["json", P.String]] },

    { name: "title", help: "Show a title",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["text", P.String, true], ["more", P.String, true],
               ["more2", P.String, true], ["more3", P.String, true]] },

    { name: "titleraw", help: "Show a raw JSON title",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["json", P.String, true]] },

    { name: "playsound", help: "Play a sound",
      params: [["sound", P.String], ["players", P.PlayerSelector, true],
               ["position", P.Location, true], ["volume", P.Float, true],
               ["pitch", P.Float, true], ["minVolume", P.Float, true]] },

    { name: "stopsound", help: "Stop a sound",
      params: [["players", P.PlayerSelector], ["sound", P.String, true]] },

    { name: "music", help: "Control background music",
      params: [["action", P.Enum, false, "musicop"], ["track", P.String, true],
               ["volume", P.Float, true], ["fadeSeconds", P.Float, true],
               ["repeatMode", P.String, true]] },

    { name: "particle", help: "Spawn a particle",
      params: [["effect", P.String], ["position", P.Location, true]] },

    { name: "dialogue", help: "Open or change an NPC dialogue",
      params: [["action", P.String], ["npc", P.EntitySelector, true],
               ["players", P.PlayerSelector, true], ["scene", P.String, true]] },

    // ---------------------------------------------------------- scoreboard
    { name: "scoreboard", help: "Objectives and scores",
      params: [["rest", P.String], ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true],
               ["rest6", P.String, true], ["rest7", P.String, true]] }
].filter(spec => !spec.skip)

/**
 * What each vanilla command is actually CALLED in this pack.
 *
 * These replaced the `z` prefix in 2.1.15. The prefix was a sorting hack — it
 * pushed all 56 below the pack's own commands in the alphabetical in-game list
 * — and it cost every single one of them a leading letter that meant nothing.
 * `/a:zfill` reads as a typo. Sorting is a weaker reason to disfigure 56 names
 * than legibility is to keep them clean, and the standing decision in
 * CLAUDE.md was already "bare command names" — the prefix was the thing out of
 * step, not this.
 *
 * The rule, from the user: readable at a glance, and shortened only where
 * shortening leaves something a person can still read. `/gm` works as an
 * abbreviation because everybody already types it in Minecraft; `/fl` would
 * not, because nobody does. So:
 *
 *   * a long name gets the shortening people already use out loud — camera to
 *     cam, difficulty to diff, damage to dmg, music to mus.
 *   * a name that cannot be shortened without turning into initials gets a
 *     real WORD instead, taken from what the command does. `testfor` counts
 *     entities, so it is `count`. `camerashake` shakes the camera, so it is
 *     `shake`. `replaceitem` writes an item into a slot, so it is `slot`.
 *
 * **EVERY ONE of the 56 is renamed, and that is the important part.** The first
 * pass left 27 of them on their vanilla name — kill, give, fill, tag, time —
 * on the reasoning that those were already short enough to leave alone. That
 * was wrong, and the pack's own verifier had the answer written down:
 *
 *     a custom command registers namespaced, and the bare form only reaches
 *     the player if nothing else claims it
 *
 * So `/kill` never reaches `/a:kill` — it reaches the GAME's kill, and the
 * pack's version is only available at the full `/a:kill`, colon and all. That
 * is slower to type, and worse than slow: the people this whole command set
 * exists for hold a rank and NO operator, and vanilla's kill refuses them. A
 * colliding name is not merely inconvenient for them, it is unreachable by the
 * short path.
 *
 * A name vanilla does not own is therefore not a nicety. It is the difference
 * between `/slay @e[type=cow]` and `/a:kill @e[type=cow]` for somebody who
 * cannot use `/kill` at all. Every name below is checked against the game's own
 * command list by `tests/vanillacmds.test.js`, and adding one that collides
 * fails the suite.
 *
 * NOT keyed to permissions. `commandNode()` builds `cmd.<vanilla name>` from
 * the command text at run time, so a rank that holds `cmd.fill` is unaffected
 * by what the registration is called. Renaming here is purely cosmetic, which
 * is why it was safe to do in one pass.
 */
export const CODENAME = new Map([
    // Shortenings people already say out loud.
    ["damage", "dmg"],
    ["effect", "eff"],
    ["enchant", "ench"],
    ["camera", "cam"],
    ["aimassist", "aim"],
    ["difficulty", "diff"],
    ["structure", "struct"],
    ["playanimation", "anim"],
    ["spreadplayers", "spread"],
    ["inputpermission", "input"],
    ["controlscheme", "controls"],
    ["tickingarea", "ticking"],
    ["dialogue", "dialog"],
    ["music", "mus"],
    ["xp", "exp"],
    ["hud", "overlay"],
    // Bedrock ships `tp` and `teleport` as the same command under two names,
    // and this table carries both, so both need one. Splitting them into a
    // `/bring` and a `/goto` was considered and dropped: those read beautifully
    // for a player target and cannot express `~ ~10 ~` at all, which is most of
    // what teleport is actually for. So they keep vanilla's own shape — one
    // short, one long — and `move` is the long one because it reads as a
    // sentence with any destination: `/move @p ~ ~10 ~`, `/move @s @e[c=1]`.
    ["teleport", "move"],
    ["particle", "fx"],

    // Real words, because the vanilla name is already as short as it goes and
    // taking it would mean the bare form reaches the GAME's command instead of
    // this one. These are the 27 that the first pass wrongly left alone.
    ["kill", "slay"],
    ["give", "gift"],
    ["clear", "wipe"],
    ["fill", "region"],
    ["clone", "copy"],
    ["locate", "find"],
    ["loot", "drops"],
    ["time", "clock"],
    ["weather", "sky"],
    ["tag", "label"],
    ["ride", "mount"],
    ["event", "trigger"],
    ["summon", "sum"],
    ["recipe", "unlock"],       // recipe give/take is unlocking and relocking
    ["place", "feature"],       // it places features, jigsaws and structures
    ["fog", "mist"],
    ["daylock", "lockday"],     // same two words, the other way round
    ["mobevent", "mobs"],
    ["tellraw", "rawtell"],
    ["title", "showtitle"],
    ["titleraw", "rawtitle"],

    // Real words, because the vanilla name is either a mouthful or a lie
    // about what the command does.
    ["testfor", "count"],           // it counts entities; the help says so
    ["camerashake", "shake"],
    ["setblock", "block"],
    ["replaceitem", "slot"],        // writes an item INTO a slot
    ["toggledownfall", "rain"],
    ["gamerule", "rule"],
    ["playsound", "sound"],
    ["stopsound", "soundoff"],      // pairs with sound, reads as its opposite
    ["scoreboard", "score"],
    ["testforblock", "checkblock"],
    ["testforblocks", "checkarea"],
    ["spawnpoint", "setspawn"],
    ["clearspawnpoint", "unspawn"], // pairs with setspawn
    ["setworldspawn", "worldspawn"],

    // Two names that could not just be taken.
    //
    // `gamemode` would sit next to this pack's own `/a:gm`, which does the
    // same job through the script API and is the one to reach for. `gmode`
    // keeps the vanilla passthrough available without the two reading as the
    // same command with a typo between them.
    ["gamemode", "gmode"],
    // The pack already owns `/a:tp` (admin teleport, player to player), so
    // vanilla's cannot have it. Bedrock ships `tp` and `teleport` as aliases
    // of one another and this table carries both; they keep that shape here —
    // one short, one long — as `port` and `tele`.
    ["tp", "port"]
])

/**
 * Command names the GAME owns, so a registration must never use one.
 *
 * A custom command is registered namespaced (`a:slay`), and Bedrock also
 * resolves the BARE form (`/slay`) — but only when nothing else claims it.
 * Anything on this list is claimed, so naming a passthrough `kill` would make
 * `/kill` reach vanilla's, leaving this pack's only at `/a:kill`.
 *
 * It is the 56 this file already describes plus the ones the pack refuses to
 * run at all (see NEVER in core/execute.js) plus the handful of vanilla
 * commands with no passthrough. Kept here rather than in the test so the
 * source of truth sits next to the names it constrains.
 */
export const GAME_OWNED = new Set([
    ...COMMANDS.map(c => c.name),
    // Refused outright by core/execute.js, but the GAME still owns the name.
    "op", "deop", "execute", "function", "scriptevent", "schedule", "kick",
    "allowlist", "whitelist", "permission", "changesetting", "reload",
    "reloadconfig", "save", "stop", "transfer", "setmaxplayers", "wsserver",
    "sendshowstoreoffer", "script", "gametest", "project",
    // Real vanilla commands this pack has no passthrough for.
    "tell", "w", "list", "me", "msg", "experience", "gametip", "help",
    "immutableworld", "ops", "querytarget", "setmaxplayers", "tickingareas",
    "worldbuilder", "wb", "alwaysday", "clearspawnpoint", "connect"
])

/** What a vanilla command is registered as. Falls through to its own name. */
export function codenameFor(name) {
    return CODENAME.get(name) ?? name
}

/**
 * Which rows have been checked against Microsoft's command reference, and when.
 *
 * **A row not in here was written from memory and has never been verified.**
 * That is not a theoretical worry. `/tp` sat in this table for its whole life
 * declaring `facing` as a bare Location, when `facing` is a literal KEYWORD in
 * the real grammar — so it emitted `tp @s ~ ~10 ~ 10 20 30`, which is not a
 * command. Nothing caught it, because every test here checked the SHAPE of a
 * row (eight parameters or fewer, mandatory before optional, enums that exist)
 * and nothing checked whether the shape was the RIGHT one.
 *
 * `/aimassist` and `/replaceitem` were worse: five and six loose `rest` strings
 * standing in for grammars nobody had read.
 *
 * The source is `learn.microsoft.com/en-us/minecraft/creator/commands/commands/
 * <name>`, plus `.../enums/<name>` for a vocabulary. Not memory, and not
 * another addon — see [[bedrock-version-sourcing]].
 *
 * Kept beside the table rather than as a field on each row so that the honest
 * count is one thing you can look at, and so an unverified row cannot quietly
 * look verified. `python tools/commands.py` renders the whole set with this
 * column filled in.
 */
export const CHECKED = new Map([
    ["aimassist", "2026-09-10"],   // was 5 loose strings; selector is FIRST and mandatory
    ["replaceitem", "2026-09-10"], // was 6 loose strings; entity form only, block form unregistered
    ["tp", "2026-09-10"],          // was emitting invalid text; now coordinates + rotation
    ["teleport", "2026-09-10"]     // now the entity-destination overload
])

