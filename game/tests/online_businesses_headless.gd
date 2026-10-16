extends SceneTree
# Stage 43 online business smoke test. HEADLESS, SIMULATED INPUT. It is not a rendered test.
#
# What it drives, through the real scene and real controls:
# - Name field and the "Create online life" / "Continue online life" button on the start screen.
# - The HUD "Businesses" button, after the server has sent the session.
# - Buttons are activated by focusing the real Button and sending ui_accept,
#   as ui_flow_headless.gd does.
#
# What it reads back: the labels the business panel shows. They come from the server's session
# and business snapshot. It does not assert balances, names, or businesses, so it does not depend
# on a world state.
#
# Needs a world server at the client's default URL (ws://127.0.0.1:3000/ws). It does not write the
# local save file, because the online path does not save locally.
#
# Run: godot --headless --path game --script res://tests/online_businesses_headless.gd

const MAIN_SCENE := preload("res://scenes/main.tscn")
const WATCHDOG_SECONDS := 150.0
const SESSION_WAIT_FRAMES := 1800
const SESSION_ENV := "NAIJA_MULTIPLAYER_SESSION_PATH"
const SESSION_FILE := "user://naija-online-businesses-test.cfg"
const PANEL_WAIT_FRAMES := 3000

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
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _find_line_edit(node: Node, placeholder: String) -> LineEdit:
	if node is LineEdit and (node as LineEdit).placeholder_text == placeholder:
		return node
	for child in node.get_children():
		var found := _find_line_edit(child, placeholder)
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


func _run() -> void:
	# A fresh session file for this run. The developer's saved session (a token from another
	# server) is not used and not touched. The path is set before the scene reads it.
	var session_path := ProjectSettings.globalize_path(SESSION_FILE)
	if FileAccess.file_exists(SESSION_FILE):
		DirAccess.remove_absolute(session_path)
	OS.set_environment(SESSION_ENV, session_path)
	_main = MAIN_SCENE.instantiate()
	root.add_child(_main)
	await _frames(3)
	var proto: Node = _main.mode_2d_instance
	_check(proto != null, "Main scene exposes the 2D session")
	if proto == null:
		_finish()
		return

	# ---- 1. Start screen: name, then online start through the real button ----
	var name_edit := _find_line_edit(_main, "Character name")
	_check(name_edit != null, "Start screen has the character name field")
	if name_edit != null:
		# A name generated per run. It is not a fixed test user.
		name_edit.text = "Smoke %d" % (Time.get_ticks_usec() % 100000)
	var client: Node = proto.multiplayer_client
	client.status_changed.connect(func(value: String): _observe("client status: %s" % value))
	client.message_received.connect(func(message: Dictionary):
		_observe("client message: %s" % str(message.get("type", ""))))
	client.error_received.connect(func(code: String, message: String):
		_observe("client error: %s (%s)" % [code, message]))
	var online := _find_button(_main, "Create online life")
	if online == null:
		online = _find_button(_main, "Continue online life")
	_check(online != null, "Start screen offers the online button")
	if online != null:
		_activate(online)
	await _frames(2)

	# ---- 2. Wait for the server's session (playing is set only once the session is ready) ----
	var waited := 0
	while not proto.playing and waited < SESSION_WAIT_FRAMES:
		await process_frame
		waited += 1
	_check(proto.playing, "Online session becomes ready from the server")
	_observe("session ready after %d frames; online mode %s" % [waited, str(proto._online_mode)])
	if not proto.playing:
		_finish()
		return
	_check(proto._online_mode, "Session is in online mode")

	# ---- 3. Open Businesses from the HUD menu ----
	var businesses := _find_button(_main, "Businesses")
	_check(businesses != null, "HUD has the Businesses button")
	if businesses != null:
		_activate(businesses)
	waited = 0
	while not _label_contains(proto.ui, "Your cash") and waited < PANEL_WAIT_FRAMES:
		await process_frame
		waited += 1
	_check(_label_contains(proto.ui, "Your cash"), "Businesses panel shows the server cash line")
	_check(_label_contains(proto.ui, "Start a business"), "Businesses panel offers the create form")
	_check(_find_button(_main, "My businesses") != null, "Businesses panel has 'My businesses' tab")
	_check(_find_button(_main, "Discover") != null, "Businesses panel has the 'Discover' tab")
	_observe("panel shows 'Your cash' after %d frames" % waited)

	# ---- 4. The state the server reports for this character, read from the panel ----
	if _label_contains(proto.ui, "You do not own or co-own a business yet"):
		_observe("server reports no owned businesses for this character")
	else:
		_observe("server reports at least one owned business for this character")

	# ---- 5. Discover tab (read only) ----
	var discover := _find_button(_main, "Discover")
	if discover != null:
		_activate(discover)
	await _frames(5)
	_check(
		_label_contains(proto.ui, "No active businesses are listed yet")
		or _find_button(_main, "Refresh list") != null,
		"Discover tab shows the server's listing or its empty state"
	)
	_finish()


func _finish() -> void:
	if _failures.is_empty():
		print("PASS: %d online business checks (headless, simulated input)" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d checks failed" % [_failures.size(), _checks])
		quit(1)
