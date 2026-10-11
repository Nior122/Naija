extends SceneTree

# Stage 29 headless test: regional visual profiles.
# Run with Godot 4.7.2 from the game/ directory:
#   godot --headless --path game --script res://tests/regional_visual_profiles.gd
# STATUS: NOT RUN. Godot 4.7.2 was unavailable when this file was written.
# It exercises the real EnvironmentConfig script, not a copy of it.

const EnvironmentConfigScript = preload("res://3d_world/scripts/environment_config.gd")
const CATALOG_PATH: String = "res://data/geography/regional-catalog.json"

var _failures: Array[String] = []
var _checks: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_test_preserved_presets()
	_test_lookup_and_mapping()
	_test_invalid_ids()
	_test_world_environment_access()
	_test_missing_world_environment()
	_test_repeated_application()
	_test_incomplete_record_refused()
	_test_validation()
	_test_catalog_coverage()
	if _failures.is_empty():
		print("PASS: %d Stage 29 visual profile checks" % _checks)
		quit(0)
	else:
		for failure in _failures:
			push_error(failure)
		print("FAIL: %d of %d Stage 29 visual profile checks" % [_failures.size(), _checks])
		quit(1)


func _new_config(with_world_env: bool) -> Node3D:
	var config: Node3D = EnvironmentConfigScript.new()
	if with_world_env:
		var world_env := WorldEnvironment.new()
		world_env.name = "WorldEnvironment"
		world_env.environment = Environment.new()
		config.add_child(world_env)
	root.add_child(config)
	return config


func _test_preserved_presets() -> void:
	var config = _new_config(true)
	var profiles: Dictionary = config.regional_profiles
	_check(profiles.size() == 5, "Exactly five explicit visual records load")
	_check(profiles.has("ng:state:on"), "Ondo record uses the corrected key ng:state:on")
	_check(not profiles.has("ng:state:od"), "Invalid key ng:state:od is not loaded")
	var la: Dictionary = profiles.get("ng:state:la", {})
	_check(la.get("sky_color", Color()).is_equal_approx(Color(0.55, 0.75, 0.95)),
		"Lagos sky colour preserved")
	var bo: Dictionary = profiles.get("ng:state:bo", {})
	_check(is_equal_approx(float(bo.get("ambient_energy", -1.0)), 0.55),
		"Borno ambient energy preserved")
	_check(profiles.get("ng:state:kd", {}).get("climate", "") == "semi-arid",
		"Kaduna climate preserved (F9 not changed)")
	_check(profiles.get("ng:state:pl", {}).get("vegetation", "") == "dense",
		"Plateau vegetation preserved")
	config.queue_free()


func _test_lookup_and_mapping() -> void:
	var config = _new_config(true)
	var explicit: Dictionary = config.resolve_region_profile("ng:state:on")
	_check(explicit.get("source", "") == "explicit", "Ondo resolves as an explicit record")
	for region in ["ng:state:ek", "ng:state:en", "ng:state:ta"]:
		var resolved: Dictionary = config.resolve_region_profile(region)
		_check(resolved.get("source", "") == "biome", "%s resolves through a biome mapping" % region)
		_check(resolved.get("biome", "") == "forest", "%s maps to forest (D2)" % region)
		_check(resolved.get("profile", {}) == config.regional_profiles["ng:state:on"],
			"%s uses the forest preset values" % region)
	var again: Dictionary = config.resolve_region_profile("ng:state:ek")
	_check(again == config.resolve_region_profile("ng:state:ek"), "Lookup is repeatable")
	config.queue_free()


func _test_invalid_ids() -> void:
	var config = _new_config(true)
	for bad in ["", "ng:state:zz", "ng:state:od", "not-a-region"]:
		_check(config.resolve_region_profile(bad).is_empty(),
			"Unknown id '%s' does not resolve" % bad)
	config.apply_region_profile("ng:state:zz")
	_check(config.climate == "tropical", "Unknown id applies the explicit default biome (forest)")
	_check(config.terrain == "forest", "Unknown id leaves a complete default terrain")
	config.queue_free()


