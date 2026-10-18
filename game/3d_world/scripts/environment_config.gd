extends Node3D
class_name EnvironmentConfig

## Environment Configuration for Naija: One World
## Connects regional environment data to 3D visual settings.
##
## This script is the single source of regional visual settings. Region IDs must match the
## authoritative catalog (game/data/geography/regional-catalog.json).
## A region resolves in this order:
##   1. an explicit record in regional_profiles;
##   2. the biome preset given by REGION_BIOME, which references an explicit record;
##   3. otherwise DEFAULT_BIOME, applied with a warning.
## See docs/STAGE_29_REGIONAL_VISUAL_PROFILES_AUDIT.md.

## Biome used for regions that have no record and no mapping. Explicit, not silent.
const DEFAULT_BIOME := "forest"

## Upper bound on remembered warning keys, so repeated bad input cannot grow memory without limit.
const MAX_WARNED_KEYS := 64

## Keys every visual record must have. They mirror the keys read by _apply_complete and
## _apply_to_world_environment.
const REQUIRED_KEYS := [
	"climate", "terrain", "sky_color", "fog_color", "fog_density",
	"ambient_color", "ambient_energy", "building_density", "vegetation",
]

## Biome preset name -> explicit record that defines it. Presets hold no numeric values of
## their own.
const BIOME_PRESET_SOURCE := {
	"coastal": "ng:state:la",
	"forest": "ng:state:on",
	"savanna": "ng:state:kd",
	"arid": "ng:state:bo",
	"montane": "ng:state:pl",
}

## Catalog regions with no explicit record, mapped to one biome preset each.
## Rule, verified by tests against the authoritative non-visual data, applied in this order:
## coastal terrain -> coastal; montane climate -> montane; arid climate -> arid; forest terrain ->
## forest; savanna terrain -> savanna. Plateau terrain (tropical) -> forest is a provisional
## approximation (owner decision D2) for ng:state:ek, ng:state:en, and ng:state:ta. Their
## authoritative classification stays tropical plateau. A dedicated tropical-plateau preset may be
## considered in a future stage.
const REGION_BIOME := {
	"ng:state:ab": "forest",
	"ng:state:ad": "savanna",
	"ng:state:ak": "coastal",
	"ng:state:an": "forest",
	"ng:state:ba": "savanna",
	"ng:state:by": "coastal",
	"ng:state:be": "savanna",
	"ng:state:cr": "forest",
	"ng:state:de": "coastal",
	"ng:state:eb": "forest",
	"ng:state:ed": "forest",
	"ng:state:ek": "forest",
	"ng:state:en": "forest",
	"ng:state:fc": "savanna",
	"ng:state:go": "savanna",
	"ng:state:im": "forest",
	"ng:state:ji": "savanna",
	"ng:state:kn": "savanna",
	"ng:state:kt": "savanna",
	"ng:state:ke": "savanna",
	"ng:state:ko": "savanna",
	"ng:state:kw": "savanna",
	"ng:state:na": "savanna",
	"ng:state:ni": "savanna",
	"ng:state:og": "forest",
	"ng:state:os": "forest",
	"ng:state:oy": "savanna",
	"ng:state:ri": "coastal",
	"ng:state:so": "arid",
	"ng:state:ta": "forest",
	"ng:state:yo": "arid",
	"ng:state:za": "savanna",
}

# Regional settings
@export var region_id: String = "ng:state:on"  # Ondo State (Akure South)
@export var climate: String = "tropical"
@export var terrain: String = "forest"
@export var building_density: String = "medium"
@export var vegetation_density: String = "moderate"

# Visual settings. The defaults equal the forest preset values.
var sky_color: Color = Color(0.5, 0.7, 0.9)
var fog_color: Color = Color(0.7, 0.75, 0.8)
var fog_density: float = 0.001
var ambient_light_color: Color = Color(0.6, 0.65, 0.75)
var ambient_light_energy: float = 0.4

# Explicit visual records, keyed by catalog region ID. Filled by _load_regional_profiles().
var regional_profiles: Dictionary = {}

var _warned_keys: Dictionary = {}
var _warned_missing_world_env := false
var _owns_environment := false

# Signals
signal profile_applied(profile_name: String)
signal climate_changed(new_climate: String)
signal terrain_changed(new_terrain: String)

func _ready() -> void:
	"""Initialize environment configuration"""
	print("[EnvironmentConfig] Loading regional profiles")
	_load_regional_profiles()

	# Apply the default region's profile
	apply_region_profile(region_id)

