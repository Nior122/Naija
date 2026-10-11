extends Node
class_name SceneSwitcher

## Scene Switcher for Naija: One World
## Manages switching between 2D and 3D game modes

# Scene references
@export var mode_2d_scene: PackedScene = preload("res://scenes/prototype.tscn")
@export var mode_3d_scene: PackedScene = preload("res://3d_world/scenes/world_3d.tscn")

# Current mode
var current_mode: String = "2d"  # "2d" or "3d"
var mode_2d_instance: Node = null
var mode_3d_instance: Node = null

# Shared state (preserved across mode switches)
var shared_character_data: Dictionary = {}
var shared_world_state: Dictionary = {}

# Signals
signal mode_changed(new_mode: String)
signal scene_loaded(scene_name: String)

func _ready() -> void:
	"""Initialize the scene switcher"""
	print("[SceneSwitcher] Initializing hybrid 2D/3D system")
	
	# Start in 2D mode by default
	switch_to_2d()

func _unhandled_input(event: InputEvent) -> void:
	"""Handle input for mode switching"""
	# Press F3 to toggle between 2D and 3D modes
	if event.is_action_pressed("toggle_3d_mode"):
		if current_mode == "2d":
			switch_to_3d()
		else:
			switch_to_2d()

func switch_to_2d() -> void:
	"""Switch to 2D mode"""
	print("[SceneSwitcher] Switching to 2D mode")
	
	# Save 3D state if coming from 3D
	if current_mode == "3d" and mode_3d_instance:
		_save_3d_state()
	
	# Unload 3D scene. The 3D world is released; the 2D session is not touched here.
	if mode_3d_instance:
		mode_3d_instance.queue_free()
		mode_3d_instance = null
	
	if mode_2d_instance:
		# Resume the retained 2D session. Its character, clock, and unsaved progress are the live
		# objects it kept while suspended, so nothing is handed back or reloaded.
		mode_2d_instance.resume_session()
	else:
		# First start only: create the 2D session and restore any shared state.
		mode_2d_instance = mode_2d_scene.instantiate()
		$Mode2D.add_child(mode_2d_instance)
		_restore_2d_state()
	
	current_mode = "2d"
	emit_signal("mode_changed", "2d")
	emit_signal("scene_loaded", "prototype_2d")

func switch_to_3d() -> void:
	"""Switch to 3D mode"""
	print("[SceneSwitcher] Switching to 3D mode")
	
	# Save 2D state if coming from 2D
	if current_mode == "2d" and mode_2d_instance:
		_save_2d_state()
	
	# Suspend the 2D session instead of freeing it. The instance keeps its character, clock, and
	# unsaved progress, and it is resumed by switch_to_2d().
	if mode_2d_instance:
		mode_2d_instance.suspend_session()
	
	# Load 3D scene
	if not mode_3d_instance:
		mode_3d_instance = mode_3d_scene.instantiate()
		$Mode3D.add_child(mode_3d_instance)
		
		# Restore shared state
		_restore_3d_state()
	
	current_mode = "3d"
	emit_signal("mode_changed", "3d")
	emit_signal("scene_loaded", "world_3d")

func _save_2d_state() -> void:
	"""Save state from 2D scene before switching"""
	print("[SceneSwitcher] Saving 2D state")
	
	if mode_2d_instance and mode_2d_instance.has_method("get_shared_state"):
		var state = mode_2d_instance.get_shared_state()
		shared_character_data = state.get("character", {})
		shared_world_state = state.get("world", {})

func _save_3d_state() -> void:
	"""Save state from 3D scene before switching"""
	print("[SceneSwitcher] Saving 3D state")
	
	if mode_3d_instance and mode_3d_instance.has_method("get_shared_state"):
		var state = mode_3d_instance.get_shared_state()
		# Merge with existing shared state
		shared_character_data.merge(state.get("character", {}), true)
		shared_world_state.merge(state.get("world", {}), true)

func _restore_2d_state() -> void:
	"""Restore state to 2D scene after loading"""
	print("[SceneSwitcher] Restoring 2D state")
	
	if mode_2d_instance and mode_2d_instance.has_method("set_shared_state"):
		mode_2d_instance.set_shared_state({
			"character": shared_character_data,
			"world": shared_world_state
		})

func _restore_3d_state() -> void:
	"""Restore state to 3D scene after loading"""
	print("[SceneSwitcher] Restoring 3D state")
	
	# The 3D controller reads the region from top-level "region_id". It validates the value
	# itself. An empty value means the character has no located region.
	if mode_3d_instance and mode_3d_instance.has_method("set_shared_state"):
		mode_3d_instance.set_shared_state({
			"character": shared_character_data,
			"world": shared_world_state,
			"region_id": region_id_from_character(shared_character_data)
		})

static func region_id_from_character(character_data: Dictionary) -> String:
	"""Return the canonical state ID (ng:state:<code>) of the character's located position.

	The 2D client keeps its position in character.geographic_location, and the state_id there is
	the same ID the 3D visual profiles use. A missing or malformed value returns "" rather than a
	guessed region."""
	var location: Variant = character_data.get("geographic_location", {})
	if not location is Dictionary:
		return ""
	var state_id: Variant = location.get("state_id", "")
	if state_id is String:
		return state_id
	return ""

func get_current_mode() -> String:
	"""Get the current game mode"""
	return current_mode

func is_3d_mode_active() -> bool:
	"""Check if 3D mode is currently active"""
	return current_mode == "3d"


func get_multiplayer_client() -> Node:
	"""Get the multiplayer client from the current mode"""
	if current_mode == "2d" and mode_2d_instance:
		# Try to get multiplayer client from 2D prototype
		if mode_2d_instance.has_method("get_multiplayer_client"):
			return mode_2d_instance.get_multiplayer_client()
		# Otherwise look for it as a child
		var client = mode_2d_instance.get_node_or_null("MultiplayerClient")
		if client:
			return client
	return null
