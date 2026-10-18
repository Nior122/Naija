extends RefCounted
## Crash-safe recovery protocol for headless tests that write the local save slot.
##
## Only test code uses this. Production save code is not changed.
##
## Files (all in user://):
##   naija-save-test.lock.d/owner.json  the lock. The directory is created with make_dir, which only one caller can
##                                      succeed at, so two runs cannot both hold it. owner.json holds run id, pid, test.
##   naija-save-test-recovery.json      the manifest: run id, slot path, whether a save existed, the original hash,
##                                      the last content observed for this run, and the state (see below).
##   naija-save-test-backup.bin         a byte copy of the original save, verified before the slot is touched.
##
## JSON files are written to a temporary name, read back, and renamed over the target. A crash therefore leaves
## either the previous complete file or the new one, never a partial one. A leftover manifest temporary file is removed
## only when no lock is held (a crash left it). It is never read.
##
## States, in the order a normal run passes through them:
##   locked     lock and manifest written. The save slot has not been touched.
##   backed_up  backup written and read back equal to the original. The test may now change the slot.
##   restoring  restore has started. The backup is authoritative from here on.
##   restored   the slot was verified equal to the original (or verified absent when none existed).
## Removal order: backup, then manifest, then lock. A manifest is therefore never left without its lock.
##
## Recovery rule: a leftover protocol state is recovered automatically only when every byte it depends on is proven.
## Otherwise recovery refuses and changes nothing. Nothing is deleted just because it occupies the save path.
##
## Known limit: a write made by the game between two observe() calls is not recorded. If the process then dies,
## the slot content does not match any recorded state, and recovery refuses. That is the conservative outcome.

const LOCK_DIR := "user://naija-save-test.lock.d"
const LOCK_OWNER_PATH := "user://naija-save-test.lock.d/owner.json"
const MANIFEST_PATH := "user://naija-save-test-recovery.json"
const BACKUP_PATH := "user://naija-save-test-backup.bin"
const TEMP_SUFFIX := ".tmp"
const SCHEMA := 1
const STATE_LOCKED := "locked"
const STATE_BACKED_UP := "backed_up"
const STATE_RESTORING := "restoring"
const STATE_RESTORED := "restored"
const KNOWN_STATES := [STATE_LOCKED, STATE_BACKED_UP, STATE_RESTORING, STATE_RESTORED]
# Artifacts from runs before this protocol. They carry no metadata, so they are never recovered automatically.
const LEGACY_FILES := [
	"naija-stage1-save.return-test-backup.json",
	"naija-stage1-save.return-test-no-save.marker",
	"naija-stage1-save.ui-flow-backup.json",
	"naija-stage1-save.ui-flow-no-save.marker",
	"naija-stage1-save.load-confirm-backup.json",
	"naija-stage1-save.load-confirm-no-save.marker",
]

var message := ""  # The last human-readable outcome, printed by the test on failure.
var recovered_previous_run := false  # True when this start recovered a leftover run.

var _test_name := ""
var _run_id := ""
var _slot := ""
var _save_existed := false
var _original_sha := ""
var _original_size := 0
var _original_bytes := PackedByteArray()
var _observed_sha := ""
var _holding := false
var _state := ""


# ---------- public API ----------

## Takes the protocol lock for a test that does not touch the save slot (domain and restart tests).
## Recovers any leftover state first. Returns false, changing nothing, when the state is ambiguous or a run is active.
func acquire_lock(test_name: String) -> bool:
	if not _recover_leftovers(""):
		return false
	return _take_lock(test_name)


## Releases a lock taken by acquire_lock. Refuses to remove the lock while a manifest exists.
func release_lock() -> bool:
	if not _holding or _slot != "":
		return true
	if FileAccess.file_exists(MANIFEST_PATH):
		message = "The recovery manifest still exists, so the lock was kept."
		return false
	return _remove_lock() and _clear_holding()


