# Admin+ watchdog - runs every tick from tick.json.
#
# This exists because of one Bedrock fact: when a pack's manifest asks for a
# BETA module and Beta APIs is switched off, the scripts never start, so no
# script is alive to say so. Functions are DATA, not script, and still run -
# which makes this the only channel that reaches a player when the addon is dead.
#
# The scripts push "ap_alive" back up every second while they are running. This
# counts it down. If it stays down, the scripts are not running.
#
# NO FAKE PLAYERS. This watchdog used to keep its counters on "#script" and
# "#timer", the way a Java datapack would. Bedrock's command parser rejects the
# "#" character outright in an execute target - the content log said it plainly:
#
#   Syntax error: Unexpected "#": at " if score >>#<<script ap_"
#
# and because a function with one unparseable line is dropped WHOLE, tick.json
# then reported this very file as "not found". The counters live on the PLAYERS
# now, addressed with @a and @s, which are real selectors the parser accepts.
#
# The objectives are created unconditionally, every tick, and that is
# deliberate: guarding the call with a score test needs the very objective the
# call was meant to create. Once they exist these lines fail harmlessly, and a
# tick.json function has nowhere to print that failure.
scoreboard objectives add ap_alive dummy
scoreboard objectives add ap_tick dummy
scoreboard objectives add ap_seen dummy

# Anyone the watchdog has not met before joins PRIMED: their warning timer is
# already due, so a broken world tells them within about two seconds instead of
# up to a minute later. That is the whole point of this file - somebody who
# installs the pack without enabling Beta APIs must find out immediately, and
# they cannot be told by a script that never started.
scoreboard players add @a ap_seen 0
execute as @a[scores={ap_seen=0}] run scoreboard players set @s ap_alive 0
execute as @a[scores={ap_seen=0}] run scoreboard players set @s ap_tick 1200
scoreboard players set @a[scores={ap_seen=0}] ap_seen 1

scoreboard players remove @a ap_alive 1
scoreboard players add @a ap_tick 1

# -40, not 0. A player who joins a HEALTHY world sits at 0 until the script's
# next heartbeat tops them back to 100, which can be up to a second away - so
# requiring two full seconds of decay is what makes a false alarm impossible.
execute as @a[scores={ap_alive=..-40,ap_tick=1200..}] run function admin/warn
