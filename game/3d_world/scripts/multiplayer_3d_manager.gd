extends Node
class_name Multiplayer3DManager

## 3D Multiplayer Manager for Naija: One World
## Integrates multiplayer system with 3D world, handling remote player rendering
## and position synchronization in 3D space

# References
var multiplayer_client: Node = null  # The existing 2D multiplayer client
var local_character: Character3D = null
var remote_players: Dictionary = {}  # player_id -> RemotePlayer3D node

# Configuration
@export var update_rate: float = 0.1  # Send position updates every 0.1 seconds
@export var interpolation_speed: float = 10.0  # How fast to interpolate remote players

# State
var _update_timer: float = 0.0
var _last_position: Vector3 = Vector3.ZERO
var _last_rotation: float = 0.0

# Signals
signal remote_player_joined(player_id: String, data: Dictionary)
signal remote_player_left(player_id: String)
signal remote_player_updated(player_id: String, data: Dictionary)

func _ready() -> void:
	"""Initialize the 3D multiplayer manager"""
	print("[Multiplayer3D] Initializing 3D multiplayer manager")

func setup(client: Node, character: Character3D) -> void:
	"""Setup the multiplayer manager with client and local character"""
	multiplayer_client = client
	local_character = character
	
	if multiplayer_client:
		# Connect to existing multiplayer signals
		if multiplayer_client.has_signal("message_received"):
			multiplayer_client.message_received.connect(_on_message_received)
		if multiplayer_client.has_signal("session_ready"):
			multiplayer_client.session_ready.connect(_on_session_ready)
	
	print("[Multiplayer3D] Setup complete")

func _process(delta: float) -> void:
	"""Update multiplayer state each frame"""
	if not multiplayer_client or not local_character:
		return
	
	_update_timer += delta
	
	# Send position updates at configured rate
	if _update_timer >= update_rate:
		_update_timer = 0.0
		_send_local_state()
	
	# Update remote player interpolation
	_update_remote_players(delta)

func _send_local_state() -> void:
	"""Send local player state to server"""
	if not multiplayer_client or not multiplayer_client.is_world_connected():
		return
	
	var current_position = local_character.global_transform.origin
	var current_rotation = local_character.rotation.y
	
	# Only send if position/rotation changed significantly
	if current_position.distance_to(_last_position) < 0.01 and abs(current_rotation - _last_rotation) < 0.01:
		return
	
	_last_position = current_position
	_last_rotation = current_rotation
	
	# Send 3D position update
	var state = local_character.get_character_state()
	state["type"] = "movement.input_3d"
	state["position"] = {
		"x": current_position.x,
		"y": current_position.y,
		"z": current_position.z
	}
	state["rotation"] = current_rotation
	
	if multiplayer_client.has_method("_send_message"):
		multiplayer_client._send_message(state)

func _on_message_received(message: Dictionary) -> void:
	"""Handle incoming multiplayer messages"""
	var message_type = message.get("type", "")
	
	match message_type:
		"player.joined":
			_handle_player_joined(message)
		"player.left":
			_handle_player_left(message)
		"player.moved_3d":
			_handle_player_moved(message)
		"player.moved":
			# Handle 2D movement messages (convert to 3D)
			_handle_player_moved_2d(message)

func _on_session_ready(character: Dictionary, world: Dictionary, players: Array) -> void:
	"""Handle session ready - initialize remote players"""
	print("[Multiplayer3D] Session ready with %d players" % players.size())
	
	# Clear existing remote players
	for player_id in remote_players.keys():
		_remove_remote_player(player_id)
	
	# Add all players from session
	for player_data in players:
		var player_id = player_data.get("id", "")
		if player_id and player_id != character.get("id", ""):
			_add_remote_player(player_id, player_data)

func _handle_player_joined(message: Dictionary) -> void:
	"""Handle a new player joining"""
	var player_id = message.get("player_id", "")
	var player_data = message.get("data", {})
	
	if player_id and not remote_players.has(player_id):
		_add_remote_player(player_id, player_data)
		emit_signal("remote_player_joined", player_id, player_data)