## Starts a run that changes the save slot. Recovers leftovers, takes the lock, and backs up the original.
## Returns false when the run must not start. In that case the slot has not been changed.
func begin(test_name: String, slot_path: String) -> bool:
	if not _recover_leftovers(slot_path):
		return false
	if not _take_lock(test_name):
		return false
	_slot = slot_path
	var slot := _read_file(slot_path)
	if slot.exists and not slot.readable:
		message = "The local save exists but cannot be read. Nothing was changed."
		return _abort_before_change()
	_save_existed = slot.exists
	_original_bytes = slot.bytes
	_original_sha = _sha(_original_bytes) if _save_existed else ""
	_original_size = _original_bytes.size() if _save_existed else 0
	_observed_sha = _original_sha
	_state = STATE_LOCKED
	if not _write_manifest():
		message = "Could not write the recovery manifest. Nothing was changed."
		return _abort_before_change()
	if _save_existed:
		if not _write_bytes(BACKUP_PATH, _original_bytes):
			message = "Could not create the backup of the local save. The save was not changed."
			return _abort_before_change()
		var check := _read_file(BACKUP_PATH)
		if not check.readable or _sha(check.bytes) != _original_sha:
			message = "The backup did not read back equal to the original. The save was not changed."
			return _abort_before_change()
	_state = STATE_BACKED_UP
	if not _write_manifest():
		message = "Could not record the backed-up state. The save was not changed."
		return _abort_before_change()
	if not recovered_previous_run:
		message = "Protocol started; the original save is backed up and verified."
	return true


## Records the slot content as observed while this run holds the lock. Call it after each explicit save and once per frame.
## Only changes are written. Does nothing when the run does not hold the lock.
func observe() -> bool:
	if not _holding or _slot == "" or _state != STATE_BACKED_UP:
		return true
	var slot := _read_file(_slot)
	if slot.exists and not slot.readable:
		return false
	var sha := _sha(slot.bytes) if slot.exists else ""
	if sha == _observed_sha:
		return true
	_observed_sha = sha
	return _write_manifest()


## True when the save existed when this run began. Valid after begin(), and still valid after finish().
func original_existed() -> bool:
	return _save_existed


## True when any protocol file or the lock directory is present. Used by the test's final checks.
func protocol_files_present() -> bool:
	return _lock_present() or FileAccess.file_exists(MANIFEST_PATH) or FileAccess.file_exists(BACKUP_PATH)


## Restores the original save and removes the protocol files. Idempotent. On failure everything is kept for recovery.
func finish() -> bool:
	if not _holding or _slot == "":
		return true
	if _state == STATE_LOCKED:
		# The slot was never changed. Only the backup (if any) and the protocol files remain.
		if not _remove_protocol_files():
			return false
		message = "No save change was made, so the protocol files are removed."
		return _clear_holding()
	_state = STATE_RESTORING
	if not _write_manifest():
		message = "Could not record the restore. Recovery material is kept at %s and %s." % [MANIFEST_PATH, BACKUP_PATH]
		return false
	if not _restore_slot_from_backup():
		return false
	return _finish_cleanup()


# ---------- internal: recovery ----------

func _recover_leftovers(slot_path: String) -> bool:
	var legacy: Array[String] = []
	for name in LEGACY_FILES:
		if FileAccess.file_exists("user://" + name):
			legacy.append("user://" + name)
	if not legacy.is_empty():
		message = "Refusing to run: legacy test artifacts from an earlier run exist (%s). They carry no provenance. A human must review and resolve them." % str(legacy)
		return false
	# The temporary manifest is only written by the lock holder, and the holder creates its lock before it writes any
	# temporary file. Check the temporary file first, then the lock: a temporary file seen here means the lock existed
	# when it was written, so a lock seen afterwards is still held. Checking in the other order let a run delete a live
	# holder's temporary file between the two checks. A leftover with no lock is from a crash and can be removed.
	# While a lock is present it is left alone. The real file is never partial, so a leftover is never read.
	var temp_present := FileAccess.file_exists(MANIFEST_PATH + TEMP_SUFFIX)
	var has_lock := _lock_present()
	if temp_present and not has_lock:
		if not _remove_file(MANIFEST_PATH + TEMP_SUFFIX, "stray temporary file"):
			return false
	var has_manifest := FileAccess.file_exists(MANIFEST_PATH)
	var has_backup := FileAccess.file_exists(BACKUP_PATH)
	if not has_lock and not has_manifest and not has_backup:
		return true
	if has_manifest:
		return _recover_from_manifest(slot_path, has_lock, has_backup)
	if has_backup:
		message = "Refusing to run: a backup exists without a recovery manifest, so its provenance is unknown. Review %s." % BACKUP_PATH
		return false
	# Lock only, no manifest. The manifest is written before any change, so no save change can have happened.
	var owner: Variant = _read_json(LOCK_OWNER_PATH)
	if not owner is Dictionary:
		message = "Refusing to run: the save-test lock is held, but its owner record is not readable (a run may be starting now). Nothing was changed; review %s." % LOCK_DIR
		return false
	var pid := int((owner as Dictionary).get("pid", 0))
	if _pid_active(pid):
		message = "Refusing to run: another save test (pid %d) holds the lock. Nothing was changed." % pid
		return false
	if not _remove_lock():
		return false
	recovered_previous_run = true
	message = "Removed a stale lock from pid %d. No save was changed." % pid
	return true


