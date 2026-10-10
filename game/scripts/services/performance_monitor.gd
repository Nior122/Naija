extends Node
class_name PerformanceMonitor

## Performance Monitor for Naija: One World
## Tracks and reports performance metrics

# Metrics
var fps: float = 0.0
var frame_time_ms: float = 0.0
var process_time_ms: float = 0.0
var physics_time_ms: float = 0.0
var idle_time_ms: float = 0.0

# Memory metrics (approximate)
var static_memory_mb: float = 0.0
var dynamic_memory_mb: float = 0.0
var message_queue_max: int = 0

# Network metrics
var network_bytes_sent: int = 0
var network_bytes_received: int = 0
var network_messages_sent: int = 0
var network_messages_received: int = 0

# Scene metrics
var object_count: int = 0
var node_count: int = 0

# Timing
var last_update_time: float = 0.0
var update_interval: float = 1.0  # Update every second

# History
var fps_history: Array[float] = []
var memory_history: Array[float] = []
var max_history: int = 60

# Signals
signal metrics_updated(metrics: Dictionary)
signal performance_warning(warning: String)

func _ready() -> void:
	"""Initialize performance monitor"""
	print("[PerformanceMonitor] Initializing performance monitoring")
	set_process(true)

func _process(delta: float) -> void:
	"""Update performance metrics"""
	# Update timing metrics
	fps = 1.0 / delta if delta > 0 else 0.0
	frame_time_ms = delta * 1000.0
	
	# Update every interval
	last_update_time += delta
	if last_update_time >= update_interval:
		_update_metrics()
		last_update_time = 0.0
		
		# Check for performance issues
		_check_performance()

func _update_metrics() -> void:
	"""Update all metrics"""
	# Godot performance metrics
	process_time_ms = Performance.get_monitor(Performance.TIME_FPS) * 1000.0
	physics_time_ms = Performance.get_monitor(Performance.TIME_PHYSICS) * 1000.0
	idle_time_ms = Performance.get_monitor(Performance.TIME_IDLE) * 1000.0
	
	# Memory metrics (Godot provides these in bytes, convert to MB)
	static_memory_mb = Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0
	dynamic_memory_mb = Performance.get_monitor(Performance.MEMORY_DYNAMIC) / 1048576.0
	message_queue_max = Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)
	
	# Scene metrics
	object_count = Performance.get_monitor(Performance.OBJECT_COUNT)
	node_count = _count_nodes_recursive(get_tree().root)
	
	# Store in history
	fps_history.append(fps)
	if fps_history.size() > max_history:
		fps_history.pop_front()
	
	memory_history.append(static_memory_mb + dynamic_memory_mb)
	if memory_history.size() > max_history:
		memory_history.pop_front()
	
	# Emit metrics update
	var metrics = get_metrics()
	emit_signal("metrics_updated", metrics)

func _count_nodes_recursive(node: Node) -> int:
	"""Count all nodes in the scene tree"""
	var count: int = 1
	for child in node.get_children():
		count += _count_nodes_recursive(child)
	return count

func _check_performance() -> void:
	"""Check for performance issues and emit warnings"""
	# Low FPS warning
	if fps < 20.0 and fps > 0.0:
		emit_signal("performance_warning", "Low FPS: %.1f" % fps)
	
	# High memory usage warning (over 512 MB)
	var total_memory = static_memory_mb + dynamic_memory_mb
	if total_memory > 512.0:
		emit_signal("performance_warning", "High memory usage: %.1f MB" % total_memory)
	
	# Too many objects warning
	if object_count > 10000:
		emit_signal("performance_warning", "High object count: %d" % object_count)

func get_metrics() -> Dictionary:
	"""Get current performance metrics"""
	return {
		"fps": fps,
		"frame_time_ms": frame_time_ms,
		"process_time_ms": process_time_ms,
		"physics_time_ms": physics_time_ms,
		"idle_time_ms": idle_time_ms,
		"static_memory_mb": static_memory_mb,
		"dynamic_memory_mb": dynamic_memory_mb,
		"total_memory_mb": static_memory_mb + dynamic_memory_mb,
		"object_count": object_count,
		"node_count": node_count,
		"network_bytes_sent": network_bytes_sent,
		"network_bytes_received": network_bytes_received,
		"network_messages_sent": network_messages_sent,
		"network_messages_received": network_messages_received,
		"avg_fps": _get_average_fps(),
		"avg_memory_mb": _get_average_memory()
	}

func _get_average_fps() -> float:
	"""Calculate average FPS from history"""
	if fps_history.is_empty():
		return 0.0
	
	var sum: float = 0.0
	for sample in fps_history:
		sum += sample
	
	return sum / fps_history.size()

func _get_average_memory() -> float:
	"""Calculate average memory from history"""
	if memory_history.is_empty():
		return 0.0
	
	var sum: float = 0.0
	for sample in memory_history:
		sum += sample
	
	return sum / memory_history.size()

func record_network_activity(bytes_sent: int, bytes_received: int) -> void:
	"""Record network activity"""
	network_bytes_sent += bytes_sent
	network_bytes_received += bytes_received
	network_messages_sent += 1
	network_messages_received += 1

func reset_network_metrics() -> void:
	"""Reset network metrics"""
	network_bytes_sent = 0
	network_bytes_received = 0
	network_messages_sent = 0
	network_messages_received = 0

func get_performance_report() -> String:
	"""Get a formatted performance report"""
	var metrics = get_metrics()
	var report = "=== Performance Report ===\n"
	report += "FPS: %.1f (avg: %.1f)\n" % [metrics.fps, metrics.avg_fps]
	report += "Frame Time: %.2f ms\n" % metrics.frame_time_ms
	report += "Memory: %.1f MB (static: %.1f, dynamic: %.1f)\n" % [
		metrics.total_memory_mb,
		metrics.static_memory_mb,
		metrics.dynamic_memory_mb
	]
	report += "Objects: %d | Nodes: %d\n" % [metrics.object_count, metrics.node_count]
	report += "Network: Sent %d bytes (%d msgs), Received %d bytes (%d msgs)\n" % [
		metrics.network_bytes_sent,
		metrics.network_messages_sent,
		metrics.network_bytes_received,
		metrics.network_messages_received
	]
	return report

func enable_monitoring(enable: bool) -> void:
	"""Enable or disable monitoring"""
	set_process(enable)
	print("[PerformanceMonitor] Monitoring ", "enabled" if enable else "disabled")

func set_update_interval(interval: float) -> void:
	"""Set the update interval in seconds"""
	update_interval = max(0.1, interval)  # Minimum 0.1 seconds
	print("[PerformanceMonitor] Update interval set to %.1f seconds" % update_interval)
