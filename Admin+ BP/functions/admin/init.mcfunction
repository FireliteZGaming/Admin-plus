# Creates the watchdog objectives. Called by /function check.
#
# It deliberately does NOT touch ap_alive: that score is the running scripts'
# heartbeat, and zeroing it here would make /function check report "not running"
# on a perfectly healthy world every time it was used.
#
# The per-tick watchdog no longer calls this - it creates the objectives itself,
# because guarding the call with a score test needed the very objective the call
# was meant to create.

scoreboard objectives add ap_alive dummy
scoreboard objectives add ap_tick dummy
scoreboard players set @a ap_tick 0