func _recover_from_manifest(slot_path: String, has_lock: bool, has_backup: bool) -> bool:
	var m: Variant = _read_json(MANIFEST_PATH)
	if not m is Dictionary or not _manifest_valid(m):
		message = "Refusing to run: the recovery manifest is unreadable or inconsistent. Nothing was changed; review %s and %s." % [MANIFEST_PATH, BACKUP_PATH]
		return false
	var manifest: Dictionary = m
	if slot_path != "" and str(manifest["slot"]) != slot_path:
		message = "Refusing to run: the manifest refers to another save path (%s)." % str(manifest["slot"])
		return false
	if not has_lock:
		message = "Refusing to run: a manifest exists without its lock. Nothing was changed."
		return false
	var owner: Variant = _read_json(LOCK_OWNER_PATH)
	if not owner is Dictionary or str((owner as Dictionary).get("run_id", "")) != str(manifest["run_id"]):
		message = "Refusing to run: the lock does not belong to the recorded run. Nothing was changed."
		return false
	var pid := int(manifest["pid"])
	if _pid_active(pid):
		message = "Refusing to run: run %s (pid %d) may still be active (it holds the lock), or its state cannot be checked. Nothing was changed." % [str(manifest["run_id"]), pid]
		return false
	var slot := _read_file(str(manifest["slot"]))
	var backup := _read_file(BACKUP_PATH)
	if slot.exists and not slot.readable:
		message = "Refusing to run: the save exists but cannot be read. Nothing was changed."
		return false
	var state := str(manifest["state"])
	var original_sha := str(manifest["original_sha"])
	var save_existed := bool(manifest["save_existed"])
	var observed := str(manifest["observed_sha"])
	var slot_sha := _sha(slot.bytes) if slot.exists else ""
	if state == STATE_LOCKED:
		# The slot was not changed yet. A partial or complete backup is redundant and is removed below.
		if save_existed and (not slot.exists or slot_sha != original_sha):
			message = "Refusing to run: the save changed before the backup was recorded. Nothing was changed; review %s." % str(manifest["slot"])
			return false
		if not save_existed and slot.exists:
			message = "Refusing to run: a save exists where none existed at the start of run %s. Nothing was changed." % str(manifest["run_id"])
			return false
	elif state == STATE_BACKED_UP or state == STATE_RESTORING:
		if save_existed and (not backup.exists or not backup.readable or _sha(backup.bytes) != original_sha):
			message = "Refusing to run: the backup is missing or does not match the recorded original. Nothing was changed; the backup is kept for review."
			return false
		if state == STATE_BACKED_UP:
			# Known content: the original, or the last state this run recorded. An absent slot hashes to "".
			# Anything else is refused, because it may be a write this run never observed.
			var known := slot_sha == original_sha or slot_sha == observed
			if not known:
				message = "Refusing to run: the save content is neither the original nor the last content seen during run %s. Nothing was changed; review %s." % [str(manifest["run_id"]), str(manifest["slot"])]
				return false
	elif state == STATE_RESTORED:
		if save_existed and (not slot.exists or slot_sha != original_sha):
			message = "Refusing to run: the restore is recorded as complete, but the save is not the original. Nothing was changed."
			return false
		if not save_existed and slot.exists:
			message = "Refusing to run: the restore is recorded as complete, but a save exists. Nothing was changed."
			return false
	else:
		message = "Refusing to run: unknown recovery state '%s'." % state
		return false
	# Every check passed. Recover from this point. Each step is repeatable.
	_slot = str(manifest["slot"])
	_run_id = str(manifest["run_id"])
	_test_name = str(manifest["test"])
	_save_existed = save_existed
	_original_sha = original_sha
	_original_size = int(manifest["original_size"])
	_original_bytes = backup.bytes if backup.exists else PackedByteArray()
	_observed_sha = observed
	_state = state
	_holding = true
	if state != STATE_RESTORED and save_existed and slot_sha != original_sha:
		if not _restore_slot_from_backup():
			return false
	elif state != STATE_RESTORED and not save_existed and slot.exists:
		if not _remove_file(_slot, "save created by the interrupted run"):
			return false
	if state != STATE_RESTORED:
		_state = STATE_RESTORED
		if not _write_manifest():
			message = "Refusing to continue: could not record the recovery. Nothing else was changed."
			return false
	if not _finish_cleanup():
		return false
	recovered_previous_run = true
	message = "Recovered the save from interrupted run %s (test %s). The original is back in place and the protocol files are removed." % [_run_id, _test_name]
	return true


