extends SceneTree

# Deterministic self-test of the save-slot recovery guard (tests/support/save_slot_guard.gd).
# It uses ONLY a test-only slot path, never the player's save. The slot name includes this process id
# (user://naija-guard-selftest-slot-<pid>.json), so two concurrent instances never share a slot file. The shared
# protocol files (lock, manifest, backup) are still shared, so a run that is refused at start stops at once and
# changes nothing (see _start_expected).
# It does not use timing: "crashes" are simulated by abandoning a guard instance after begin()/observe(), and
# the recorded pid of the abandoned run is rewritten to a process that has already exited, so the guard can prove
# that no run is still active. Refuses to start if any protocol file already exists (it never deletes another
# run's recovery material). Requires Linux or macOS for the pid check and for chmod (restore-failure case).
#   godot --headless --path game --script res://tests/save_guard_headless.gd

const GuardScript = preload("res://tests/support/save_slot_guard.gd")
var SLOT: String = ""  # Set in _initialize: per-process test-only slot path.
var _lost_start: bool = false  # True once a start that must succeed is refused. The run then stops.
const ORIGINAL: String = "original save A"
const CHANGED: String = "changed save B"
const UNKNOWN: String = "unrecognised save C"
const CREATED: String = "save created during the run"
const TEST_NAME: String = "guard-selftest"

var _failures: Array[String] = []
var _checks: int = 0
var _skips: int = 0


func _initialize() -> void:
	SLOT = "user://naija-guard-selftest-slot-%d.json" % OS.get_process_id()
	call_deferred("_run")


func _run() -> void:
	if _protocol_present() or _exists(SLOT):
		print("FAIL: protocol or self-test slot files already exist; nothing was changed.")
		quit(1)
		return
	var scenarios: Array[Callable] = [
		_s01_existing_save_is_backed_up_and_restored,
		_s02_originally_absent_save_is_handled,
		_s03_ambiguous_state_refused_without_change,
		_s04_observed_interrupted_change_is_recovered,
		_s05_backup_byte_mismatch_refused_and_kept,
		_s06_restore_failure_keeps_material_then_recovers,
		_s07_concurrent_start_refused_without_change,
		_s08_refusal_before_start_changes_nothing,
		_s09_stale_lock_without_manifest_is_removed,
		_s10_repeated_finish_and_recovery_are_stable,
	]
	for scenario in scenarios:
		scenario.call()
		if _lost_start:
			break
	_finish_run()


# ---------- scenarios ----------

func _s01_existing_save_is_backed_up_and_restored() -> void:
	_write(SLOT, ORIGINAL)
	var guard := GuardScript.new()
	if not _start_expected(guard, "begin starts a run when an existing save is present"):
		return
	_check(_read(SLOT) == ORIGINAL, "begin does not change the save")
	_check(_read(GuardScript.BACKUP_PATH) == ORIGINAL, "the backup equals the original before the save is changed")
	_check(guard.original_existed(), "the guard records that the original save existed")
	_write(SLOT, CHANGED)
	_check(guard.observe(), "observe records the changed save")
	_check(guard.finish(), "finish restores the original save")
	_check(_read(SLOT) == ORIGINAL, "the original bytes are back after finish")
	_check(not _protocol_present(), "successful cleanup removes the backup, manifest and lock")
	_check(guard.finish(), "a second finish is a no-op that succeeds")
	_check(_read(SLOT) == ORIGINAL, "a second finish leaves the restored save unchanged")
	_remove(SLOT)


func _s02_originally_absent_save_is_handled() -> void:
	_remove(SLOT)
	var guard := GuardScript.new()
	if not _start_expected(guard, "begin starts a run when no save exists"):
		return
	_check(not guard.original_existed(), "the guard records that no original save existed")
	_check(not _exists(GuardScript.BACKUP_PATH), "no backup is written when no save existed")
	_write(SLOT, CREATED)
	_check(guard.finish(), "finish succeeds when the run created a save")
	_check(not _exists(SLOT), "a save created during the run is removed when none existed")
	_check(not _protocol_present(), "cleanup after an absent-save run removes the protocol files")