func _load_regional_profiles() -> void:
	"""Load explicit visual records. Invalid records are skipped with one warning each.
	They never abort loading."""
	var records := {
		"ng:state:la": {  # Lagos - Coastal Urban (coastal preset)
			"climate": "tropical",
			"terrain": "coastal",
			"sky_color": Color(0.55, 0.75, 0.95),
			"fog_color": Color(0.75, 0.8, 0.85),
			"fog_density": 0.0015,
			"ambient_color": Color(0.65, 0.7, 0.8),
			"ambient_energy": 0.45,
			"building_density": "high",
			"vegetation": "sparse"
		},
		"ng:state:on": {  # Ondo - Forest/Suburban (forest preset). Key corrected: see audit F1.
			"climate": "tropical",
			"terrain": "forest",
			"sky_color": Color(0.5, 0.7, 0.9),
			"fog_color": Color(0.7, 0.75, 0.8),
			"fog_density": 0.001,
			"ambient_color": Color(0.6, 0.65, 0.75),
			"ambient_energy": 0.4,
			"building_density": "medium",
			"vegetation": "moderate"
		},
		"ng:state:kd": {  # Kaduna - Savanna (savanna preset)
			"climate": "semi-arid",
			"terrain": "savanna",
			"sky_color": Color(0.6, 0.75, 0.9),
			"fog_color": Color(0.8, 0.75, 0.7),
			"fog_density": 0.0008,
			"ambient_color": Color(0.7, 0.65, 0.6),
			"ambient_energy": 0.5,
			"building_density": "medium",
			"vegetation": "sparse"
		},
		"ng:state:bo": {  # Borno - Arid (arid preset)
			"climate": "arid",
			"terrain": "savanna",
			"sky_color": Color(0.7, 0.8, 0.9),
			"fog_color": Color(0.85, 0.8, 0.7),
			"fog_density": 0.0005,
			"ambient_color": Color(0.75, 0.7, 0.65),
			"ambient_energy": 0.55,
			"building_density": "low",
			"vegetation": "very_sparse"
		},
		"ng:state:pl": {  # Plateau - Montane (montane preset)
			"climate": "montane",
			"terrain": "plateau",
			"sky_color": Color(0.45, 0.65, 0.85),
			"fog_color": Color(0.65, 0.7, 0.8),
			"fog_density": 0.002,
			"ambient_color": Color(0.55, 0.6, 0.7),
			"ambient_energy": 0.35,
			"building_density": "low",
			"vegetation": "dense"
		},
	}

	regional_profiles = {}
	for record_id in records:
		var problem := validate_profile(records[record_id])
		if problem == "":
			regional_profiles[record_id] = records[record_id]
		else:
			_warn_once("invalid:" + record_id,
					"Skipping invalid visual record %s: %s" % [record_id, problem])

	_check_mapping_references()

func _check_mapping_references() -> void:
	"""Warn once for mappings that point at a missing preset or record. Lookup already treats
	them as unresolved."""
	for preset in BIOME_PRESET_SOURCE:
		var source_id: String = BIOME_PRESET_SOURCE[preset]
		if not regional_profiles.has(source_id):
			_warn_once("preset:" + preset,
					"Biome preset '%s' references missing or invalid record %s"
					% [preset, source_id])
	for mapped_region in REGION_BIOME:
		var preset: String = REGION_BIOME[mapped_region]
		if not BIOME_PRESET_SOURCE.has(preset):
			_warn_once("map:" + mapped_region,
					"Region %s maps to unknown biome '%s'" % [mapped_region, preset])
		if regional_profiles.has(mapped_region):
			_warn_once("shadow:" + mapped_region,
					"Region %s has both a record and a biome mapping; the record wins" % mapped_region)

func validate_profile(profile: Dictionary) -> String:
	"""Return an empty string when a visual record is complete and in range. Otherwise return
	the reason it is not."""
	for key in REQUIRED_KEYS:
		if not profile.has(key):
			return "missing key '%s'" % key
	for color_key in ["sky_color", "fog_color", "ambient_color"]:
		var color_problem := _color_problem(profile[color_key], color_key)
		if color_problem != "":
			return color_problem
	if not _is_float_in(profile["fog_density"], 0.0, 0.01):
		return "'fog_density' must be a float in (0, 0.01]"
	if not _is_float_in(profile["ambient_energy"], 0.0, 2.0):
		return "'ambient_energy' must be a float in (0, 2]"
	for string_key in ["climate", "terrain", "building_density", "vegetation"]:
		if typeof(profile[string_key]) != TYPE_STRING or profile[string_key] == "":
			return "'%s' must be a non-empty string" % string_key
	return ""

func _color_problem(value: Variant, key: String) -> String:
	if typeof(value) != TYPE_COLOR:
		return "'%s' must be a Color" % key
	var c: Color = value
	if c.r < 0.0 or c.r > 1.0 or c.g < 0.0 or c.g > 1.0 or c.b < 0.0 or c.b > 1.0:
		return "'%s' has a component outside [0, 1]" % key
	return ""

func _is_float_in(value: Variant, low: float, high: float) -> bool:
	return typeof(value) == TYPE_FLOAT and value > low and value <= high

