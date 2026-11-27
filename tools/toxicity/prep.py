"""Build the toxicity training data from the public sets.

    python -I tools/toxicity/prep.py C:/Users/gabri/Datasets/admin-plus-toxicity

Writes prepared/{train,val,test}.jsonl under that folder, one message per line:
    {"id": ..., "s": source, "t": text, "y": [toxic, discrimination, sexual,
     hostility, profanity] (each 0..1, or null when the source does not say),
     "w": weight}

Run with -I so nothing loads from the data folder; the user's own packages
are added back by hand. Never point this at the private chat archive: it has
no labels, and other players wrote it, so it stays out of these files.

Sources and why (research notes, Obsidian > Admin+ > Research):
  1. Civil Comments (CC0): soft labels, the share of annotators who said yes.
     Only comments of 256 characters or fewer, because chat is short and a
     cut-off comment keeps its label but loses the words that earned it.
  2. Measuring Hate Speech (CC BY 4.0): discrimination, with many comments
     that mention a group WITHOUT attacking it, which is what keeps a model
     from flagging "I'm gay".
  3. HateXplain (MIT): hate and offensive posts.
  4. Templates written here: game violence that is not a threat ("kill the
     wither"), swearing at the game, neutral and hateful lines for the same
     identity words, so a word alone never decides. Since 2026-11-26 also
     game chat written many ways each (4b): slang self-harm orders, swearing
     at the lag, mild trash talk, and violent-sounding game talk.
Davidson (MIT) is left out: its "offensive" class over-labels African-American
English (Sap et al. 2019), the bias a moderation model must not learn.
"""
import hashlib
import json
import random
import re
import site
import sys
from pathlib import Path

sys.path.append(site.getusersitepackages())
import numpy as np
import pandas as pd

LABELS = ["toxic", "discrimination", "sexual", "hostility", "profanity"]
MAX_CHARS = 256
CLEAN_KEEP = 0.4          # share of clearly clean Civil Comments kept
SEED = 20261126

base = Path(sys.argv[1])
out_dir = base / "prepared"
out_dir.mkdir(exist_ok=True)
rng = random.Random(SEED)


def bucket(key):
    """0-7 train, 8 val, 9 test, fixed by the id so reruns agree."""
    return hashlib.md5(str(key).encode("utf-8")).digest()[0] % 10


def split_of(key):
    b = bucket(key)
    return "train" if b < 8 else ("val" if b == 8 else "test")


rows = {"train": [], "val": [], "test": []}


def add(split, rid, source, text, y, w=1.0):
    rows[split].append({"id": rid, "s": source, "t": text,
                        "y": [None if v is None else round(float(v), 4) for v in y],
                        "w": round(float(w), 4)})


# 1. Civil Comments -----------------------------------------------------------
cc_cols = ["toxicity", "identity_attack", "sexual_explicit", "insult", "threat", "obscene"]
for f in sorted((base / "civil_comments").glob("*.parquet")):
    split = "train" if f.name.startswith("train") else ("val" if f.name.startswith("validation") else "test")
    df = pd.read_parquet(f, columns=["text"] + cc_cols)
    df = df[df["text"].str.len() <= MAX_CHARS]
    y = np.stack([df["toxicity"], df["identity_attack"], df["sexual_explicit"],
                  np.maximum(df["insult"], df["threat"]), df["obscene"]], axis=1)
    clean = y.max(axis=1) < 0.1
    keep = np.ones(len(df), dtype=bool)
    weight = np.ones(len(df))
    if split == "train":
        draw = np.random.default_rng(SEED).random(len(df))
        keep = ~clean | (draw < CLEAN_KEEP)
        weight[clean] = 1 / CLEAN_KEEP     # keeps the real share of clean comments
    for i, (text, yy, w) in enumerate(zip(df["text"][keep], y[keep], weight[keep])):
        add(split, f"cc-{f.stem}-{i}", "cc", text, yy, w)
    print(f"Civil Comments {f.name}: {keep.sum():,} kept of {len(df):,} short ones")

