extends CharacterBody3D
class_name Character3D

## 3D Character Controller for Naija: One World
## Manages player movement, animation, and interaction in 3D space

# Movement settings
@export var walk_speed: float = 3.0
@export var run_speed: float = 6.0
@export var acceleration: float = 8.0
@export var deceleration: float = 10.0
@export var gravity: float = 20.0
@export var jump_velocity: float = 5.0

# Character state
var current_speed: float = 0.0
var is_running: bool = false
var is_jumping: bool = false
var movement_enabled: bool = true
var character_id: String = ""

# Interaction
var nearest_interactable: Node3D = null
var interaction_distance: float = 2.0

# Animation (placeholder - would connect to AnimationPlayer in full implementation)
var animation_state: String = "idle"

# Signals
signal moved(direction: Vector3, running: bool)
signal interacted(target: Node3D)
signal state_changed(new_state: String)

func _ready() -> void:
	"""Initialize the 3D character"""
	print("[Character3D] Character initialized at position: ", global_transform.origin)

func _physics_process(delta: float) -> void:
	"""Handle physics-based movement"""
	if not movement_enabled:
		return
	
	# Apply gravity
	if not is_on_floor():
		velocity.y -= gravity * delta
	
	# Handle jump
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
		is_jumping = true
	
	# Get input direction
	var input_dir = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var direction = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	
	# Check if running
	is_running = Input.is_action_pressed("run") and direction.length() > 0.0
	
	# Calculate target speed
	var target_speed = run_speed if is_running else walk_speed
	
	# Accelerate or decelerate
	if direction.length() > 0.0:
		current_speed = lerp(current_speed, target_speed, acceleration * delta)
		velocity.x = direction.x * current_speed
		velocity.z = direction.z * current_speed
		
		# Rotate character to face movement direction
		if current_speed > 0.1:
			var target_rotation = atan2(direction.x, direction.z)
			rotation.y = lerp_angle(rotation.y, target_rotation, 10.0 * delta)
		
		# Update animation state
		_set_animation_state("walking" if not is_running else "running")
	else:
		current_speed = lerp(current_speed, 0.0, deceleration * delta)
		velocity.x = lerp(velocity.x, 0.0, deceleration * delta)
		velocity.z = lerp(velocity.z, 0.0, deceleration * delta)
		
		# Update animation state
		if current_speed < 0.1:
			_set_animation_state("idle")
	
	# Move character
	move_and_slide()
	
	# Check for interactions
	_check_interactions()

func _check_interactions() -> void:
	"""Check for nearby interactable objects"""
	var space_state = get_world_3d().direct_space_state
	
	# Use raycast to find nearby objects
	var from = global_transform.origin
	var to = from + (-transform.basis.z) * interaction_distance
	
	var query = PhysicsRayQueryParameters3D.create(from, to)
	query.collide_with_areas = true
	query.collide_with_bodies = true
	
	var result = space_state.intersect_ray(query)
	
	if result and result.size() > 0:
		var collider = result.collider
		if collider.has_method("interact"):
			nearest_interactable = collider
		else:
			nearest_interactable = null
	else:
		nearest_interactable = null

func interact() -> void:
	"""Interact with the nearest interactable object"""
	if nearest_interactable and nearest_interactable.has_method("interact"):
		nearest_interactable.interact(self)
		emit_signal("interacted", nearest_interactable)
		print("[Character3D] Interacted with: ", nearest_interactable.name)

func _set_animation_state(state: String) -> void:
	"""Set the animation state"""
	if animation_state != state:
		animation_state = state
		emit_signal("state_changed", state)
		# In full implementation, this would trigger AnimationPlayer transitions

func set_movement_enabled(enabled: bool) -> void:
	"""Enable or disable movement"""
	movement_enabled = enabled
	if not enabled:
		velocity = Vector3.ZERO
		_set_animation_state("idle")

func get_character_state() -> Dictionary:
	"""Get the current character state for networking"""
	return {
		"position": global_transform.origin,
		"rotation": rotation.y,
		"velocity": velocity,
		"animation_state": animation_state,
		"is_running": is_running,
		"is_jumping": is_jumping
	}

func apply_network_state(state: Dictionary) -> void:
	"""Apply network state from server"""
	if state.has("position"):
		global_transform.origin = state.position
	if state.has("rotation"):
		rotation.y = state.rotation
	if state.has("animation_state"):
		_set_animation_state(state.animation_state)
