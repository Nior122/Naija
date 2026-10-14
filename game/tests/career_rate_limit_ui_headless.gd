# Stage 44: a career action refused by the server's command limit, through the career panel.
# HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# STATUS: WRITTEN BUT NOT EXECUTED. The Stage 44 sandbox had no Godot 4.7.2 binary, so this
# script has been parse-checked (gdparse) and lint-checked (gdlint) only. Its result is not
# evidence that the career panel works until it has been run with tools/godot/run-godot-checks.sh
# on a machine with Godot 4.7.2 (docs/STAGE_44_BUSINESS_VERIFICATION.md section 7.5).
#
# The server allows 20 commands per connection in 10 seconds. A refused command is answered with
# a generic "error" that carries the request ID (code rate_limited), not with career.error. The
# career panel is busy from the moment it sends career.action until a reply arrives. This test
# checks that:
#   1. a career search refused by the limit is shown in the career panel, which is no longer
#      busy and whose Search button is enabled again;
#   2. the global toast shows the refusal;
#   3. the in-flight career request ID is cleared (the matched refusal was routed, not dropped);
#   4. after the window resets, a career search is answered normally, so career interactions
#      still work;
#   5. a refusal with another request ID (a business request) does not change the career panel.
#      This is checked by a synthetic error message delivered to the game's dispatch, not by a
#      socket refusal. The business refusal itself is covered by business_rate_limit_ui_headless.gd,
#      which does not look at the career panel.
# NOT covered here: character_deceased routing (needs a deceased character; covered by a
# source-contract test only).
#
extends SceneTree

const MAIN_SCENE := preload("res://scenes/main.tscn")
const WATCHDOG_SECONDS := 180.0
const SESSION_WAIT_FRAMES := 1800
const SEARCH_PRESSES_MAX := 40
const REPLY_WAIT_MS := 5000
const WINDOW_RESET_MS := 10500
const MESSAGE_RATE_LIMITED := "Too many commands were sent in a short time."
const MESSAGE_WAITING := "Waiting for the shared career service"
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const URL_ENV := "NAIJA_WS_URL"

var _checks: int = 0
var _failures: Array[String] = []
var _main: Node = null


func _initialize() -> void:
	create_timer(WATCHDOG_SECONDS).timeout.connect(_on_watchdog)
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		print("CHECK FAILED: %s" % label)


func _observe(label: String) -> void:
	print("OBSERVED: %s" % label)


func _on_watchdog() -> void:
	print("FAIL: watchdog after %.0f seconds" % WATCHDOG_SECONDS)
	quit(1)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _find_button(node: Node, text: String) -> Button:
	if node.is_queued_for_deletion():
		return null
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _label_contains(node: Node, text: String) -> bool:
	if node.is_queued_for_deletion():
		return false
	if node is Label and (node as Label).is_visible_in_tree() and (node as Label).text.contains(text):
		return true
	for child in node.get_children():
		if _label_contains(child, text):
			return true
	return false


func _activate(button: Button) -> void:
	# Real GUI activation: focus the button, then send ui_accept press and release.
	button.grab_focus()
	var down := InputEventAction.new()
	down.action = "ui_accept"
	down.pressed = true
	root.push_input(down)
	var up := InputEventAction.new()
	up.action = "ui_accept"
	up.pressed = false
	root.push_input(up)


