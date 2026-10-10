extends Node3D
class_name EnvironmentConfig

## Environment Configuration for Naija: One World
## Connects Stage 22 regional environment data to 3D visual settings

# Regional settings
@export var region_id: String = "ng:state:od"
@export var climate: String = "tropical"
@export var terrain: String = "forest"
@export var building_density: String = "medium"
@export var vegetation_density: String = "moderate"

# Visual settings
var sky_color: Color = Color(0.5, 0.7, 0.9)
var fog_color: Color = Color(0.7, 0.75, 0.8)
var fog_density: float = 0.001
var ambient_light_color: Color = Color(0.6, 0.65, 0.75)
var ambient_light_energy: float = 0.4

# Regional profiles loaded from Stage 22 data
var regional_profiles: Dictionary = {}

# Signals
signal profile_applied(profile_name: String)
signal climate_changed(new_climate: String)
signal terrain_changed(new_terrain: String)

func _ready() -> void:
	"""Initialize environment configuration"""
	print("[EnvironmentConfig] Loading regional profiles")
	_load_regional_profiles()
	
	# Apply default profile
	apply_region_profile(region_id)

func _load_regional_profiles() -> void:
	"""Load regional environment profiles from Stage 22 data"""
	# This would load from game/data/geography/regional-environment-profiles.json
	# For now, define profiles inline
	
	regional_profiles = {
		"ng:state:la": {  # Lagos - Coastal Urban
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
		"ng:state:od": {  # Ondo - Forest/Suburban
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
		"ng:state:kd": {  # Kaduna - Savanna
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
		"ng:state:bo": {  # Borno - Arid
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
		"ng:state:pl": {  # Plateau - Montane
			"climate": "montane",
			"terrain": "plateau",
			"sky_color": Color(0.45, 0.65, 0.85),
			"fog_color": Color(0.65, 0.7, 0.8),
			"fog_density": 0.002,
			"ambient_color": Color(0.55, 0.6, 0.7),
			"ambient_energy": 0.35,
			"building_density": "low",
			"vegetation": "dense"
		}
	}

func apply_region_profile(target_region_id: String) -> void:
	"""Apply environment profile for a specific region"""
	region_id = target_region_id
	
	if regional_profiles.has(target_region_id):
		var profile = regional_profiles[target_region_id]
		apply_profile(profile)
		emit_signal("profile_applied", target_region_id)
	else:
		push_warning("[EnvironmentConfig] No profile found for region: ", target_region_id)

func apply_profile(profile: Dictionary) -> void:
	"""Apply an environment profile"""
	# Update climate and terrain
	if profile.has("climate"):
		climate = profile.climate
		emit_signal("climate_changed", climate)
	
	if profile.has("terrain"):
		terrain = profile.terrain
		emit_signal("terrain_changed", terrain)
	
	# Update visual settings
	if profile.has("sky_color"):
		sky_color = profile.sky_color
	
	if profile.has("fog_color"):
		fog_color = profile.fog_color
	
	if profile.has("fog_density"):
		fog_density = profile.fog_density
	
	if profile.has("ambient_color"):
		ambient_light_color = profile.ambient_color
	
	if profile.has("ambient_energy"):
		ambient_light_energy = profile.ambient_energy
	
	if profile.has("building_density"):
		building_density = profile.building_density
	
	if profile.has("vegetation"):
		vegetation_density = profile.vegetation
	
	# Apply to world environment
	_apply_to_world_environment()

func _apply_to_world_environment() -> void:
	"""Apply settings to the WorldEnvironment node"""
	var world_env = get_parent().get_node_or_null("WorldEnvironment") as WorldEnvironment
	if not world_env or not world_env.environment:
		return
	
	var env = world_env.environment
	
	# Update background
	env.background_color = sky_color
	
	# Update fog
	env.fog_light_color = fog_color
	env.fog_density = fog_density
	
	# Update ambient light
	env.ambient_light_color = ambient_light_color
	env.ambient_light_energy = ambient_light_energy

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