# 2. Measuring Hate Speech ------------------------------------------------------
mhs = pd.read_parquet(next((base / "measuring_hate_speech").glob("*.parquet")),
                      columns=["comment_id", "text", "respect", "hatespeech"])
agg = mhs.groupby("comment_id").agg(text=("text", "first"),
                                     toxic=("respect", lambda s: (s >= 3).mean()),
                                     disc=("hatespeech", lambda s: (s == 2).mean()))
agg = agg[agg["text"].str.len() <= MAX_CHARS]
for cid, r in agg.iterrows():
    add(split_of(f"mhs-{cid}"), f"mhs-{cid}", "mhs", r["text"], [r["toxic"], r["disc"], None, None, None])
print(f"Measuring Hate Speech: {len(agg):,} comments")

# 3. HateXplain ----------------------------------------------------------------
hx = json.loads((base / "hatexplain" / "dataset.json").read_text(encoding="utf-8"))
n = 0
for pid, p in hx.items():
    words = [t for t in p["post_tokens"] if not (t.startswith("<") and t.endswith(">"))]
    text = " ".join(words)
    if not text or len(text) > MAX_CHARS:
        continue
    labels = [a["label"] for a in p["annotators"]]
    toxic = sum(l != "normal" for l in labels) / len(labels)
    hate = sum(l == "hatespeech" for l in labels) / len(labels)
    add(split_of(f"hx-{pid}"), f"hx-{pid}", "hx", text, [toxic, hate, None, None, None])
    n += 1
print(f"HateXplain: {n:,} posts")

# 4. Templates -----------------------------------------------------------------
# PURPOSE: these lines exist to be CAUGHT. Admin+'s chat filter is there to stop
# players saying the hateful ones, and it can only learn that from examples, the
# way AI safety classifiers are trained. The friendly lines teach it what to
# leave alone. Training and test data only; nothing here is shown to a player.
MOBS = ["zombie", "creeper", "skeleton", "spider", "enderman", "wither", "ender dragon",
        "warden", "pillager", "ghast", "blaze", "slime", "phantom", "drowned", "witch",
        "piglin", "hoglin", "ravager", "evoker", "guardian", "shulker", "vex", "dragon"]
GROUPS = ["gay", "lesbian", "bi", "bisexual", "trans", "transgender", "queer", "lgbt",
          "black", "white", "asian", "mexican", "latino", "hispanic", "african", "arab",
          "indian", "chinese", "japanese", "korean", "jewish", "muslim", "christian",
          "catholic", "hindu", "sikh", "buddhist", "atheist", "disabled", "autistic",
          "deaf", "blind", "immigrant", "female", "nonbinary", "british", "american",
          "russian", "german", "french", "polish", "filipino", "brazilian", "irish"]
