extends SceneTree

const PlayerActorScript = preload("res://scripts/player/player_actor.gd")
const REQUIRED_ACTIONS: Array[String] = ["move_up", "move_down", "move_left", "move_right", "run"]

var _failures: Array[String] = []
var _checks: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	for action in REQUIRED_ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
	var test_scene := Node2D.new()
	root.add_child(test_scene)
	var player: CharacterBody2D = PlayerActorScript.new()
	test_scene.add_child(player)
	player.position = Vector2(800.0, 450.0)
	player.movement_enabled = true
	await physics_frame

	var walk_start: Vector2 = player.position
	Input.action_press("move_right")
	for _frame in range(12):
		await physics_frame
	Input.action_release("move_right")
	var walk_distance: float = player.position.x - walk_start.x
	_check(walk_distance > 0.0, "A directional input moves the student")

	var run_start: Vector2 = player.position
	Input.action_press("move_right")
	Input.action_press("run")
	for _frame in range(12):
		await physics_frame
	Input.action_release("move_right")
	Input.action_release("run")
	var run_distance: float = player.position.x - run_start.x
	_check(run_distance > walk_distance * 1.2, "Holding run increases movement speed")

	player.position = PlayerActorScript.MAP_SIZE - Vector2(20.0, 450.0)
	player.snap_camera()
	Input.action_press("move_right")
	for _frame in range(12):
		await physics_frame
	Input.action_release("move_right")
	_check(
		player.position.x <= PlayerActorScript.MAP_SIZE.x - 28.0,
		"Movement stays inside the starter map bounds"
	)

	player.movement_enabled = false
	var paused_position: Vector2 = player.position
	Input.action_press("move_right")
	for _frame in range(3):
		await physics_frame
	Input.action_release("move_right")
	_check(
		player.position.is_equal_approx(paused_position),
		"Movement stops when the controller disables the player"
	)
	test_scene.queue_free()

	if _failures.is_empty():
		print("PASS: %d player movement checks" % _checks)
		quit(0)
	else:
		for failure in _failures:
			push_error(failure)
		print("FAIL: %d of %d player movement checks" % [_failures.size(), _checks])
		quit(1)


func _check(condition: bool, description: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(description)
