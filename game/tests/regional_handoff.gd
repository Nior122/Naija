extends SceneTree

# Stage 29 F5 headless test: the regional handoff from the 2D client to the 3D world.
# Run with Godot 4.7.2 from the game/ directory:
#   godot --headless --path game --script res://tests/regional_handoff.gd
# STATUS: NOT RUN. Godot 4.7.2 was unavailable when this file was written.
# It exercises the real SceneSwitcher, World3DController, and EnvironmentConfig scripts and the
# real world_3d.tscn scene. It does not test the 2D client, which needs the full prototype scene.

const SceneSwitcherScript = preload("res://3d_world/scripts/scene_switcher.gd")
const WORLD_SCENE = preload("res://3d_world/scenes/world_3d.tscn")
const CharacterStateScript = preload("res://scripts/domain/character_state.gd")
const WorldClockScript = preload("res://scripts/domain/world_clock.gd")

## The documented default for a 3D world with no located region (controller export).
const DEFAULT_REGION := "ng:state:on"
const LOCATED_REGION := "ng:state:bo"
const OTHER_REGION := "ng:state:la"
## Not an explicit record: resolved through the forest biome mapping (owner decision D2).
const MAPPED_REGION := "ng:state:ek"

var _failures: Array[String] = []
var _checks: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_test_region_from_character()
	_test_switcher_payload()
	_test_valid_handoff_reaches_controller()
	_test_refused_regions_keep_located_region()
	_test_missing_region_uses_documented_default()
	_test_repeated_transitions_do_not_carry_region()
	_test_mapped_region_resolves_to_its_profile()
	_test_character_and_clock_round_trip()
	if _failures.is_empty():
		print("PASS: %d Stage 29 F5 handoff checks" % _checks)
		quit(0)
	else:
		for failure in _failures:
			push_error(failure)
		print("FAIL: %d of %d Stage 29 F5 handoff checks" % [_failures.size(), _checks])
		quit(1)


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)


func _new_world():
	# Untyped on purpose: script members are read directly, which a typed Node3D cannot do.
	var world = WORLD_SCENE.instantiate()
	root.add_child(world)
	return world


func _discard(node) -> void:
	root.remove_child(node)
	node.free()


func _sky(config) -> Color:
	var world_env = config.get_node("WorldEnvironment")
	return world_env.environment.background_color


func _test_region_from_character() -> void:
	var located := {"geographic_location": {"region_id": "ng:region:x", "state_id": LOCATED_REGION}}
	_check(SceneSwitcherScript.region_id_from_character(located) == LOCATED_REGION,
		"A located character yields its canonical state_id, not the default")
	_check(SceneSwitcherScript.region_id_from_character({}) == "",
		"A character with no geographic_location yields an empty region")
	_check(SceneSwitcherScript.region_id_from_character({"geographic_location": {}}) == "",
		"An empty geographic_location yields an empty region")
	_check(SceneSwitcherScript.region_id_from_character({"geographic_location": "Ondo"}) == "",
		"A non-dictionary geographic_location yields an empty region")
	_check(SceneSwitcherScript.region_id_from_character(
		{"geographic_location": {"state_id": 42}}) == "",
		"A non-string state_id yields an empty region")


func _test_switcher_payload() -> void:
	# A stub 3D instance records what the switcher hands it. The switcher method is the real one.
	var stub_script := GDScript.new()
	stub_script.source_code = "extends Node\nvar received: Dictionary = {}\n" \
		+ "func set_shared_state(state: Dictionary) -> void:\n\treceived = state\n"
	_check(stub_script.reload() == OK, "Stub receiver script compiles")
	var receiver := Node.new()
	receiver.set_script(stub_script)

	var switcher = SceneSwitcherScript.new()
	switcher.mode_3d_instance = receiver
	switcher.shared_world_state = {"time": 10}
	switcher.shared_character_data = {
		"player_id": "p1", "geographic_location": {"state_id": LOCATED_REGION},
	}
	switcher._restore_3d_state()
	var payload: Dictionary = receiver.get("received")
	_check(payload.get("region_id", "") == LOCATED_REGION,
		"The 3D restore payload carries the located region in top-level region_id")
	_check(payload.get("character", {}).get("player_id", "") == "p1",
		"The 3D restore payload still carries the character (no unrelated change)")
	_check(payload.get("world", {}).get("time", 0) == 10,
		"The 3D restore payload still carries the world state (no unrelated change)")

	# Repeated transition: the location was cleared, so no region from the earlier payload survives.
	switcher.shared_character_data = {"player_id": "p1"}
	switcher._restore_3d_state()
	payload = receiver.get("received")
	_check(payload.get("region_id", "x") == "",
		"After the location is cleared, the next payload carries no region")

	switcher.free()
	receiver.free()