Z = [0, 0, 0, 0, 0]
#        toxic disc sexual hostility profanity
TEMPLATES = [
    # Game violence and dying: never a threat.
    ("kill the {mob}", MOBS, Z), ("i killed the {mob}", MOBS, Z),
    ("the {mob} killed me", MOBS, Z), ("help me kill the {mob}", MOBS, Z),
    ("a {mob} killed me lol", MOBS, Z), ("die {mob}", MOBS, Z),
    ("we need to kill the {mob} first", MOBS, Z), ("this {mob} keeps killing me", MOBS, Z),
    ("i hate {mob}s", MOBS, Z), ("stupid {mob}", MOBS, [0.1, 0, 0, 0, 0]),
    ("lets go fight the {mob}", MOBS, Z), ("shoot the {mob} with your bow", MOBS, Z),
    ("{mob} farm is done", MOBS, Z), ("watch out for the {mob}", MOBS, Z),
    ("{x}", ["pvp me", "1v1 me", "come fight me", "i'll get you next time", "gg",
             "good game", "nice kill", "you got me", "rip", "i died", "im dead",
             "you're dead lol", "i killed you", "you killed me", "stop killing me lol",
             "spawn camping", "kill him he has my stuff", "hit him with the sword",
             "i'm gonna kill you in pvp", "bet i can beat you", "rematch", "gg wp",
             "blow up the tnt", "destroy the spawner", "burn the zombies",
             "i fell in lava", "died to fall damage", "kill me so i respawn",
             "can someone kill me", "lets raid the village", "attack", "charge",
             "he's low hit him", "finish him", "i need to die to get home",
             "killing mobs for xp", "dead again", "i keep dying", "noob mistake",
             "my bad", "sorry", "lol", "lmao", "bruh", "ok", "no", "yes", "hi", "hello",
             "wanna team up", "come to my base", "where are you", "tp to me"], Z),
    # Swearing at the game or at oneself: profanity, not hostility.
    ("{x}", ["fuck this {mob}", "oh shit lava", "damn it i died", "shit i fell",
             "fuck i lost everything", "this is so fucking hard", "holy shit that was close",
             "what the fuck was that", "wtf", "omg wtf", "damn", "shit", "fuck",
             "bullshit lag", "fucking lag", "this lag is shit"], [0.2, 0, 0, 0, 1]),
    # Identity words in friendly lines.
    ("i'm {g}", GROUPS, Z), ("i am {g}", GROUPS, Z), ("my friend is {g}", GROUPS, Z),
    ("as a {g} person i love this server", GROUPS, Z), ("{g} people are welcome here", GROUPS, Z),
    ("my mom is {g}", GROUPS, Z), ("i'm {g} and i play minecraft", GROUPS, Z),
    ("there's nothing wrong with being {g}", GROUPS, Z), ("i have a {g} friend", GROUPS, Z),
    ("we have {g} players here", GROUPS, Z), ("proud to be {g}", GROUPS, Z),
    # The same words in hateful lines, so the word alone never decides.
    ("{g} people are disgusting", GROUPS, [1, 1, 0, 0.5, 0]),
    ("i hate {g} people", GROUPS, [1, 1, 0, 0.5, 0]),
    ("all {g} people should die", GROUPS, [1, 1, 0, 1, 0]),
    ("no {g} people allowed on this server", GROUPS, [0.8, 1, 0, 0.3, 0]),
    ("get out you {g} freak", GROUPS, [1, 1, 0, 1, 0]),
    # Aimed insults and self-harm orders, so game words are not all safe.
    ("{x}", ["kys", "kill yourself", "go kill yourself", "kill urself noob", "go die",
             "nobody likes you", "you're an idiot", "you suck", "shut up idiot",
             "you're so stupid", "everyone hates you", "leave the server nobody wants you",
             "you're worthless", "i hope you die", "you're a loser"], [1, 0, 0, 1, 0]),
    ("{x}", ["you're trash at this game", "ur so bad", "shut up noob", "you suck at pvp",
             "uninstall", "cry about it"], [0.5, 0, 0, 0.5, 0]),
]
t_rows = 0
for ti, (pattern, fill, y) in enumerate(TEMPLATES):
    # Whole templates go to one split, so the test lines are wordings the
    # model never saw. The "{x}" lists split line by line instead.
    for fi, item in enumerate(fill):
        if "{x}" in pattern:
            texts = [item.replace("{mob}", m) for m in MOBS] if "{mob}" in item else [item]
            key = f"tpl-{ti}-{fi}"
        else:
            texts = [pattern.replace("{mob}", item).replace("{g}", item)]
            key = f"tpl-{ti}"
        split = "test" if bucket(key) >= 8 else "train"
        for k, text in enumerate(texts):
            add(split, f"{key}-{k}-{item}", "tpl", text, y, 2.0)
            t_rows += 1
print(f"Templates: {t_rows:,} lines")