func _handle_player_left(message: Dictionary) -> void:
	"""Handle a player leaving"""
	var player_id = message.get("player_id", "")
	
	if player_id and remote_players.has(player_id):
		_remove_remote_player(player_id)
		emit_signal("remote_player_left", player_id)

func _handle_player_moved(message: Dictionary) -> void:
	"""Handle 3D player movement update"""
	var player_id = message.get("player_id", "")
	var position_data = message.get("position", {})
	var rotation = message.get("rotation", 0.0)
	var animation_state = message.get("animation_state", "idle")
	
	if player_id and remote_players.has(player_id):
		var remote_player = remote_players[player_id]
		
		# Set target position for interpolation
		if position_data.has("x") and position_data.has("y") and position_data.has("z"):
			var target_pos = Vector3(position_data.x, position_data.y, position_data.z)
			remote_player.set("target_position", target_pos)
		
		remote_player.rotation.y = rotation
		
		# Update animation state if remote player supports it
		if remote_player.has_method("set_animation_state"):
			remote_player.set_animation_state(animation_state)
		
		emit_signal("remote_player_updated", player_id, message)

func _handle_player_moved_2d(message: Dictionary) -> void:
	"""Handle 2D player movement (convert to 3D flat plane)"""
	var player_id = message.get("player_id", "")
	var direction = message.get("direction", {"x": 0, "y": 0})
	
	if player_id and remote_players.has(player_id):
		var remote_player = remote_players[player_id]
		
		# Convert 2D movement to 3D (X-Z plane, Y=0 for ground)
		if direction.has("x") and direction.has("y"):
			# Simple conversion: 2D (x,y) -> 3D (x, 0, y)
			var current_pos = remote_player.global_transform.origin
			var move_dir = Vector3(direction.x, 0, direction.y)
			var target_pos = current_pos + move_dir * 0.1  # Small step
			remote_player.set("target_position", target_pos)

func _add_remote_player(player_id: String, data: Dictionary) -> void:
	"""Add a remote player to the scene"""
	var remote_player = CharacterBody3D.new()
	remote_player.name = "RemotePlayer_" + player_id
	
	# Set initial position
	var position_data = data.get("position", {"x": 0, "y": 0, "z": 0})
	if position_data.has("x") and position_data.has("y") and position_data.has("z"):
		remote_player.global_transform.origin = Vector3(position_data.x, position_data.y, position_data.z)
	
	# Add visual representation (capsule for now)
	var mesh_instance = MeshInstance3D.new()
	var capsule_mesh = CapsuleMesh.new()
	capsule_mesh.radius = 0.3
	capsule_mesh.height = 1.8
	mesh_instance.mesh = capsule_mesh
	
	var material = StandardMaterial3D.new()
	material.albedo_color = Color(0.3, 0.5, 0.8)  # Blue for remote players
	mesh_instance.material_override = material
	remote_player.add_child(mesh_instance)
	
	# Add to scene
	$"/root/World3D/Characters".add_child(remote_player)
	remote_players[player_id] = remote_player
	
	print("[Multiplayer3D] Added remote player: %s" % player_id)

func _remove_remote_player(player_id: String) -> void:
	"""Remove a remote player from the scene"""
	if remote_players.has(player_id):
		var remote_player = remote_players[player_id]
		if is_instance_valid(remote_player):
			remote_player.queue_free()
		remote_players.erase(player_id)
		print("[Multiplayer3D] Removed remote player: %s" % player_id)

func _update_remote_players(delta: float) -> void:
	"""Interpolate remote player positions"""
	for player_id in remote_players.keys():
		var remote_player = remote_players[player_id]
		if not is_instance_valid(remote_player):
			continue
		
		# Interpolate to target position if it exists
		if remote_player.has("target_position"):
			var target_pos = remote_player.get("target_position")
			var current_pos = remote_player.global_transform.origin
			remote_player.global_transform.origin = current_pos.lerp(target_pos, interpolation_speed * delta)

func get_remote_player_count() -> int:
	"""Get the number of remote players"""
	return remote_players.size()

func cleanup() -> void:
	"""Clean up all remote players"""
	for player_id in remote_players.keys():
		_remove_remote_player(player_id)
	remote_players.clear()
