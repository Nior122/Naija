extends Node3D
class_name World3DController

## 3D World Controller for Naija: One World
## Manages the 3D environment, buildings, characters, and regional configuration

# Regional configuration
@export var region_id: String = "ng:state:od"  # Ondo State (Akure South)
@export var environment_preset: String = "tropical_urban"

# References
var environment_config: EnvironmentConfig
var time_of_day: TimeOfDay
var player_character: CharacterBody3D
var multiplayer_manager: Multiplayer3DManager = null

# Building management
var buildings: Dictionary = {}
var active_buildings: Array[Node3D] = []

# Performance tracking
var fps_counter: int = 0
var frame_time: float = 0.0

# Signals
signal region_changed(new_region: String)
signal environment_changed(preset: String)
signal building_loaded(building_id: String)
signal character_spawned(character_id: String)

func _ready() -> void:
	"""Initialize the 3D world"""
	print("[World3D] Initializing 3D world for region: ", region_id)
	
	# Get references
	environment_config = $Environment as EnvironmentConfig
	time_of_day = $TimeOfDay as TimeOfDay
	player_character = $Characters/PlayerCharacter as CharacterBody3D
	
	# Initialize multiplayer manager
	multiplayer_manager = Multiplayer3DManager.new()
	multiplayer_manager.name = "Multiplayer3DManager"
	add_child(multiplayer_manager)
	
	# Try to get multiplayer client from parent (scene switcher)
	var scene_switcher = get_parent()
	if scene_switcher and scene_switcher.has_method("get_multiplayer_client"):
		var client = scene_switcher.get_multiplayer_client()
		if client:
			multiplayer_manager.setup(client, player_character)
			print("[World3D] Multiplayer manager initialized with client")
	
	# Configure environment based on region
	_configure_environment()
	
	# Set up initial time of day
	if time_of_day:
		time_of_day.set_time(10.0)  # 10 AM
	
	# Load initial buildings
	_load_regional_buildings()
	
	print("[World3D] 3D world initialized successfully")

func _process(delta: float) -> void:
	"""Update the 3D world each frame"""
	# Track performance
	fps_counter += 1
	frame_time = delta
	
	# Reset counter every second for FPS display
	if fps_counter >= Engine.get_frames_per_second():
		fps_counter = 0

func _configure_environment() -> void:
	"""Configure environment based on regional data"""
	if not environment_config:
		push_warning("[World3D] Environment config not found")
		return
	
	# Load regional environment profile from Stage 22 data
	var env_profile = _load_regional_environment_profile()
	if env_profile:
		environment_config.apply_profile(env_profile)
		emit_signal("environment_changed", environment_preset)

func _load_regional_environment_profile() -> Dictionary:
	"""Load environment profile for current region from Stage 22 data"""
	# This would load from game/data/geography/regional-environment-profiles.json
	# For now, return a default profile based on region
	
	var profiles = {
		"ng:state:la": {  # Lagos
			"climate": "tropical",
			"terrain": "coastal",
			"building_density": "high",
			"vegetation": "sparse",
			"ambient_sound": "urban",
			"lighting": "bright"
		},
		"ng:state:od": {  # Ondo (Akure South)
			"climate": "tropical",
			"terrain": "forest",
			"building_density": "medium",
			"vegetation": "moderate",
			"ambient_sound": "suburban",
			"lighting": "normal"
		},
		"ng:state:kd": {  # Kaduna
			"climate": "semi-arid",
			"terrain": "savanna",
			"building_density": "medium",
			"vegetation": "sparse",
			"ambient_sound": "semi-rural",
			"lighting": "bright"
		}
	}
	
	return profiles.get(region_id, profiles["ng:state:od"])

func _load_regional_buildings() -> void:
	"""Load buildings appropriate for the current region"""
	# Create sample buildings for demonstration
	_create_sample_building(Vector3(10, 0, 10), "house_residential", "Building 1")
	_create_sample_building(Vector3(-10, 0, 15), "shop_small", "Corner Shop")
	_create_sample_building(Vector3(15, 0, -10), "school_primary", "Primary School")
	_create_sample_building(Vector3(-15, 0, -15), "clinic_health", "Health Clinic")