# 4b. Game chat, many ways each (2026-11-26, after 3.1.0's tests) ---------------
# The "{x}" lists above give ONE line per phrase, and the split hashes each
# phrase whole, so a phrase is either one training line among 680,000 or none:
# the three-letter self-harm order landed in test and the model scored it 0,
# while two words of swearing at the lag scored hostility 86. So each phrase
# here is written many ways (names, fillers, spelling), and the split goes
# line by line: every phrase is trained on, and its held-out wordings test it.
# Ids start "game-<group>-" so tools/toxicity/compare.mjs can read each group.
# Same PURPOSE as above: the hostile lines exist to be caught.
game_rng = random.Random(SEED + 1)     # its own draws, so section 5 is unchanged


def game_split(key):
    """Game chat goes to val as well (3.1.3): the levels are set on val, and
    with public lines alone a rare output like sexual content lost its lines
    between two runs. Train lines are the same as with train/test only."""
    b = bucket(key)
    return "train" if b < 8 else ("val" if b == 8 else "test")


NAMES = ["Steve", "Alex", "xXSniperXx", "CoolKid99", "Builder_Bob", "Nova", "Kai", "Rin", "Max", "Zed"]
GAME = {
    # Telling a player to hurt or kill themselves, or wishing them dead: severe.
    "selfharm": ([1, 0, 0, 1, 0], 12,
                 ["", "{n} ", "@{n} ", "bro ", "omg ", "just ", "go "],
                 ["", " lol", " noob", " already", " pls", " now", " bro", " fr", " idiot", "!!"],
                 ["kys", "k y s", "k.y.s", "kyss", "kys kid", "you should kys", "u should kys", "why dont you kys",
                  "kill urself", "kill yourself", "kill your self", "unalive yourself", "neck yourself",
                  "end yourself", "drink bleach", "go die", "go die in a hole", "hope you die", "hope u die",
                  "do everyone a favor and kys", "nobody would miss you if you died"]),
    # Swearing at the game, the lag or yourself, good news included: swearing only.
    "swear": ([0.2, 0, 0, 0, 1], 6,
              ["", "omg ", "bro ", "ugh ", "ok ", "oh "],
              ["", " lol", " bruh", " again", "!!", " ugh", " man"],
              ["damn lag", "damn this lag", "damn it", "dammit", "damnit", "damn", "damn i died", "damn creeper",
               "damn i fell", "damn my internet", "damn the ping", "damn nice", "damn thats cool", "damn good build",
               "damn bro", "shit lag", "shit ping", "oh shit", "holy shit", "shit i died again", "fuck lag",
               "fuck this lag", "fuck my wifi", "fuck i forgot my sword", "fucking creepers", "fucking phantoms",
               "this server is so fucking laggy", "wtf lag", "wtf was that", "what the hell", "hell yeah",
               "hell no", "crap", "oh crap", "frick", "fricking lag", "son of a bitch the creeper"]),
    # Trash talk both sides joke about: mild, so Low and Medium leave it alone.
    "taunt": ([0.3, 0, 0, 0.3, 0], 5,
              ["", "{n} ", "@{n} ", "lol "],
              ["", " lol", " gg", " xd"],
              ["ez", "ez clap", "gg ez", "get rekt", "rekt", "owned", "skill issue", "touch grass", "cope",
               "stay mad", "cry more", "take the l", "ratio", "ur bad lol", "trash lol", "you're a bot lol",
               "git gud", "too easy", "sit down", "nice try", "better luck next time", "go back to creative",
               "you play like my grandma", "imagine dying to that"]),
    # Game talk with violent-sounding words: nothing to hold.
    "gametalk": (Z, 4,
                 ["", "{n} ", "lol ", "bro "],
                 ["", " lol", " gg", "!!"],
                 ["stop kill stealing", "he kill stole my mob", "nice kill streak", "my kill count is 50",
                  "kill aura is a hack", "i got killed by a creeper", "you died to a zombie lol",
                  "ill kill the dragon for you", "headshot", "you're dead in pvp next round", "i'll destroy you in bedwars",
                  "we wiped their whole team", "time to murder some cows", "slaughter the pigs for food",
                  "i'm gonna blow up their base in the raid", "drown the endermen", "trap him in the nether portal"]),
    # PvP threats with the game named: nothing to hold. The bare threat with no
    # game in it is left to the model, because off a server it is a threat.
    "pvp": (Z, 6,
            ["", "{n} ", "@{n} ", "bro ", "lol "],
            ["", " lol", " gg", "!!", " xd", " fr"],
            ["i will kill you in pvp", "im gonna kill you in bedwars", "ill kill you next round",
             "you're dead in the arena", "im coming for you in pvp", "watch me kill you in the 1v1",
             "ill destroy you in skywars", "prepare to die in pvp", "i will end you in the duel",
             "you're going down in pvp", "im gonna wreck you in the tournament", "ill hunt you down in the hunger games",
             "ill kill you before the border closes", "you won't survive the next raid", "meet me in the pvp arena and die",
             "ill shoot you off the bridge", "im gonna knock you into the void", "first one to die loses",
             "ill get my revenge next game", "we will crush your team in bedwars"]),
    # Sexual harassment as it shows up in game chat, kept non-graphic: asking
    # a player for pictures, about their body or clothes, or to sext. Mild
    # hostility, as the labeller's codebook rates it.
    "sexual": ([1, 0, 1, 0.3, 0], 8,
               ["", "{n} ", "@{n} ", "hey ", "yo "],
               ["", " lol", " pls", " ;)", " rn", " babe"],
               ["send nudes", "send me nudes", "send pics of you", "send me a pic of you in the shower",
                "show me your body", "what are you wearing irl", "take off your clothes", "are you a girl irl send pics",
                "wanna sext", "lets sext", "i want to touch you", "come sit on my lap", "ur so hot send pics",
                "how old are you send me pics", "send me pics of your feet", "do you want to see me naked",
                "lets have sex", "wanna do it in my bed", "ill pay you for pics",
                "show me what you look like without clothes"]),
    # The same words in harmless game lines: pictures of a base, a skin, a bed
    # to skip the night.
    "sexualok": (Z, 6,
                 ["", "{n} ", "@{n} ", "hey "],
                 ["", " lol", " pls", "!!"],
                 ["send pics of your base", "send me a pic of the build", "send coords", "show me your house",
                  "what are you building", "take off your armor first", "come sit in the boat", "i want to see your farm",
                  "how old is this world", "do you want to see my base", "come to my bed its night",
                  "sleep in the bed so we skip night", "i need a bed", "nice skin", "your skin is cool",
                  "show me the redstone", "send a screenshot of the portal", "rate my build", "ill pay you in diamonds",
                  "send me the seed"]),
    # Threats against the real person, and doxxing (3.1.3): the public data
    # taught almost none of these (1 of 14 probes held, at High only).
    "threat": ([1, 0, 0, 1, 0], 10,
               ["", "{n} ", "@{n} ", "bro ", "lol "],
               ["", " lol", " fr", " irl", "!!", " watch"],
               ["i know where you live", "i will find you irl", "im going to dox you", "ill dox you",
                "ill leak your address", "i have your ip", "im gonna leak your ip", "i will swat you",
                "ill swat your house", "i hope your family dies", "ill hurt you irl", "watch your back irl",
                "i know your real name", "i know what school you go to", "send me your address or else",
                "ill come to your house", "i will find your house", "your parents will pay",
                "ill make you regret it irl", "i will track you down irl"]),
    # The same words in game talk and everyday chat: nothing to hold.
    "threatok": (Z, 5,
                 ["", "{n} ", "@{n} ", "lol "],
                 ["", " lol", "!!", " gg"],
                 ["i live in texas", "wheres your base", "whats the server ip", "my ip changed so i rejoined",
                  "i know where your base is lol", "watch your back the creeper is behind you", "my family is coming over",
                  "my mom says dinner", "send the server ip", "what are your base coords", "ill find your base in the raid",
                  "i track mobs with a compass", "im going to my house irl brb", "i have school tomorrow",
                  "my real name is a secret lol", "ill come to your base", "ill leak the seed",
                  "your parents built a nice house in the server"]),
    # From the first friend playtest (2026-11-26, 3.1.2), as kinds of line,
    # never its words: what it missed, and the swear word it wrongly held.
    "swearbare": ([0.2, 0, 0, 0, 1], 6,
                  ["", "oh ", "omg ", "ugh ", "bro "],
                  ["", "!!", " lol", " man", "..."],
                  ["fuck", "shit", "damn", "fck", "fuk", "wtf", "omfg", "fucking hell", "holy fuck", "fuck yeah",
                   "shit man", "aw shit", "fuckkk", "sh*t", "f*ck", "goddamn", "bloody hell", "crap", "dang", "frick"]),
    "violence": ([0.9, 0, 0, 1, 0], 6,
                 ["", "{n} ", "@{n} ", "bro ", "bitch "],
                 ["", " lol", "!!", " fr", " i swear", " watch"],
                 ["ill beat u up", "im gonna beat you up", "ill punch your face in", "ill break your legs",
                  "ill smash your face in", "ill put you in the ground", "ill put u in the ground", "im gonna hurt you",
                  "ill make you bleed", "ill stab you", "ill snap your neck", "ill choke you", "ill beat the crap out of you",
                  "im going to fight you irl", "ill slap you so hard", "ill knock your teeth out"]),
    "veiled": ([0.8, 0, 0, 0.7, 0], 6,
               ["", "{n} ", "@{n} ", "bro "],
               ["", " lol", "!!", " trust me", " watch"],
               ["ill make sure you wont have fun on this server", "ill ruin your game", "ill make your life hell",
                "youll regret joining this server", "ill make you quit", "everyone is going to hate you",
                "ill make sure everyone hates you", "watch what happens to you", "you better leave or else",
                "ill make you cry", "well make you leave the server", "nobody will play with you after this"]),
    "pileon": ([0.8, 0, 0, 0.7, 0], 6,
               ["", "{n} ", "guys ", "yo "],
               ["", " lol", "!!", " over and over", " every day"],
               ["were all gonna jump you", "lets all jump {n}", "everyone jump him", "were gonna grief your base",
                "ill grief your base every day", "lets all spawn kill him until he quits", "everyone report {n} so he gets banned",
                "lets make him rage quit", "were going to destroy everything you build", "lets all gang up on {n}"]),
    "pileonok": (Z, 5,
                 ["", "guys ", "yo ", "{n} "],
                 ["", " lol", "!!", " gg"],
                 ["lets all go to the nether", "everyone meet at spawn", "lets raid the village together",
                  "were gonna build a base together", "lets all jump in the lake", "jump on the slime block",
                  "grief protection is on here", "dont grief please", "someone griefed my base can staff help",
                  "lets gang up on the wither", "lets all spawn at the castle", "everyone jump off the cliff into the water"]),
    "deathwish": ([1, 0, 0, 1, 0], 6,
                  ["", "{n} ", "@{n} ", "bro "],
                  ["", " lol", "!!", " fr", " honestly"],
                  ["i hope you die in a car accident", "i hope you get hit by a bus", "hope you die in a fire",
                   "i hope you get cancer", "i wish you were dead", "i hope you choke", "i hope your house burns down irl",
                   "i hope something bad happens to you", "i hope you never wake up", "the world would be better without you"]),
    "racist": ([1, 1, 0, 0.5, 0], 6,
               ["", "{n} ", "lol ", "honestly "],
               ["", " lol", "!!", " fr"],
               ["im racist", "im very racist", "im a racist", "im proud to be racist", "racism is good",
                "i hate black people", "im gonna insult all the asian people", "mexicans are trash", "jews run everything",
                "go back to your country", "your race is trash", "im gonna insult a bunch of colored people",
                "muslims are terrorists", "white power", "all indians smell"]),
    "racistok": (Z, 5,
                 ["", "{n} ", "lol ", "guys "],
                 ["", " lol", "!!", " pls"],
                 ["racism is bad", "im not racist", "stop being racist", "thats racist", "dont be racist",
                  "i reported him for being racist", "racism isnt allowed here", "being racist will get you banned",
                  "we have black and white wool", "my skin is colored blue lol", "i like colored glass",
                  "my black cat is so cute"]),
}
g_rows = {}
for group, (y, per_core, prefixes, suffixes, cores) in GAME.items():
    for ci, core in enumerate(cores):
        combos = [(p, s) for p in prefixes for s in suffixes]
        game_rng.shuffle(combos)
        for vi, (p, s) in enumerate(combos[:per_core]):
            name = game_rng.choice(NAMES)
            text = (p + core + s).replace("{n}", name).strip()
            key = f"game-{group}-{ci}-{vi}"
            add(game_split(key), key, "tpl", text, y, 2.0)
            g_rows[group] = g_rows.get(group, 0) + 1
