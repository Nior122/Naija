extends Camera3D
class_name Camera3DController

## 3D Camera Controller for Naija: One World
## Manages third-person camera with collision detection and smooth following

# Camera settings
@export var follow_speed: float = 5.0
@export var rotation_speed: float = 2.0
@export var distance_from_target: float = 5.0
@export var height_offset: float = 2.0
@export var min_pitch: float = -30.0  # Degrees
@export var max_pitch: float = 60.0   # Degrees
@export var collision_mask: int = 1

# Camera state
var target_node: Node3D = null
var current_yaw: float = 0.0
var current_pitch: float = 15.0
var target_yaw: float = 0.0
var target_pitch: float = 15.0
var is_first_person: bool = false

# Input state
var mouse_captured: bool = false

func _ready() -> void:
	"""Initialize the camera"""
	# Find the player character as target
	if get_parent() and get_parent().get_parent():
		target_node = get_parent().get_parent() as Node3D
	
	# Set up initial camera position
	_update_camera_position()

func _unhandled_input(event: InputEvent) -> void:
	"""Handle input for camera control"""
	# Mouse look (when right mouse button is held)
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var mouse_motion = event as InputEventMouseMotion
		target_yaw -= mouse_motion.relative.x * 0.005 * rotation_speed
		target_pitch -= mouse_motion.relative.y * 0.005 * rotation_speed
		target_pitch = clamp(target_pitch, min_pitch, max_pitch)
	
	# Toggle first person view
	if event.is_action_pressed("toggle_first_person"):
		is_first_person = !is_first_person
		if is_first_person:
			distance_from_target = 0.1
		else:
			distance_from_target = 5.0

func _process(delta: float) -> void:
	"""Update camera each frame"""
	if not target_node or not is_instance_valid(target_node):
		return
	
	# Smooth interpolation of camera angles
	current_yaw = lerp(current_yaw, target_yaw, follow_speed * delta)
	current_pitch = lerp(current_pitch, target_pitch, follow_speed * delta)
	
	# Update camera position
	_update_camera_position()

func _update_camera_position() -> void:
	"""Update camera position based on target and angles"""
	if not target_node:
		return
	
	var target_position = target_node.global_transform.origin
	
	if is_first_person:
		# First person view
		global_transform.origin = target_position + Vector3(0, height_offset, 0)
	else:
		# Third person view
		var yaw_rad = deg_to_rad(current_yaw)
		var pitch_rad = deg_to_rad(current_pitch)
		
		# Calculate camera offset
		var offset = Vector3()
		offset.x = distance_from_target * cos(pitch_rad) * sin(yaw_rad)
		offset.y = distance_from_target * sin(pitch_rad) + height_offset
		offset.z = distance_from_target * cos(pitch_rad) * cos(yaw_rad)
		
		var desired_position = target_position + offset
		
		# Collision detection
		var space_state = get_world_3d().direct_space_state
		var query = PhysicsRayQueryParameters3D.create(
			target_position + Vector3(0, height_offset, 0),
			desired_position,
			collision_mask
		)
		query.collide_with_areas = false
		query.collide_with_bodies = true
		
		var result = space_state.intersect_ray(query)
		if result and result.size() > 0:
			# Camera hit something, move it closer
			var collision_point = result.position
			var collision_normal = result.normal
			desired_position = collision_point + collision_normal * 0.2
		
		# Smooth movement to desired position
		global_transform.origin = lerp(global_transform.origin, desired_position, follow_speed * delta)
	
	# Always look at target
	look_at(target_position + Vector3(0, height_offset * 0.5, 0), Vector3.UP)

func set_target(target: Node3D) -> void:
	"""Set a new target for the camera to follow"""
	target_node = target
	_update_camera_position()

func set_yaw(yaw: float) -> void:
	"""Set the camera yaw angle"""
	target_yaw = yaw

func set_pitch(pitch: float) -> void:
	"""Set the camera pitch angle"""
	target_pitch = clamp(pitch, min_pitch, max_pitch)

func get_camera_mode() -> String:
	"""Get current camera mode"""
	return "first_person" if is_first_person else "third_person"
