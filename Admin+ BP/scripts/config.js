// Admin+ — single tunable config. Everything an operator would want to change
// lives here; runtime state (ranks, warps, bans) lives in world storage.

export const ADMINPLUS_VERSION = "1.8.0"

export const CONFIG = {
    // Command namespace. Registration is always namespaced (/<ns>:<name>) —
    // Bedrock rejects a bare registration — but the game resolves the BARE name
    // at the keyboard whenever nothing else claims it. So with ns "a":
    //   a:admin -> /admin          (nothing owns it: bare form works)
    //   a:warp  -> /warp           likewise /home /sethome /tpa /back /spawn
    //   a:tp    -> /a:tp           vanilla owns /tp, so the short form is typed
    // Keep this short: it is what you type whenever vanilla owns the name.
    ns: "a",

    // Names that ALWAYS resolve to full permissions ("*"), regardless of ranks
    // or op status. Your safety net if a rank edit locks everyone out.
    owners: [],

    // Treat Bedrock operators (commandPermissionLevel >= GameDirectors) as staff.
    opIsStaff: true,

    brand: {
        prefix: "§8[§bAdmin§d+§8]§r ",
        accent: "§b",
        ok: "§a",
        err: "§c",
        info: "§7"
    },

    // Feature switches — turning one off unregisters its commands entirely.
    features: {
        ranks: true,
        moderation: true,
        tools: true,
        warps: true,
        tpa: true,
        logs: true
    },

    limits: {
        nameMaxLength: 24,       // warp / rank id length cap
        logEntries: 300          // rolling audit log size
    },

    teleport: {
        warmupTicks: 40,         // 2s countdown before warp/home/tpa/back fires
        cancelOnMove: true,      // moving during the countdown aborts it
        cooldownTicks: 60,       // per-player cooldown between teleports
        staffInstant: true       // staff skip warmup + cooldown
    },

    tpa: {
        expireSeconds: 60,
        useForm: true            // show an accept/deny form to the target
    },

    ranks: {
        // Rank display on the floating nametag above players.
        showOnNameTag: true,
        // Chat formatting needs world.beforeEvents.chatSend, which is a BETA
        // API. On the stable runtime this silently stays off (guarded at
        // subscribe time) — nametags still work. Layout lives in < Code >.
        showInChat: true,
        // Tag written on the player for a held rank: "<tagPrefix><rankId>".
        tagPrefix: "rank:"
    }
}

export const NS = CONFIG.ns