print("Game chat templates: " + ", ".join(f"{g} {n}" for g, n in g_rows.items()))

# 4c. Slurs, from a file OUTSIDE the repo (3.1.3) ------------------------------
# The public data held slurs aimed at a player only about a third of the time
# at Medium. The words live in <data>/templates/slurs.json, not here: the repo
# is public, and the word list ships no slurs on purpose. Same PURPOSE as
# above: they are here to be caught. A missing file skips this section.
SLUR_FILE = base / "templates" / "slurs.json"
if SLUR_FILE.exists():
    sl = json.loads(SLUR_FILE.read_text(encoding="utf-8"))
    slur_rng = random.Random(SEED + 2)     # its own draws again
    s_rows = {}
    sets = [("slur", [1, 1, 0, 1, 0], [f.replace("{s}", s) for s in sl["slurs"] for f in sl["aimed"]], 2),
            ("slurgroup", [1, 1, 0, 0.5, 0], [f.replace("{s}", s) for s in sl["slurs"] for f in sl["group"]], 2),
            ("slurok", Z, sl["safe"], 5)]
    for group, y, cores, per_core in sets:
        for ci, core in enumerate(cores):
            combos = [(p, s) for p in ["", "lol ", "bro ", "ok "] for s in ["", " lol", "!!", " stfu", " get out"]]
            if group == "slurok":
                combos = [(p, s) for (p, s) in combos if "stfu" not in s and "get out" not in s]
            slur_rng.shuffle(combos)
            for vi, (p, s) in enumerate(combos[:per_core]):
                text = (p + core + s).replace("{n}", slur_rng.choice(NAMES)).strip()
                key = f"game-{group}-{ci}-{vi}"
                add(game_split(key), key, "tpl", text, y, 2.0)
                s_rows[group] = s_rows.get(group, 0) + 1
    print("Slur templates (from outside the repo): " + ", ".join(f"{g} {n}" for g, n in s_rows.items()))
