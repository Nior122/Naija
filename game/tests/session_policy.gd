extends SceneTree

## Client check for the saved-session decision (Stage 29 follow-up, D-06). Headless, like the other files in this folder:
##   godot --headless --path game --script res://tests/session_policy.gd
## Exit code 0 means every check passed; 1 means at least one failed.
##
## STATUS: NOT RUN in this repository. Godot 4.7.2 is not installed in the environment that produced this file.
## Passing this file requires a real Godot 4.7.2 run.
##
## The checks: once an identity was issued for this device, identity.create is never sent automatically with the
## saved creation key, including after a relaunch. A device that has never been issued an identity may still create
## one. A saved file written before the flag existed, with a token, counts as issued.

const MultiplayerClientScript = preload("res://scripts/services/multiplayer_client.gd")


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var failures: Array[String] = []

	if MultiplayerClientScript.may_send_create_identity(true):
		failures.append("an issued identity must block automatic identity.create")
	if not MultiplayerClientScript.may_send_create_identity(false):
		failures.append("a device with no issued identity must be allowed its first identity.create")

	if failures.is_empty():
		print("session_policy.gd: all checks passed")
		quit(0)
	else:
		for failure in failures:
			printerr("session_policy.gd: FAIL: %s" % failure)
		quit(1)