# ---------- internal: shared steps ----------

func _take_lock(test_name: String) -> bool:
	var dir := DirAccess.open("user://")
	if dir == null:
		message = "Could not open user:// to take the lock. Nothing was changed."
		return false
	# make_dir succeeds for exactly one caller. A failure means another run holds the lock, or a stale lock is present.
	if dir.make_dir(LOCK_DIR.trim_prefix("user://")) != OK:
		message = "Another save-writing test holds the lock, or a stale lock exists. Nothing was changed."
		return false
	_run_id = "%d-%d" % [Time.get_ticks_usec(), randi()]
	_test_name = test_name
	var data := {"run_id": _run_id, "pid": OS.get_process_id(), "test": test_name, "time": Time.get_unix_time_from_system()}
	if not _write_json(LOCK_OWNER_PATH, data):
		_remove_lock()
		message = "Could not write the lock owner. Nothing was changed."
		return false
	_holding = true
	return true


func _restore_slot_from_backup() -> bool:
	if _save_existed:
		var current := _read_file(_slot)
		if current.exists and current.readable and _sha(current.bytes) == _original_sha:
			return true  # Already the original. Nothing to write.
		if not _write_bytes(_slot, _original_bytes):
			message = "Could not write the original save back. The backup is kept at %s." % BACKUP_PATH
			return false
		var check := _read_file(_slot)
		if not check.readable or _sha(check.bytes) != _original_sha:
			message = "The restored save does not match the original bytes. The backup is kept at %s." % BACKUP_PATH
			return false
		return true
	# No save existed at the start. Remove the one this run created, if any.
	if FileAccess.file_exists(_slot):
		if not _remove_file(_slot, "save created by this run"):
			return false
	return true


func _finish_cleanup() -> bool:
	# Record "restored" before anything is removed, so an interrupted cleanup can be finished by the next run.
	if _state != STATE_RESTORED:
		_state = STATE_RESTORED
		if not _write_manifest():
			message = "Could not record the restored state. Recovery material is kept."
			return false
	if not _remove_protocol_files():
		return false
	return _clear_holding()


func _remove_protocol_files() -> bool:
	# Order matters: backup first, then manifest, then lock. A leftover manifest always has its lock.
	if FileAccess.file_exists(BACKUP_PATH) and not _remove_file(BACKUP_PATH, "backup"):
		return false
	if FileAccess.file_exists(MANIFEST_PATH) and not _remove_file(MANIFEST_PATH, "recovery manifest"):
		return false
	return _remove_lock()


func _abort_before_change() -> bool:
	# Used only before the slot has been changed. A backup written here is redundant, because the slot is the original.
	_remove_protocol_files()
	_clear_holding()
	return false


func _clear_holding() -> bool:
	_holding = false
	_slot = ""
	_state = ""
	return true


func _lock_present() -> bool:
	return DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(LOCK_DIR))


