extends SceneTree
# Runtime check of PerformanceMonitor (GDScript runtime, real class instance).
# Checks: process_time_ms is TIME_PROCESS converted to ms (not TIME_FPS); the removed
# dynamic-memory and idle fields are absent at runtime; static memory is reported.
# Run: godot --headless --path game --script res://tests/performance_metrics.gd

var _checks: int = 0
var _failures: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures += 1
		print("CHECK FAILED: %s" % label)


func _run() -> void:
	var monitor := PerformanceMonitor.new()
	root.add_child(monitor)
	await process_frame
	await process_frame

	# Sample the monitor and the monitor under test within the same frame so the values are comparable.
	monitor._update_metrics()
	var expected_process_ms: float = Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
	_check(is_equal_approx(monitor.process_time_ms, expected_process_ms),
		"process_time_ms equals TIME_PROCESS in milliseconds (got %s, expected %s)" % [monitor.process_time_ms, expected_process_ms])
	var fps_based_ms: float = Performance.get_monitor(Performance.TIME_FPS) * 1000.0
	_check(not is_equal_approx(monitor.process_time_ms, fps_based_ms) or is_zero_approx(fps_based_ms),
		"process_time_ms is not computed from TIME_FPS")

	_check(not ("dynamic_memory_mb" in monitor), "dynamic_memory_mb field is removed")
	_check(not ("idle_time_ms" in monitor), "idle_time_ms field is removed")

	var metrics: Dictionary = monitor.get_metrics()
	_check(not metrics.has("dynamic_memory_mb"), "metrics dictionary has no dynamic_memory_mb key")
	_check(not metrics.has("idle_time_ms"), "metrics dictionary has no idle_time_ms key")
	_check(metrics.has("process_time_ms") and metrics.has("physics_time_ms"), "metrics dictionary keeps the timing keys")
	_check(monitor.static_memory_mb > 0.0, "static memory is measured (greater than 0 MB)")
	_check(is_equal_approx(float(metrics.get("total_memory_mb", -1.0)), monitor.static_memory_mb),
		"total_memory_mb equals static memory (no double-counting)")
	_check(monitor.memory_history.size() == 1 and is_equal_approx(monitor.memory_history[0], monitor.static_memory_mb),
		"memory history records static memory only")

	var report: String = monitor.get_performance_report()
	_check(report.contains("(static)") and not report.contains("dynamic"), "performance report shows static memory only")

	monitor.queue_free()
	await process_frame
	if _failures == 0:
		print("PASS: %d performance metric checks" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d performance metric checks" % [_failures, _checks])
		quit(1)
