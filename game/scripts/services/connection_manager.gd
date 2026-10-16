extends Node
class_name ConnectionManager

## Connection Manager for Naija: One World
## Handles network connectivity, reconnection, and session management

# Connection state
enum ConnectionState {
	DISCONNECTED,
	CONNECTING,
	CONNECTED,
	RECONNECTING,
	FAILED
}

var connection_state: ConnectionState = ConnectionState.DISCONNECTED
var is_connected: bool = false
var is_reconnecting: bool = false

# Reconnection settings
var max_reconnect_attempts: int = 5
var reconnect_delay_base: float = 1.0  # Base delay in seconds
var reconnect_delay_max: float = 30.0  # Maximum delay
var current_reconnect_attempt: int = 0
var reconnect_timer: float = 0.0

# Connection quality
var latency_ms: float = 0.0
var packet_loss: float = 0.0
var last_ping_time: float = 0.0
var ping_interval: float = 5.0  # Ping every 5 seconds

# Session management
var session_id: String = ""
var session_token: String = ""
var session_expires: float = 0.0

# Network monitoring
var bytes_sent: int = 0
var bytes_received: int = 0
var messages_sent: int = 0
var messages_received: int = 0
var connection_start_time: float = 0.0

# Signals
signal connection_state_changed(state: ConnectionState)
signal connected()
signal disconnected(reason: String)
signal reconnecting(attempt: int)
signal reconnected()
signal connection_failed(error: String)
signal latency_updated(latency_ms: float)
signal session_expired()

func _ready() -> void:
	"""Initialize connection manager"""
	print("[ConnectionManager] Initializing connection management")
	set_process(true)

func _process(delta: float) -> void:
	"""Process connection management"""
	# Handle reconnection timer
	if connection_state == ConnectionState.RECONNECTING:
		reconnect_timer -= delta
		if reconnect_timer <= 0:
			_attempt_reconnect()
	
	# Send periodic pings
	if connection_state == ConnectionState.CONNECTED:
		last_ping_time += delta
		if last_ping_time >= ping_interval:
			_send_ping()
			last_ping_time = 0.0

func connect_to_server(server_url: String) -> void:
	"""Connect to the game server"""
	if connection_state == ConnectionState.CONNECTED or connection_state == ConnectionState.CONNECTING:
		print("[ConnectionManager] Already connected or connecting")
		return
	
	print("[ConnectionManager] Connecting to server: ", server_url)
	
	_set_state(ConnectionState.CONNECTING)
	
	# Reset counters
	_reset_counters()
	connection_start_time = Time.get_ticks_msec() / 1000.0
	
	# Note: Actual WebSocket connection would be handled by MultiplayerClient
	# This is a placeholder for connection management logic
	
	# Simulate successful connection for now
	_on_connected()

func _on_connected() -> void:
	"""Handle successful connection"""
	print("[ConnectionManager] Connected to server")
	
	connection_state = ConnectionState.CONNECTED
	is_connected = true
	is_reconnecting = false
	current_reconnect_attempt = 0
	
	emit_signal("connected")
	emit_signal("connection_state_changed", connection_state)

func _on_disconnected(reason: String = "Unknown") -> void:
	"""Handle disconnection"""
	print("[ConnectionManager] Disconnected: ", reason)
	
	connection_state = ConnectionState.DISCONNECTED
	is_connected = false
	
	emit_signal("disconnected", reason)
	emit_signal("connection_state_changed", connection_state)
	
	# Attempt reconnection if this was unexpected
	if reason != "Intentional disconnect":
		_start_reconnection()

func _start_reconnection() -> void:
	"""Start reconnection process"""
	if is_reconnecting:
		return
	
	if current_reconnect_attempt >= max_reconnect_attempts:
		print("[ConnectionManager] Max reconnection attempts reached")
		_set_state(ConnectionState.FAILED)
		emit_signal("connection_failed", "Max reconnection attempts reached")
		return
	
	is_reconnecting = true
	connection_state = ConnectionState.RECONNECTING
	
	# Calculate delay with exponential backoff
	var delay = min(
		reconnect_delay_base * pow(2, current_reconnect_attempt),
		reconnect_delay_max
	)
	
	reconnect_timer = delay
	current_reconnect_attempt += 1
	
	print("[ConnectionManager] Reconnecting in %.1f seconds (attempt %d/%d)" % [
		delay, current_reconnect_attempt, max_reconnect_attempts
	])
	
	emit_signal("reconnecting", current_reconnect_attempt)
	emit_signal("connection_state_changed", connection_state)