func _s03_ambiguous_state_refused_without_change() -> void:
	_write(SLOT, ORIGINAL)
	var first := GuardScript.new()
	if not _start_expected(first, "an interrupted run can be started for the ambiguity case"):
		return
	_write(SLOT, UNKNOWN)  # Not observed by the run: the guard cannot prove where this write came from.
	_make_pid_dead()
	var second := GuardScript.new()
	_check(not second.begin(TEST_NAME, SLOT), "recovery refuses when the save is neither the original nor observed")
	_check(_read(SLOT) == UNKNOWN, "the refusal leaves the save unchanged")
	_check(_exists(GuardScript.BACKUP_PATH) and _exists(GuardScript.MANIFEST_PATH) and _lock_present(),
		"the refusal keeps the backup, manifest and lock")
	var repeat := GuardScript.new()
	_check(not repeat.begin(TEST_NAME, SLOT), "a repeated attempt refuses the same state")
	_check(_read(SLOT) == UNKNOWN, "a repeated attempt changes nothing")
	# Resolution for the test: the reviewer restores the original save, which is then a known state.
	_write(SLOT, ORIGINAL)
	var recovery := GuardScript.new()
	if not _start_expected(recovery, "recovery proceeds once the save matches the recorded original"):
		return
	_check(recovery.recovered_previous_run, "the interrupted run is reported as recovered")
	_check(recovery.finish(), "the recovered run finishes cleanly")
	_check(not _protocol_present(), "no protocol files remain after the recovered run")
	_remove(SLOT)


func _s04_observed_interrupted_change_is_recovered() -> void:
	_write(SLOT, ORIGINAL)
	var interrupted := GuardScript.new()
	if not _start_expected(interrupted, "a run starts before the simulated interruption"):
		return
	_write(SLOT, CHANGED)
	_check(interrupted.observe(), "the change is recorded as observed before the interruption")
	_make_pid_dead()
	var recovery := GuardScript.new()
	if not _start_expected(recovery, "an interrupted run with an observed change is recovered"):
		return
	_check(recovery.recovered_previous_run, "the recovery is reported")
	_check(_read(SLOT) == ORIGINAL, "recovery restores the original bytes")
	_check(recovery.finish(), "the new run started by the recovery finishes cleanly")
	_check(not _protocol_present(), "no protocol files remain after recovery")
	_remove(SLOT)


func _s05_backup_byte_mismatch_refused_and_kept() -> void:
	_write(SLOT, ORIGINAL)
	var interrupted := GuardScript.new()
	if not _start_expected(interrupted, "a run starts for the byte-mismatch case"):
		return
	_write(SLOT, CHANGED)
	_check(interrupted.observe(), "the change is observed before the interruption")
	_write(GuardScript.BACKUP_PATH, "tampered backup")
	_make_pid_dead()
	var refused := GuardScript.new()
	_check(not refused.begin(TEST_NAME, SLOT), "recovery refuses when the backup does not match the original")
	_check(_read(SLOT) == CHANGED, "a backup mismatch leaves the save unchanged")
	_check(_read(GuardScript.BACKUP_PATH) == "tampered backup", "the mismatched backup is kept for review")
	_check(_exists(GuardScript.MANIFEST_PATH) and _lock_present(), "the manifest and lock are kept")
	# Resolution for the test: the reviewer puts back the correct backup.
	_write(GuardScript.BACKUP_PATH, ORIGINAL)
	var recovery := GuardScript.new()
	if not _start_expected(recovery, "recovery proceeds once the backup matches the original"):
		return
	_check(recovery.finish(), "the recovered run finishes cleanly")
	_check(_read(SLOT) == ORIGINAL and not _protocol_present(), "the original is restored and no protocol files remain")
	_remove(SLOT)


