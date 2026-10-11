extends SceneTree

# Input binding check (headless, reads project settings and the live InputMap; does not send input).
# Run from the repository root with Godot 4.7.2:
#   godot --headless --path game --script res://tests/input_bindings_headless.gd
#
# It checks that:
#   - each action the game uses is defined: every literal action name in game/**/*.gd is either in project.godot
#     or created by the 2D prototype's _bind_action(...) calls (movement, run, and interact are created that way at
#     runtime, so they are not in project.godot);
#   - the configured keys are the intended ones: toggle_3d_mode = physical F3, jump = Space,
#     toggle_first_person = V (jump and toggle_first_person are defaults the owner has not yet confirmed);
#   - no physical key is bound to two of the project's own actions.
# It reports (does not fail on) whether Godot's built-in ui_accept also uses Space.

const ACTION_CALLS := [
	"is_action_pressed", "is_action_just_pressed", "is_action_released", "is_action_just_released",
	"action_get_events", "get_action_strength", "get_action_raw_strength",
]

var _failures: Array[String] = []
var _checks: int = 0
var _referenced: Dictionary = {}


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)


func _run() -> void:
	_check_configured_keys()
	_check_referenced_actions_exist()
	_check_no_key_conflicts()
	_check_space_contexts()
	_observe_builtin_space()
	if _failures.is_empty():
		print("PASS: %d input binding checks (%d action names referenced in game scripts)" % [_checks, _referenced.size()])
		quit(0)
	else:
		for failure in _failures:
			push_error("Input binding check failed: %s" % failure)
		print("FAIL: %d of %d input binding checks" % [_failures.size(), _checks])
		quit(1)


func _first_key(action: String) -> InputEventKey:
	if not InputMap.has_action(action):
		return null
	for event in InputMap.action_get_events(action):
		if event is InputEventKey:
			return event as InputEventKey
	return null


func _key_code(event: InputEventKey) -> int:
	return event.physical_keycode if event.physical_keycode != 0 else event.keycode


func _check_configured_keys() -> void:
	var expected := {"toggle_3d_mode": KEY_F3, "jump": KEY_SPACE, "toggle_first_person": KEY_V}
	for action in expected:
		var key := _first_key(action)
		_check(key != null, "%s has a key binding in the InputMap" % action)
		if key != null:
			_check(_key_code(key) == expected[action],
				"%s is bound to keycode %d (expected %d)" % [action, _key_code(key), expected[action]])
	var setting: Variant = ProjectSettings.get_setting("input/toggle_3d_mode", {})
	_check(setting is Dictionary and (setting as Dictionary).get("events", []).size() == 1,
		"project.godot defines exactly one event for toggle_3d_mode")