func _test_world_environment_access() -> void:
	var config = _new_config(true)
	var world_env: WorldEnvironment = config.get_node("WorldEnvironment")
	config.apply_region_profile("ng:state:bo")
	var env: Environment = world_env.environment
	_check(env.background_color.is_equal_approx(Color(0.7, 0.8, 0.9)),
		"Borno background reaches the WorldEnvironment child")
	_check(is_equal_approx(env.fog_density, 0.0005), "Borno fog density reaches the environment")
	_check(is_equal_approx(env.ambient_light_energy, 0.55),
		"Borno ambient energy reaches the environment")
	config.queue_free()


func _test_missing_world_environment() -> void:
	var config = _new_config(false)
	# _ready() already applied the default region and set the warning flag. Clear the flag so
	# that the call below must set it again.
	config.set("_warned_missing_world_env", false)
	config.apply_region_profile("ng:state:pl")
	_check(config.get("_warned_missing_world_env") == true,
		"Applying a region with no WorldEnvironment sets the warning flag")
	_check(config.climate == "montane", "Region state still updates when the node is missing")
	config.queue_free()


func _test_repeated_application() -> void:
	var config = _new_config(true)
	var world_env: WorldEnvironment = config.get_node("WorldEnvironment")
	# Per-instance copy: the resource this instance started with must never be written to.
	var shared: Environment = world_env.environment
	var shared_background: Color = shared.background_color
	var shared_fog: float = shared.fog_density
	config.apply_region_profile("ng:state:kd")
	config.apply_region_profile("ng:state:pl")
	config.apply_region_profile("ng:state:kd")
	var env: Environment = world_env.environment
	var kd: Dictionary = config.regional_profiles["ng:state:kd"]
	_check(is_equal_approx(env.fog_density, kd["fog_density"]),
		"Re-applying Kaduna leaves no Plateau fog value")
	_check(env.background_color.is_equal_approx(kd["sky_color"]),
		"Re-applying Kaduna leaves no Plateau sky value")
	_check(config.vegetation_density == "sparse", "Vegetation state matches the last complete record")
	_check(shared.background_color.is_equal_approx(shared_background)
		and is_equal_approx(shared.fog_density, shared_fog),
		"Original Environment resource is not mutated by per-instance application")
	_check(env != shared, "The scene uses a per-instance copy of the Environment")
	config.apply_region_profile("ng:state:ek")
	_check(config.terrain == "forest", "Mapped region applies the forest preset terrain")
	config.queue_free()


func _test_incomplete_record_refused() -> void:
	var config = _new_config(true)
	config.apply_region_profile("ng:state:la")
	config.apply_profile({"climate": "arid"})
	_check(config.climate == "tropical", "Incomplete record is refused, not merged")
	_check(config.terrain == "coastal", "Incomplete record leaves terrain unchanged")
	config.queue_free()


func _test_validation() -> void:
	var config = _new_config(false)
	var good: Dictionary = config.regional_profiles["ng:state:on"]
	_check(config.validate_profile(good) == "", "A complete Ondo record validates")
	var missing := good.duplicate()
	missing.erase("fog_color")
	_check(config.validate_profile(missing) != "", "A record missing a key is rejected")
	var bad_range := good.duplicate()
	bad_range["fog_density"] = 5.0
	_check(config.validate_profile(bad_range) != "", "An out-of-range fog density is rejected")
	config.queue_free()


func _test_catalog_coverage() -> void:
	var text := FileAccess.get_file_as_string(CATALOG_PATH)
	_check(text != "", "Authoritative catalog is readable")
	var catalog = JSON.parse_string(text)
	_check(catalog is Dictionary, "Authoritative catalog parses")
	if not (catalog is Dictionary):
		return
	var config = _new_config(true)
	var direct := 0
	var mapped := 0
	var fallback := 0
	for state in catalog.get("states", []):
		var id: String = state.get("id", "")
		var resolved: Dictionary = config.resolve_region_profile(id)
		if resolved.is_empty():
			fallback += 1
		elif resolved.get("source", "") == "explicit":
			direct += 1
		else:
			mapped += 1
	print("[stage29] catalog direct=%d mapped=%d fallback=%d" % [direct, mapped, fallback])
	_check(fallback == 0, "Every catalog region resolves to a record or a mapping")
	config.queue_free()


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)