func _attempt_reconnect() -> void:
	"""Attempt to reconnect to server"""
	print("[ConnectionManager] Attempting reconnection...")
	
	# Note: Actual reconnection logic would go here
	# For now, simulate success
	
	_on_reconnected()

func _on_reconnected() -> void:
	"""Handle successful reconnection"""
	print("[ConnectionManager] Reconnected successfully")
	
	connection_state = ConnectionState.CONNECTED
	is_connected = true
	is_reconnecting = false
	current_reconnect_attempt = 0
	
	emit_signal("reconnected")
	emit_signal("connection_state_changed", connection_state)

func _send_ping() -> void:
	"""Send a ping to measure latency"""
	# Note: Actual ping implementation would send a message and measure round-trip time
	# This is a placeholder
	pass

func _set_state(state: ConnectionState) -> void:
	"""Set connection state and emit signal"""
	connection_state = state
	emit_signal("connection_state_changed", state)

func _reset_counters() -> void:
	"""Reset network counters"""
	bytes_sent = 0
	bytes_received = 0
	messages_sent = 0
	messages_received = 0
	latency_ms = 0.0
	packet_loss = 0.0

func record_network_activity(sent_bytes: int, received_bytes: int) -> void:
	"""Record network activity"""
	bytes_sent += sent_bytes
	bytes_received += received_bytes
	messages_sent += 1 if sent_bytes > 0 else 0
	messages_received += 1 if received_bytes > 0 else 0

func update_latency(new_latency_ms: float) -> void:
	"""Update latency measurement"""
	latency_ms = new_latency_ms
	emit_signal("latency_updated", latency_ms)

func get_connection_state() -> ConnectionState:
	"""Get current connection state"""
	return connection_state

func get_connection_state_name() -> String:
	"""Get connection state as string"""
	match connection_state:
		ConnectionState.DISCONNECTED:
			return "Disconnected"
		ConnectionState.CONNECTING:
			return "Connecting"
		ConnectionState.CONNECTED:
			return "Connected"
		ConnectionState.RECONNECTING:
			return "Reconnecting"
		ConnectionState.FAILED:
			return "Failed"
	return "Unknown"

func get_latency_ms() -> float:
	"""Get current latency in milliseconds"""
	return latency_ms

func get_connection_quality() -> String:
	"""Get connection quality rating"""
	if latency_ms < 50:
		return "Excellent"
	elif latency_ms < 100:
		return "Good"
	elif latency_ms < 200:
		return "Fair"
	elif latency_ms < 500:
		return "Poor"
	else:
		return "Very Poor"

func get_network_stats() -> Dictionary:
	"""Get network statistics"""
	var uptime = (Time.get_ticks_msec() / 1000.0) - connection_start_time
	
	return {
		"state": get_connection_state_name(),
		"latency_ms": latency_ms,
		"quality": get_connection_quality(),
		"bytes_sent": bytes_sent,
		"bytes_received": bytes_received,
		"messages_sent": messages_sent,
		"messages_received": messages_received,
		"uptime_seconds": uptime,
		"reconnect_attempts": current_reconnect_attempt
	}

func disconnect_intentional() -> void:
	"""Intentionally disconnect from server"""
	print("[ConnectionManager] Intentional disconnect")
	
	is_reconnecting = false  # Prevent reconnection
	_on_disconnected("Intentional disconnect")

func set_session(session_id: String, session_token: String, expires_at: float) -> void:
	"""Set session information"""
	self.session_id = session_id
	self.session_token = session_token
	session_expires = expires_at
	
	print("[ConnectionManager] Session set: ", session_id)

func is_session_valid() -> bool:
	"""Check if session is still valid"""
	if session_id.is_empty() or session_token.is_empty():
		return false
	
	var current_time = Time.get_ticks_msec() / 1000.0
	return current_time < session_expires

func check_session_expiration() -> void:
	"""Check if session has expired"""
	if not is_session_valid():
		print("[ConnectionManager] Session expired")
		emit_signal("session_expired")

func reset_reconnect_attempts() -> void:
	"""Reset reconnection attempt counter"""
	current_reconnect_attempt = 0
	is_reconnecting = false