else:
    print(f"Slur templates skipped: no {SLUR_FILE}")

# 5. Spelling tricks on a share of short training lines, clean ones too, so a
#    trick never means "toxic" by itself.
VOWELS = "aeiou"


def perturb(text):
    words = text.split()
    pool = [i for i, w in enumerate(words) if sum(c.isalpha() for c in w) >= 3]
    if not pool:
        return None
    i = max(pool, key=lambda k: len(words[k])) if rng.random() < 0.6 else rng.choice(pool)
    w = words[i]
    kind = rng.choice(["space", "dots", "stretch", "star", "drop", "swap", "join", "upper"])
    if kind == "space":
        w = " ".join(w)
    elif kind == "dots":
        w = ".".join(w)
    elif kind == "stretch":
        js = [j for j, c in enumerate(w) if c.lower() in VOWELS] or [len(w) - 1]
        j = rng.choice(js)
        w = w[:j] + w[j] * rng.randint(3, 7) + w[j + 1:]
    elif kind == "star":
        js = [j for j, c in enumerate(w) if c.lower() in VOWELS and 0 < j < len(w) - 1]
        if not js:
            return None
        j = rng.choice(js)
        w = w[:j] + "*" + w[j + 1:]
    elif kind == "drop":
        w2 = w[0] + "".join(c for c in w[1:] if c.lower() not in VOWELS)
        if len(w2) < 2 or w2 == w:
            return None
        w = w2
    elif kind == "swap":
        if len(w) < 4:
            return None
        j = rng.randint(1, len(w) - 3)
        w = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    elif kind == "join":
        if i + 1 >= len(words):
            return None
        words[i:i + 2] = [words[i] + words[i + 1]]
        return " ".join(words)
    elif kind == "upper":
        w = w.upper()
    words[i] = w
    return " ".join(words)