func resolve_region_profile(target_region_id: String) -> Dictionary:
	"""Pure lookup from constants and validated records. Returns {} when the region cannot be resolved.
	Returned keys: source ('explicit' or 'biome'), biome (empty for explicit), profile (the record)."""
	if regional_profiles.has(target_region_id):
		return {"source": "explicit", "biome": "", "profile": regional_profiles[target_region_id]}

	if REGION_BIOME.has(target_region_id):
		var biome: String = REGION_BIOME[target_region_id]
		var source_id: String = BIOME_PRESET_SOURCE.get(biome, "")
		if regional_profiles.has(source_id):
			return {"source": "biome", "biome": biome, "profile": regional_profiles[source_id]}

	return {}

func apply_region_profile(target_region_id: String) -> void:
	"""Apply the visual profile for a region. Every visual variable is set from one complete
	record, so no value from a previously applied region survives (stale-profile rule)."""
	region_id = target_region_id

	var resolved := resolve_region_profile(target_region_id)
	if resolved.is_empty():
		_warn_once("unresolved:" + target_region_id,
				"No visual record or biome mapping for %s; applying default biome '%s'"
				% [target_region_id, DEFAULT_BIOME])
		var fallback := _default_profile()
		if fallback.is_empty():
			push_error("[EnvironmentConfig] Default biome '%s' has no valid record; visuals unchanged"
					% DEFAULT_BIOME)
			return
		_apply_complete(fallback)
		return

	_apply_complete(resolved["profile"])
	emit_signal("profile_applied", target_region_id)

func _default_profile() -> Dictionary:
	"""The complete record for DEFAULT_BIOME, or an empty dictionary when it is missing or invalid."""
	var source_id: String = BIOME_PRESET_SOURCE.get(DEFAULT_BIOME, "")
	return regional_profiles.get(source_id, {})

func _apply_complete(profile: Dictionary) -> void:
	"""Set every visual variable from a complete, validated record, then push it to the scene."""
	climate = profile["climate"]
	emit_signal("climate_changed", climate)
	terrain = profile["terrain"]
	emit_signal("terrain_changed", terrain)
	sky_color = profile["sky_color"]
	fog_color = profile["fog_color"]
	fog_density = profile["fog_density"]
	ambient_light_color = profile["ambient_color"]
	ambient_light_energy = profile["ambient_energy"]
	building_density = profile["building_density"]
	vegetation_density = profile["vegetation"]

	_apply_to_world_environment()

func apply_profile(profile: Dictionary) -> void:
	"""Apply one complete visual record. Incomplete records are refused, not merged, so no value
	from a previous region can survive a partial update."""
	var problem := validate_profile(profile)
	if problem != "":
		_warn_once("refused:" + problem, "Refusing incomplete visual record: " + problem)
		return
	_apply_complete(profile)

func _apply_to_world_environment() -> void:
	"""Apply settings to the WorldEnvironment node"""
	# WorldEnvironment is a child of this node in world_3d.tscn. An earlier lookup searched the
	# parent, which never contains it, so no regional visual reached the scene (audit F13).
	var world_env := get_node_or_null("WorldEnvironment") as WorldEnvironment
	if not world_env or not world_env.environment:
		if not _warned_missing_world_env:
			_warned_missing_world_env = true
			push_warning("[EnvironmentConfig] WorldEnvironment child with an Environment "
					+ "resource not found; regional visuals are not applied")
		return

	# Copy the environment once per instance, so visuals never mutate a resource shared with
	# other scenes or presets.
	if not _owns_environment:
		world_env.environment = world_env.environment.duplicate()
		_owns_environment = true

	var env = world_env.environment

	# Update background
	env.background_color = sky_color

	# Update fog
	env.fog_light_color = fog_color
	env.fog_density = fog_density

	# Update ambient light
	env.ambient_light_color = ambient_light_color
	env.ambient_light_energy = ambient_light_energy

func _warn_once(key: String, message: String) -> void:
	"""Warn once per key. The remembered-key set is capped, so arbitrary input cannot grow it
	without limit."""
	if _warned_keys.has(key):
		return
	if _warned_keys.size() >= MAX_WARNED_KEYS:
		return
	_warned_keys[key] = true
	push_warning("[EnvironmentConfig] " + message)

func get_current_profile() -> Dictionary:
	"""Get the current environment profile"""
	return {
		"region_id": region_id,
		"climate": climate,
		"terrain": terrain,
		"sky_color": sky_color,
		"fog_color": fog_color,
		"fog_density": fog_density,
		"ambient_light_color": ambient_light_color,
		"ambient_light_energy": ambient_light_energy,
		"building_density": building_density,
		"vegetation_density": vegetation_density
	}

func set_time_of_day_effects(period: String) -> void:
	"""Apply time-of-day effects to environment"""
	# This would be called by TimeOfDay system
	match period:
		"dawn":
			sky_color = Color(0.9, 0.7, 0.6)
			fog_color = Color(0.85, 0.75, 0.7)
		"day":
			# Reset to regional profile defaults
			apply_region_profile(region_id)
		"dusk":
			sky_color = Color(0.9, 0.5, 0.4)
			fog_color = Color(0.8, 0.6, 0.5)
		"night":
			sky_color = Color(0.1, 0.15, 0.25)
			fog_color = Color(0.15, 0.2, 0.3)

	_apply_to_world_environment()