func _test_valid_handoff_reaches_controller() -> void:
	var world = _new_world()
	var config = world.environment_config
	var on: Dictionary = config.regional_profiles[DEFAULT_REGION]
	var bo: Dictionary = config.regional_profiles[LOCATED_REGION]

	# Initialization order: _ready applies the default first, then the handoff supersedes it.
	_check(world.region_id == DEFAULT_REGION, "Before the handoff the controller holds the default")
	_check(_sky(config).is_equal_approx(on["sky_color"]),
		"Before the handoff the default profile is applied")

	world.set_shared_state({"character": {}, "world": {}, "region_id": LOCATED_REGION})
	_check(world.region_id == LOCATED_REGION, "A valid handed region reaches the controller")
	_check(world.region_id != DEFAULT_REGION, "A valid region is not replaced by the default")
	_check(_sky(config).is_equal_approx(bo["sky_color"]),
		"The located region's sky colour reaches the WorldEnvironment")
	_check(config.climate == bo["climate"], "The located region's climate is applied")
	_check(is_equal_approx(config.ambient_light_energy, float(bo["ambient_energy"])),
		"The located region's ambient energy is applied")

	# Calling the same application path again keeps the located region.
	config.apply_region_profile(world.region_id)
	_check(_sky(config).is_equal_approx(bo["sky_color"]),
		"Re-applying the controller's region keeps the located profile")
	_discard(world)


func _test_refused_regions_keep_located_region() -> void:
	var world = _new_world()
	var config = world.environment_config
	var bo: Dictionary = config.regional_profiles[LOCATED_REGION]
	world.set_shared_state({"region_id": LOCATED_REGION})

	for bad in ["ng:state:zz", "", "ng:state:od", "not-a-region"]:
		world.set_shared_state({"region_id": bad})
		_check(world.region_id == LOCATED_REGION,
			"Refused region '%s' keeps the located region" % bad)
		_check(_sky(config).is_equal_approx(bo["sky_color"]),
			"Refused region '%s' leaves the located visuals unchanged" % bad)

	world.set_shared_state({"region_id": 42})
	_check(world.region_id == LOCATED_REGION, "A non-string region is ignored, not applied")
	_discard(world)


func _test_missing_region_uses_documented_default() -> void:
	var world = _new_world()
	var config = world.environment_config
	var on: Dictionary = config.regional_profiles[DEFAULT_REGION]
	world.set_shared_state({"character": {}, "world": {}})
	_check(world.region_id == DEFAULT_REGION,
		"A missing region keeps the documented default, and the default is not guessed away")
	_check(_sky(config).is_equal_approx(on["sky_color"]),
		"A missing region applies the documented default profile")
	world.set_shared_state({"character": {}, "world": {}, "region_id": ""})
	_check(world.region_id == DEFAULT_REGION, "An empty region keeps the documented default")
	_discard(world)


func _test_repeated_transitions_do_not_carry_region() -> void:
	# The switcher instantiates a fresh 3D world on every switch, so a new world starts on the
	# default and only takes a region from the current handoff.
	var first = _new_world()
	first.set_shared_state({"region_id": OTHER_REGION})
	_check(first.region_id == OTHER_REGION, "The first world takes its handed region")
	first.set_shared_state({"region_id": OTHER_REGION})
	_check(first.region_id == OTHER_REGION, "A repeated handoff of the same region is a no-op")
	_discard(first)

	var second = _new_world()
	second.set_shared_state({"character": {}, "world": {}})
	_check(second.region_id == DEFAULT_REGION,
		"A new world does not inherit the previous world's region")
	_discard(second)


func _test_mapped_region_resolves_to_its_profile() -> void:
	# A region with no explicit record resolves through its biome, and the controller applies it.
	var world = _new_world()
	var config = world.environment_config
	var resolved: Dictionary = config.resolve_region_profile(MAPPED_REGION)
	_check(resolved.get("source", "") == "biome" and resolved.get("biome", "") == "forest",
		"A mapped region resolves through its biome (ng:state:ek is forest)")
	world.set_shared_state({"region_id": MAPPED_REGION})
	_check(world.region_id == MAPPED_REGION, "A mapped region is accepted by the controller")
	if resolved.has("profile"):
		_check(config.climate == resolved["profile"].get("climate", ""),
			"The mapped region's climate is applied from its resolved profile")
	_discard(world)


func _test_character_and_clock_round_trip() -> void:
	# Real domain methods only: to_dictionary() and load_dictionary(). The clock is restored first,
	# and the character uses its calendar date, as prototype_game.gd does.
	var clock = WorldClockScript.new()
	clock.day = 37
	clock.minute_of_day = 14 * 60 + 5
	var character = CharacterStateScript.new()
	character.player_id = "round-trip-player"
	character.geographic_location = {"state_id": LOCATED_REGION}
	var clock_data: Dictionary = clock.to_dictionary()
	var character_data: Dictionary = character.to_dictionary()

	var restored_clock = WorldClockScript.new()
	restored_clock.load_dictionary(clock_data)
	_check(restored_clock.day == 37 and restored_clock.minute_of_day == 14 * 60 + 5,
		"The clock restores its day and minute from to_dictionary()")
	_check(restored_clock.calendar_date() == clock.calendar_date(),
		"The restored clock has the same calendar date")

	var restored_character = CharacterStateScript.new()
	restored_character.load_dictionary(character_data, restored_clock.calendar_date())
	_check(restored_character.player_id == "round-trip-player",
		"The character restores its identity from to_dictionary()")
	_check(restored_character.geographic_location.get("state_id", "") == LOCATED_REGION,
		"The character restores its located state_id")
	_check(SceneSwitcherScript.region_id_from_character(restored_character.to_dictionary())
		== LOCATED_REGION,
		"The handed region survives a character save round trip")