# 6. Push against "the group's name is a bad sign": more weight on FRIENDLY
#    lines that mention a group, and on toxic lines that name no group, so
#    toxicity has to be learned from what is said (the BPSN-side weighting of
#    Kaggle's 2019 unintended-bias solutions; research notes, section 4).
#    Weighting every mention alike was tried on 2026-11-26 and did worse.
IDENTITY = re.compile(r"\b(gay|lesbian|homosexual|bisexual|lgbt\w*|queer|trans(gender)?|blacks?|whites?|asians?|latin[ao]s?|"
                      r"hispanics?|mexicans?|africans?|arabs?|indians?|chinese|jews?|jewish|muslims?|islam\w*|christians?|"
                      r"catholics?|hindus?|sikhs?|buddhists?|atheists?|disabled|autistic|immigrants?|wom[ae]n|girls?|females?)\b", re.I)
FRIENDLY_MENTION_WEIGHT = 2.0
TOXIC_NO_MENTION_WEIGHT = 1.5
friendly = toxic_plain = 0
for r in rows["train"]:
    if r["s"] == "tpl":
        continue
    mentions = bool(IDENTITY.search(r["t"]))
    toxic = r["y"][0] is not None and r["y"][0] >= 0.5
    if mentions and not toxic:
        r["w"] = round(r["w"] * FRIENDLY_MENTION_WEIGHT, 4)
        friendly += 1
    elif toxic and not mentions:
        r["w"] = round(r["w"] * TOXIC_NO_MENTION_WEIGHT, 4)
        toxic_plain += 1
