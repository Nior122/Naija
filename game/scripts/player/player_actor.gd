class_name PlayerActor
extends CharacterBody2D

signal travelled(distance: float, running: bool)

const MAP_SIZE: Vector2 = Vector2(1600.0, 900.0)

var movement_enabled: bool = false
var walk_speed: float = 205.0
var run_speed: float = 320.0
var appearance: Dictionary = {}
var facing: Vector2 = Vector2.DOWN
var _last_position: Vector2 = Vector2.ZERO


func _ready() -> void:
	collision_layer = 1
	collision_mask = 1
	var collision := CollisionShape2D.new()
	var shape := CircleShape2D.new()
	shape.radius = 10.0
	collision.shape = shape
	add_child(collision)
	var camera := Camera2D.new()
	camera.name = "Camera2D"
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 7.0
	camera.zoom = Vector2(1.05, 1.05)
	camera.limit_left = 0
	camera.limit_top = 0
	camera.limit_right = int(MAP_SIZE.x)
	camera.limit_bottom = int(MAP_SIZE.y)
	add_child(camera)
	camera.make_current()
	_last_position = position
	queue_redraw()


func set_appearance(value: Dictionary) -> void:
	appearance = value.duplicate(true)
	queue_redraw()


func snap_camera() -> void:
	_last_position = position
	var camera := get_node_or_null("Camera2D") as Camera2D
	if camera != null:
		camera.reset_smoothing()


func _physics_process(_delta: float) -> void:
	if not movement_enabled:
		velocity = Vector2.ZERO
		return
	var direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var running := Input.is_action_pressed("run") and direction.length_squared() > 0.0
	velocity = direction * (run_speed if running else walk_speed)
	if direction.length_squared() > 0.0:
		facing = direction.normalized()
		queue_redraw()
	move_and_slide()
	position = position.clamp(Vector2(28.0, 28.0), MAP_SIZE - Vector2(28.0, 28.0))
	var distance := position.distance_to(_last_position)
	if distance > 0.05:
		travelled.emit(distance, running)
		_last_position = position


func _draw() -> void:
	var skin_tone := Color.from_string(
		str(appearance.get("skin_tone", "#9b654d")), Color("#9b654d")
	)
	var shirt_color := Color.from_string(
		str(appearance.get("clothing_color", "#27734a")), Color("#27734a")
	)
	var hair_color := Color.from_string(
		str(appearance.get("hair_color", "#2c211d")), Color("#2c211d")
	)
	draw_circle(Vector2(0.0, 15.0), 14.0, Color(0.04, 0.07, 0.05, 0.25))
	draw_rect(Rect2(Vector2(-10.0, -2.0), Vector2(20.0, 25.0)), shirt_color)
	draw_rect(Rect2(Vector2(-13.0, 4.0), Vector2(5.0, 16.0)), skin_tone)
	draw_rect(Rect2(Vector2(8.0, 4.0), Vector2(5.0, 16.0)), skin_tone)
	draw_circle(Vector2(0.0, -9.0), 9.0, skin_tone)
	var style := str(appearance.get("hairstyle", "Short curls"))
	if style == "Braids":
		draw_circle(Vector2(-7.0, -10.0), 4.0, hair_color)
		draw_circle(Vector2(7.0, -10.0), 4.0, hair_color)
		draw_rect(Rect2(Vector2(-10.0, -14.0), Vector2(20.0, 4.0)), hair_color)
	elif style == "Low cut":
		draw_arc(Vector2(0.0, -10.0), 8.5, PI, TAU, 18, hair_color, 3.0)
	else:
		draw_circle(Vector2(0.0, -16.0), 6.0, hair_color)
		draw_arc(Vector2(0.0, -10.0), 8.5, PI, TAU, 18, hair_color, 3.0)
	# A small exercise-book strap makes the student silhouette readable from above.
	draw_rect(Rect2(Vector2(8.0, -1.0), Vector2(6.0, 13.0)), Color("#c79448"))
	draw_arc(Vector2.ZERO, 19.0, 0.0, TAU, 28, Color("#fff5cf"), 1.4)
	draw_line(Vector2(0.0, -8.0), Vector2(0.0, -8.0) + facing * 8.0, Color("#fff5cf"), 2.0)