func _s06_restore_failure_keeps_material_then_recovers() -> void:
	if not _chmod_enforced():
		_skip("restore-failure case needs a non-root user on Linux or macOS")
		return
	_write(SLOT, ORIGINAL)
	var interrupted := GuardScript.new()
	if not _start_expected(interrupted, "a run starts for the restore-failure case"):
		return
	_write(SLOT, CHANGED)
	_check(interrupted.observe(), "the change is observed before the interruption")
	_make_pid_dead()
	_chmod(SLOT, "444")
	var failing := GuardScript.new()
	var refused := not failing.begin(TEST_NAME, SLOT)
	_chmod(SLOT, "644")
	_check(refused, "recovery reports failure when the original cannot be written back")
	_check(_read(SLOT) == CHANGED, "a failed restore leaves the save bytes as they were")
	_check(_read(GuardScript.BACKUP_PATH) == ORIGINAL, "a failed restore keeps the backup")
	_check(_exists(GuardScript.MANIFEST_PATH) and _lock_present(), "a failed restore keeps the manifest and lock")
	var retry := GuardScript.new()
	if not _start_expected(retry, "a repeated recovery succeeds once the save is writable"):
		return
	_check(_read(SLOT) == ORIGINAL, "the repeated recovery restores the original bytes")
	_check(retry.finish(), "the retried run finishes cleanly")
	_check(not _protocol_present(), "no protocol files remain after the retried recovery")
	_remove(SLOT)


func _s07_concurrent_start_refused_without_change() -> void:
	_write(SLOT, ORIGINAL)
	var first := GuardScript.new()
	if not _start_expected(first, "the first run takes the lock"):
		return
	var second := GuardScript.new()
	_check(not second.begin(TEST_NAME, SLOT), "a second run is refused while the lock is held")
	_check(_read(SLOT) == ORIGINAL, "the refused second run does not change the save")
	_check(not second.acquire_lock("concurrent-probe"), "a lock-only run is refused while the first run holds the lock")
	# The start checks above refuse first. This exercises the atomic lock directly, as a start that passed the checks
	# would hit it (the window between the check and the lock cannot be forced deterministically).
	var owner_before := _read(GuardScript.LOCK_OWNER_PATH)
	var racer := GuardScript.new()
	_check(not racer._take_lock(TEST_NAME), "the atomic lock refuses a second owner while the first run holds it")
	_check(_read(GuardScript.LOCK_OWNER_PATH) == owner_before, "the refused lock attempt leaves the owner record unchanged")
	_check(_exists(GuardScript.MANIFEST_PATH) and _read(GuardScript.BACKUP_PATH) == ORIGINAL,
		"the first run's manifest and backup are untouched by the refusals")
	_check(first.finish(), "the first run finishes after the refusals")
	_check(_read(SLOT) == ORIGINAL and not _protocol_present(), "the first run leaves no protocol files")
	_remove(SLOT)


func _s08_refusal_before_start_changes_nothing() -> void:
	# A backup with no manifest has unknown provenance, so the run must refuse to start.
	_write(SLOT, ORIGINAL)
	_write(GuardScript.BACKUP_PATH, "stray backup")
	var stray := GuardScript.new()
	_check(not stray.begin(TEST_NAME, SLOT), "a backup without a manifest blocks the run")
	_check(_read(SLOT) == ORIGINAL, "the refused run does not change the save")
	_check(_read(GuardScript.BACKUP_PATH) == "stray backup", "the stray backup is kept")
	_remove(GuardScript.BACKUP_PATH)
	# An unreadable manifest is inconsistent, so the run must refuse to start.
	_write(GuardScript.MANIFEST_PATH, "not json {")
	var unreadable := GuardScript.new()
	_check(not unreadable.begin(TEST_NAME, SLOT), "an unreadable manifest blocks the run")
	_check(_read(SLOT) == ORIGINAL, "the unreadable-manifest refusal does not change the save")
	_check(_read(GuardScript.MANIFEST_PATH) == "not json {", "the unreadable manifest is kept for review")
	_remove(GuardScript.MANIFEST_PATH)
	_remove(SLOT)


func _s09_stale_lock_without_manifest_is_removed() -> void:
	var dir := DirAccess.open("user://")
	_check(dir != null and dir.make_dir(GuardScript.LOCK_DIR.trim_prefix("user://")) == OK,
		"a stale lock directory can be created for the case")
	_write(GuardScript.LOCK_OWNER_PATH, JSON.stringify(
		{"run_id": "stale-run", "pid": _dead_pid(), "test": "stale", "time": 0}))
	_write(SLOT, ORIGINAL)
	var guard := GuardScript.new()
	if not _start_expected(guard, "a stale lock whose owner has exited is removed and the run starts"):
		return
	_check(guard.recovered_previous_run, "the stale lock is reported as recovered")
	_check(_read(SLOT) == ORIGINAL, "removing a stale lock does not change the save")
	_check(guard.finish(), "the run after the stale lock finishes cleanly")
	_check(not _protocol_present(), "no protocol files remain after the stale-lock case")
	_remove(SLOT)