print(f"Friendly lines mentioning a group x{FRIENDLY_MENTION_WEIGHT:g}: {friendly:,}; toxic lines naming no group x{TOXIC_NO_MENTION_WEIGHT:g}: {toxic_plain:,}")

aug = 0
for r in list(rows["train"]):
    if r["s"] == "tpl" or len(r["t"]) > 80 or rng.random() > 0.15:
        continue
    t2 = perturb(r["t"])
    if t2 and t2 != r["t"]:
        add("train", r["id"] + "-aug", "aug", t2, r["y"], r["w"] * 0.5)
        aug += 1
print(f"Spelling-trick copies: {aug:,}")

# Write ----------------------------------------------------------------------------
for split, rs in rows.items():
    rng.shuffle(rs)
    # ASCII-only JSON: Node's line reader also breaks lines at U+2028 and
    # U+2029, which Civil Comments contains, so no raw character may reach it.
    with open(out_dir / f"{split}.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for r in rs:
            fh.write(json.dumps(r, ensure_ascii=True) + "\n")
    known = {lab: [r["y"][k] for r in rs if r["y"][k] is not None] for k, lab in enumerate(LABELS)}
    summary = ", ".join(f"{lab} {np.mean(np.array(v) >= 0.5):.2%} of {len(v):,}" for lab, v in known.items() if v)
    by_source = pd.Series([r["s"] for r in rs]).value_counts().to_dict()
    print(f"{split}: {len(rs):,} lines {by_source}; at least half said yes: {summary}")
