extends SceneTree

## Client check for the persistence.restored notice (Stage 28, G3). Headless, like the other files in this folder:
##   godot --headless --path game --script res://tests/persistence_notice.gd
## Exit code 0 means every check passed; 1 means at least one failed.
##
## The checks: the restored message produces one notice; every other message produces none, including the failure
## message and older message types; and the notice never claims that outage-period changes were recovered.

const MultiplayerClientScript = preload("res://scripts/services/multiplayer_client.gd")

const CLAIM_PHRASES: Array = [
	"recovered",
	"restored your",
	"all changes",
	"everything",
	"your progress",
	"are saved",
	"is saved",
]


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var failures: Array[String] = []

	var notice: String = MultiplayerClientScript.persistence_notice(
		{"type": "persistence.restored", "failedAttempts": 3, "outageSeconds": 12}
	)
	if notice.is_empty():
		failures.append("persistence.restored must produce a notice")
	var lowered := notice.to_lower()
	for phrase in CLAIM_PHRASES:
		if lowered.find(phrase) != -1:
			failures.append("notice must not claim '%s': %s" % [phrase, notice])

	# The same message with no counters (an older or minimal server) still produces the notice.
	if MultiplayerClientScript.persistence_notice({"type": "persistence.restored"}).is_empty():
		failures.append("persistence.restored without counters must still produce a notice")

	# Ordinary traffic must not produce the notice: no repeats for ordinary saves.
	var others: Array = [
		{"type": "session.ready"},
		{"type": "persistence_failed"},
		{"type": "error", "code": "persistence_failed", "message": "Server state could not be saved."},
		{"type": "command.duplicate", "requestId": "abc"},
		{"type": "character.snapshot", "character": {}},
		{"type": "persistence.restored.extra"},
		{"type": ""},
		{},
	]
	for other in others:
		var other_notice: String = MultiplayerClientScript.persistence_notice(other)
		if not other_notice.is_empty():
			failures.append("message %s must not produce the notice" % str(other))

	if failures.is_empty():
		print("persistence notice checks: PASS (%d checks)" % (3 + others.size()))
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		print("persistence notice checks: FAIL (%d failures)" % failures.size())
		quit(1)