## Waits, in real time, until the career panel is no longer busy. Returns false on timeout.
func _wait_idle_ms(panel: Node, limit_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + limit_ms
	while Time.get_ticks_msec() < deadline:
		if not panel._busy:
			return true
		await process_frame
	return not panel._busy


## The global toast (the HUD message label), or null.
func _toast(proto: Node) -> Label:
	var label = proto.ui._hud.get("message")
	if label is Label and is_instance_valid(label):
		return label
	return null


func _run() -> void:
	var url := OS.get_environment(URL_ENV).strip_edges()
	var session_path := OS.get_environment(SESSION_ENV).strip_edges()
	_check(not url.is_empty(), "NAIJA_WS_URL names an isolated world server")
	_check(not session_path.is_empty() and FileAccess.file_exists(session_path),
		"NAIJA_MULTIPLAYER_SESSION_PATH names an existing funded-owner session file")
	if _failures.size() > 0:
		_finish()
		return
	_observe("server URL: %s" % url)

	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto: Node = _main.mode_2d_instance
	_check(proto != null, "Main scene exposes the 2D session")
	if proto == null:
		_finish()
		return

	var continue_button := _find_button(_main, "Continue online life")
	_check(continue_button != null, "start screen offers 'Continue online life'")
	if continue_button != null:
		_activate(continue_button)
	var waited := 0
	while not proto.playing and waited < SESSION_WAIT_FRAMES:
		await process_frame
		waited += 1
	_check(proto.playing, "online session becomes ready from the server")
	if not proto.playing:
		_finish()
		return

	# ---- 1. Open the career panel. Its open-time search is a career command too. ----
	var careers := _find_button(_main, "Careers")
	_check(careers != null, "the Careers menu entry is offered")
	if careers != null:
		_activate(careers)
	await _frames(5)
	var panel: Node = proto.ui._career_panel
	_check(panel != null and is_instance_valid(panel), "the career panel is open")
	if panel == null or not is_instance_valid(panel):
		_finish()
		return
	_check(
		await _wait_idle_ms(panel, REPLY_WAIT_MS),
		"the career panel's open-time search is answered"
	)

	# ---- 2. Press Search until the server refuses one. Each press waits for its answer first. ----
	var presses := 0
	var refused := false
	for index in range(SEARCH_PRESSES_MAX):
		var search := _find_button(panel, "Search")
		if search == null:
			break
		_activate(search)
		presses += 1
		await _frames(2)
		await _wait_idle_ms(panel, REPLY_WAIT_MS)
		if _label_contains(panel, MESSAGE_RATE_LIMITED):
			refused = true
			break
	_check(
		refused,
		"a career search was refused by the command limit within %d presses" % SEARCH_PRESSES_MAX
	)
	_observe("career searches sent before the refusal: %d" % presses)
	if not refused:
		_finish()
		return

	# ---- 3. The refusal is shown in the panel, and nothing is left busy. ----
	_check(not panel._busy, "the career panel is not busy after the refusal")
	var search_again := _find_button(panel, "Search")
	_check(
		search_again != null and not search_again.disabled,
		"Search is enabled again after the refusal"
	)
	_check(
		_label_contains(panel, MESSAGE_RATE_LIMITED),
		"the career panel shows the server's rate_limited message"
	)
	_check(
		not _label_contains(panel, MESSAGE_WAITING),
		"the career panel does not still say it is waiting"
	)
	_check(proto._career_request_id.is_empty(),
		"the in-flight career request ID was cleared by the matched refusal")
	var toast := _toast(proto)
	_check(
		toast != null and toast.text.contains("Too many commands"),
		"the global toast shows the refusal"
	)

	# ---- 4. After the window resets, a career search is answered and the panel works again. ----
	await _frames(1)
	var reset_deadline := Time.get_ticks_msec() + WINDOW_RESET_MS
	while Time.get_ticks_msec() < reset_deadline:
		await process_frame
	var recovery := _find_button(panel, "Search")
	_check(recovery != null, "Search is offered for the recovery search")
	if recovery != null:
		_activate(recovery)
	await _frames(2)
	_check(
		await _wait_idle_ms(panel, REPLY_WAIT_MS),
		"the recovery search is answered within %d ms" % REPLY_WAIT_MS
	)
	_check(not _label_contains(panel, MESSAGE_RATE_LIMITED),
		"the recovery search is not refused (the panel no longer shows the refusal)")
	_check(not panel._notice.begins_with(MESSAGE_WAITING), "the recovery search has a server answer")
	_observe("panel notice after recovery: %s" % panel._notice)

	# ---- 5. A refusal with another request ID does not reach the career panel. ----
	# Synthetic error delivered to the game's dispatch (see the header). The career panel is idle here.
	var notice_before: String = panel._notice
	var busy_before: bool = panel._busy
	proto._on_online_message({
		"type": "error",
		"code": "rate_limited",
		"message": MESSAGE_RATE_LIMITED,
		"requestId": "business-request-not-career",
	})
	await _frames(2)
	_check(
		panel._notice == notice_before,
		"a refusal with another request ID leaves the career notice unchanged"
	)
	_check(
		panel._busy == busy_before,
		"a refusal with another request ID does not change the career busy state"
	)
	_check(
		proto._career_request_id.is_empty(),
		"a refusal with another request ID does not set a career request"
	)

	_finish()


func _finish() -> void:
	if _failures.is_empty():
		print("PASS: %d career command-limit UI checks (headless, simulated input)" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d checks failed" % [_failures.size(), _checks])
		for label in _failures:
			print("  - %s" % label)
		quit(1)