func _collect_scripts(dir_path: String, out: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not name.begins_with("."):
			var child := dir_path.path_join(name)
			if dir.current_is_dir():
				_collect_scripts(child, out)
			elif name.ends_with(".gd"):
				out.append(child)
		name = dir.get_next()
	dir.list_dir_end()


func _check_referenced_actions_exist() -> void:
	var scripts: Array[String] = []
	_collect_scripts("res://", scripts)
	_check(scripts.size() > 0, "the game scripts were found for the scan")
	var patterns: Array[RegEx] = []
	for call in ACTION_CALLS:
		var re := RegEx.new()
		re.compile(call + "\\(\\s*\"([^\"]+)\"")
		patterns.append(re)
	var assign := RegEx.new()
	assign.compile("\\.action\\s*=\\s*\"([^\"]+)\"")
	patterns.append(assign)
	var axis := RegEx.new()
	axis.compile("get_axis\\(\\s*\"([^\"]+)\"\\s*,\\s*\"([^\"]+)\"")
	var vector := RegEx.new()
	vector.compile("get_vector\\(\\s*\"([^\"]+)\"\\s*,\\s*\"([^\"]+)\"\\s*,\\s*\"([^\"]+)\"\\s*,\\s*\"([^\"]+)\"")
	for path in scripts:
		var text := FileAccess.get_file_as_string(path)
		for re in patterns:
			for m in re.search_all(text):
				_referenced[m.get_string(1)] = path
		for m in axis.search_all(text):
			_referenced[m.get_string(1)] = path
			_referenced[m.get_string(2)] = path
		for m in vector.search_all(text):
			for group in range(1, 5):
				_referenced[m.get_string(group)] = path
	# Actions created in code. Each _bind_action("name", ...) call adds the action to the InputMap at runtime.
	var bind := RegEx.new()
	bind.compile("_bind_action\\(\\s*\"([^\"]+)\"")
	var code_defined: Dictionary = {}
	for path in scripts:
		for m in bind.search_all(FileAccess.get_file_as_string(path)):
			code_defined[m.get_string(1)] = path
	_check(code_defined.size() > 0, "the scan found the runtime action bindings in code")
	for action in _referenced:
		var defined := InputMap.has_action(action) or code_defined.has(action)
		_check(defined, "action '%s' used in %s is defined in project.godot or bound in code" % [action, str(_referenced[action])])
	_check(_referenced.has("jump") and _referenced.has("toggle_first_person"),
		"the scan found the jump and toggle_first_person references")


func _check_no_key_conflicts() -> void:
	var owners: Dictionary = {}
	for property in ProjectSettings.get_property_list():
		var name: String = property["name"]
		if not name.begins_with("input/"):
			continue
		var action := name.trim_prefix("input/")
		# Godot's built-in ui_* actions share keys by design. The conflict rule covers the project's own actions only.
		if action.begins_with("ui_"):
			continue
		var key := _first_key(action)
		if key == null:
			continue
		var code := _key_code(key)
		if not owners.has(code):
			owners[code] = []
		(owners[code] as Array).append(action)
	for code in owners:
		_check((owners[code] as Array).size() == 1,
			"physical key %d is bound to more than one project action: %s" % [code, str(owners[code])])


func _count_gui_nodes(node: Node) -> int:
	var count := 1 if (node is Control or node is CanvasLayer) else 0
	for child in node.get_children():
		count += _count_gui_nodes(child)
	return count


# Space is bound to the project's jump action and, through Godot's built-in ui_accept, to UI activation.
# The two are kept apart by context: the only reader of jump is the 3D character, and the 3D world scene
# has no GUI node that could consume ui_accept. This is a structural check; it does not send input, and the
# 2D modal gate that blocks switching to 3D while a dialog is open is not covered here.
func _check_space_contexts() -> void:
	var jump_readers: Array[String] = []
	var scripts: Array[String] = []
	_collect_scripts("res://", scripts)
	var jump_read := RegEx.new()
	jump_read.compile("is_action_(just_)?pressed\\(\\s*\"jump\"")
	for path in scripts:
		if jump_read.search(FileAccess.get_file_as_string(path)) != null:
			jump_readers.append(path)
	_check(jump_readers == ["res://3d_world/scripts/character_3d.gd"],
		"only the 3D character reads the jump action (found %s)" % str(jump_readers))
	var packed := load("res://3d_world/scenes/world_3d.tscn") as PackedScene
	_check(packed != null, "the 3D world scene loads for the context check")
	if packed != null:
		var root := packed.instantiate()
		var gui_nodes := _count_gui_nodes(root)
		root.free()
		_check(gui_nodes == 0,
			"the 3D world scene has no GUI node that could consume ui_accept (found %d)" % gui_nodes)


func _observe_builtin_space() -> void:
	# Observation only. Godot's built-in ui_accept may also use Space; that is a design question, not a test failure.
	var accept_space := false
	for event in InputMap.action_get_events("ui_accept"):
		if event is InputEventKey and _key_code(event as InputEventKey) == KEY_SPACE:
			accept_space = true
	print("OBSERVED: ui_accept also uses Space: %s" % str(accept_space))