func _create_sample_building(position: Vector3, building_type: String, building_name: String) -> void:
	"""Create a sample building at the given position"""
	var building = Node3D.new()
	building.name = building_name
	building.position = position
	
	# Create a simple box mesh for the building
	var mesh_instance = MeshInstance3D.new()
	var box_mesh = BoxMesh.new()
	
	# Vary size based on building type
	match building_type:
		"house_residential":
			box_mesh.size = Vector3(8, 4, 6)
		"shop_small":
			box_mesh.size = Vector3(5, 3, 4)
		"school_primary":
			box_mesh.size = Vector3(15, 5, 10)
		"clinic_health":
			box_mesh.size = Vector3(10, 4, 8)
	
	mesh_instance.mesh = box_mesh
	
	# Create material
	var material = StandardMaterial3D.new()
	match building_type:
		"house_residential":
			material.albedo_color = Color(0.8, 0.7, 0.6)  # Beige
		"shop_small":
			material.albedo_color = Color(0.6, 0.7, 0.8)  # Light blue
		"school_primary":
			material.albedo_color = Color(0.9, 0.8, 0.4)  # Yellow
		"clinic_health":
			material.albedo_color = Color(0.9, 0.9, 0.9)  # White
	
	mesh_instance.material_override = material
	building.add_child(mesh_instance)
	
	# Add collision
	var static_body = StaticBody3D.new()
	var collision_shape = CollisionShape3D.new()
	var shape = BoxShape3D.new()
	shape.size = box_mesh.size
	collision_shape.shape = shape
	static_body.add_child(collision_shape)
	building.add_child(static_body)
	
	# Add to buildings node
	$Buildings.add_child(building)
	active_buildings.append(building)
	
	# Store building data
	buildings[building_name] = {
		"node": building,
		"type": building_type,
		"position": position
	}
	
	emit_signal("building_loaded", building_name)

func change_region(new_region_id: String) -> void:
	"""Change to a different region"""
	if new_region_id == region_id:
		return
	
	print("[World3D] Changing region from ", region_id, " to ", new_region_id)
	region_id = new_region_id
	
	# Reconfigure environment
	_configure_environment()
	
	# Reload buildings
	_clear_buildings()
	_load_regional_buildings()
	
	emit_signal("region_changed", new_region_id)

func _clear_buildings() -> void:
	"""Remove all loaded buildings"""
	for building in active_buildings:
		if is_instance_valid(building):
			building.queue_free()
	
	active_buildings.clear()
	buildings.clear()

func spawn_npc_at(npc_id: String, position: Vector3) -> void:
	"""Spawn an NPC character at the given position"""
	# This would integrate with the existing NPC system from Stage 20
	# For now, create a placeholder
	var npc = CharacterBody3D.new()
	npc.name = "NPC_" + npc_id
	npc.position = position
	
	# Add visual representation
	var mesh_instance = MeshInstance3D.new()
	var capsule_mesh = CapsuleMesh.new()
	capsule_mesh.radius = 0.3
	capsule_mesh.height = 1.8
	mesh_instance.mesh = capsule_mesh
	
	var material = StandardMaterial3D.new()
	material.albedo_color = Color(0.5, 0.3, 0.2)  # Brown
	mesh_instance.material_override = material
	npc.add_child(mesh_instance)
	
	$Characters.add_child(npc)
	emit_signal("character_spawned", npc_id)

func get_performance_stats() -> Dictionary:
	"""Get performance statistics"""
	return {
		"fps": Engine.get_frames_per_second(),
		"frame_time": frame_time,
		"active_buildings": active_buildings.size(),
		"region": region_id
	}


func get_shared_state() -> Dictionary:
	"""Get the current 3D world state for sharing with 2D mode"""
	var state = {
		"region_id": region_id,
		"time_of_day": time_of_day.current_time if time_of_day else 10.0
	}
	
	# Get player character state if available
	if player_character and player_character.has_method("get_character_state"):
		state["player_state"] = player_character.get_character_state()
	
	return state


func set_shared_state(state: Dictionary) -> void:
	"""Restore 3D world state from 2D mode"""
	if state.is_empty():
		return
	
	# Restore region
	if state.has("region_id") and state.region_id != region_id:
		change_region(state.region_id)
	
	# Restore time of day
	if state.has("time_of_day") and time_of_day:
		time_of_day.set_time(state.time_of_day)
	
	# Restore player state
	if state.has("player_state") and player_character and player_character.has_method("apply_network_state"):
		player_character.apply_network_state(state.player_state)