func _s10_repeated_finish_and_recovery_are_stable() -> void:
	_write(SLOT, ORIGINAL)
	var guard := GuardScript.new()
	if not _start_expected(guard, "a run starts for the repeated-attempt case"):
		return
	_check(guard.finish(), "the first finish restores the save")
	_check(guard.finish(), "a repeated finish succeeds without changing anything")
	_check(_read(SLOT) == ORIGINAL and not _protocol_present(), "repeated finish leaves a clean, restored state")
	_remove(SLOT)


# ---------- helpers ----------

func _skip(reason: String) -> void:
	_skips += 1
	print("SKIPPED: %s" % reason)


func _finish_run() -> void:
	if _lost_start:
		# Another run owns the protocol files. Remove only this run's own slot file, then report BLOCKED.
		if _exists(SLOT):
			_remove(SLOT)
		print("BLOCKED: another save-guard run holds the protocol; this run was refused at start and changed nothing.")
		quit(1)
		return
	if _protocol_present():
		_failures.append("protocol files were left behind; they are kept for review")
	elif _exists(SLOT):
		_remove(SLOT)
	if _failures.is_empty():
		print("PASS: %d save-guard checks (%d skipped)" % [_checks, _skips])
		quit(0)
	else:
		for failure in _failures:
			push_error("Save-guard check failed: %s" % failure)
		print("FAIL: %d of %d save-guard checks" % [_failures.size(), _checks])
		quit(1)


## A start that must succeed. A refusal is a failed check and stops the run before any further change.
func _start_expected(guard: RefCounted, description: String) -> bool:
	var started: bool = guard.begin(TEST_NAME, SLOT)
	_check(started, description)
	if not started:
		_lost_start = true
	return started


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)


func _abs(path: String) -> String:
	return ProjectSettings.globalize_path(path)


func _exists(path: String) -> bool:
	return FileAccess.file_exists(path)


func _read(path: String) -> String:
	if not FileAccess.file_exists(path):
		return ""
	return FileAccess.get_file_as_string(path)


func _write(path: String, text: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f != null:
		f.store_string(text)
		f.close()


func _remove(path: String) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(_abs(path))


func _lock_present() -> bool:
	return DirAccess.dir_exists_absolute(_abs(GuardScript.LOCK_DIR))


func _protocol_present() -> bool:
	return (
		_lock_present()
		or _exists(GuardScript.MANIFEST_PATH)
		or _exists(GuardScript.BACKUP_PATH)
		or _exists(GuardScript.MANIFEST_PATH + GuardScript.TEMP_SUFFIX)
	)


func _dead_pid() -> int:
	# The shell prints its own pid and exits, so that pid no longer names a running process.
	var out: Array = []
	OS.execute("sh", ["-c", "echo $$"], out, false)
	if out.is_empty():
		return 0
	return str(out[0]).strip_edges().to_int()


func _make_pid_dead() -> void:
	# Rewrites the recorded pid of the abandoned run (manifest and lock owner) to an exited process.
	var pid := _dead_pid()
	for path in [GuardScript.MANIFEST_PATH, GuardScript.LOCK_OWNER_PATH]:
		if not _exists(path):
			continue
		var data: Variant = JSON.parse_string(_read(path))
		if data is Dictionary:
			(data as Dictionary)["pid"] = pid
			_write(path, JSON.stringify(data))


func _chmod_enforced() -> bool:
	var os_name := OS.get_name()
	if os_name != "Linux" and os_name != "macOS":
		return false
	# Root ignores file permissions. Probe with a throwaway file under the test slot's directory.
	_write(SLOT, ORIGINAL)
	_chmod(SLOT, "444")
	var probe := FileAccess.open(SLOT, FileAccess.WRITE)
	var writable := probe != null
	if probe != null:
		probe.close()
	_chmod(SLOT, "644")
	_remove(SLOT)
	return not writable


func _chmod(path: String, mode: String) -> void:
	OS.execute("chmod", [mode, _abs(path)], [], false)