func _remove_lock() -> bool:
	# Removes the owner file (and any temporary copy), then the directory. Fails loudly if either remains.
	for path in [LOCK_OWNER_PATH, LOCK_OWNER_PATH + TEMP_SUFFIX]:
		if FileAccess.file_exists(path) and not _remove_file(path, "lock owner"):
			return false
	if not _lock_present():
		return true
	var dir := DirAccess.open("user://")
	if dir == null or dir.remove(LOCK_DIR.trim_prefix("user://")) != OK or _lock_present():
		message = "Could not remove the lock directory (%s). Recovery material is kept." % LOCK_DIR
		return false
	return true


func _manifest_valid(m: Dictionary) -> bool:
	# JSON numbers load as floats, so numeric fields accept int or float.
	var text_keys := ["run_id", "test", "slot", "state", "original_sha", "observed_sha"]
	var number_keys := ["schema", "original_size", "pid"]
	for key in text_keys:
		if not m.has(key) or typeof(m[key]) != TYPE_STRING:
			return false
	for key in number_keys:
		if not m.has(key) or typeof(m[key]) not in [TYPE_INT, TYPE_FLOAT]:
			return false
	if not m.has("save_existed") or typeof(m["save_existed"]) != TYPE_BOOL:
		return false
	if int(m["schema"]) != SCHEMA or not KNOWN_STATES.has(str(m["state"])):
		return false
	if str(m["run_id"]).is_empty() or not str(m["slot"]).begins_with("user://"):
		return false
	if bool(m["save_existed"]) and str(m["original_sha"]).is_empty():
		return false
	return true


func _write_manifest() -> bool:
	var data := {
		"schema": SCHEMA, "run_id": _run_id, "test": _test_name, "slot": _slot, "state": _state,
		"save_existed": _save_existed, "original_sha": _original_sha, "original_size": _original_size,
		"observed_sha": _observed_sha, "pid": OS.get_process_id(),
	}
	return _write_json(MANIFEST_PATH, data)


# ---------- internal: file helpers ----------

func _read_file(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"exists": false, "readable": true, "bytes": PackedByteArray()}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {"exists": true, "readable": false, "bytes": PackedByteArray()}
	var bytes := f.get_buffer(f.get_length())
	f.close()
	return {"exists": true, "readable": true, "bytes": bytes}


func _write_bytes(path: String, bytes: PackedByteArray) -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_buffer(bytes)
	f.close()
	return true


func _write_json(path: String, data: Dictionary) -> bool:
	# Atomic replace: write a temporary file, read it back, then rename it over the target.
	var temp := path + TEMP_SUFFIX
	var f := FileAccess.open(temp, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify(data))
	f.close()
	var check: Variant = _read_json(temp)
	if not check is Dictionary:
		return false
	var dir := DirAccess.open("user://")
	if dir == null:
		return false
	if dir.rename(temp.trim_prefix("user://"), path.trim_prefix("user://")) != OK:
		return false
	var back: Variant = _read_json(path)
	return back is Dictionary


func _read_json(path: String) -> Variant:
	var r := _read_file(path)
	if not r.exists or not r.readable:
		return null
	return JSON.parse_string((r.bytes as PackedByteArray).get_string_from_utf8())


func _remove_file(path: String, label: String) -> bool:
	var dir := DirAccess.open("user://")
	if dir == null:
		message = "Could not open user:// to remove the %s. Recovery material is kept." % label
		return false
	if FileAccess.file_exists(path):
		dir.remove(path.trim_prefix("user://"))
	if FileAccess.file_exists(path):
		message = "Could not remove the %s (%s). Recovery material is kept." % [label, path]
		return false
	return true


func _sha(bytes: PackedByteArray) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


## Returns true when the pid may be active, or when that cannot be decided. Only "No such process" proves a process is gone.
func _pid_active(pid: int) -> bool:
	if pid <= 0:
		return false
	var os_name := OS.get_name()
	if os_name != "Linux" and os_name != "macOS":
		return true
	var out: Array = []
	var code := OS.execute("kill", ["-0", str(pid)], out, true)
	if code == 0:
		return true
	var text := str(out)
	return not text.contains("No such process")
