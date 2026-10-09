extends Node

signal status_changed(status: String)
signal session_ready(character: Dictionary, world: Dictionary, players: Array)
signal message_received(message: Dictionary)
signal error_received(code: String, message: String)

const SESSION_CONFIG_PATH: String = "user://naija-multiplayer.cfg"
const SESSION_CONFIG_ENV: String = "NAIJA_MULTIPLAYER_SESSION_PATH"
const DEFAULT_NATIVE_URL: String = "ws://127.0.0.1:3000/ws"
const CONNECT_TIMEOUT_SECONDS: float = 12.0
const MAX_RECONNECT_DELAY_SECONDS: float = 30.0

var _socket: WebSocketPeer
var _profile: Dictionary = {}
var _session_token: String = ""
var _creation_key: String = ""
var _status: String = "offline"
var _should_reconnect: bool = false
var _connection_pending: bool = false
var _connection_open: bool = false
var _fallback_create_sent: bool = false
var _connect_elapsed: float = 0.0
var _reconnect_remaining: float = 0.0
var _reconnect_delay: float = 1.0
var _movement_sequence: int = 0


func _ready() -> void:
	_load_local_session()
	set_process(true)


func has_saved_session() -> bool:
	return not _session_token.is_empty()


func is_world_connected() -> bool:
	return _status == "connected" and _socket != null


func current_status() -> String:
	return _status


func connect_to_world(profile: Dictionary) -> void:
	_profile = profile.duplicate(true)
	_should_reconnect = true
	_fallback_create_sent = false
	_reconnect_remaining = 0.0
	_reconnect_delay = 1.0
	_movement_sequence = 0
	_connect_now()


func disconnect_from_world() -> void:
	_should_reconnect = false
	_connection_pending = false
	_connection_open = false
	_reconnect_remaining = 0.0
	if _socket != null and _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.close(1000, "client closed")
	_socket = null
	_set_status("offline")


func send_movement(direction: Vector2, running: bool) -> void:
	if not is_world_connected():
		return
	_movement_sequence += 1
	_send_message(
		{
			"type": "movement.input",
			"sequence": _movement_sequence,
			"direction": {"x": direction.x, "y": direction.y},
			"running": running,
		}
	)


func send_command(message_type: String, values: Dictionary = {}) -> bool:
	if not is_world_connected():
		return false
	var payload := values.duplicate(true)
	payload["type"] = message_type
	payload["requestId"] = _new_request_id()
	return _send_message(payload)


func _process(delta: float) -> void:
	if _reconnect_remaining > 0.0:
		_reconnect_remaining -= delta
		if _reconnect_remaining <= 0.0 and _should_reconnect:
			_connect_now()

	if _socket == null or not _connection_pending:
		return
	_socket.poll()
	var ready_state := _socket.get_ready_state()
	if ready_state == WebSocketPeer.STATE_CONNECTING:
		_connect_elapsed += delta
		if _connect_elapsed > CONNECT_TIMEOUT_SECONDS:
			_socket.close(1001, "connection timeout")
			_handle_transport_closed()
		return

	if ready_state == WebSocketPeer.STATE_OPEN:
		if not _connection_open:
			_connection_open = true
			_connect_elapsed = 0.0
			_set_status("authenticating")
			if not _session_token.is_empty():
				_send_message({"type": "session.resume", "sessionToken": _session_token})
			else:
				_send_create_identity()
		while _socket != null and _socket.get_available_packet_count() > 0:
			if not _socket.was_string_packet():
				_socket.get_packet()
				continue
			var packet := _socket.get_packet()
			_handle_packet(packet.get_string_from_utf8())
		return

	if ready_state == WebSocketPeer.STATE_CLOSED:
		_handle_transport_closed()


func _connect_now() -> void:
	if not _should_reconnect or _connection_pending:
		return
	var url := _server_url()
	if url.is_empty():
		_set_status("server URL unavailable")
		error_received.emit(
			"server_url_unavailable", "Set NAIJA_WS_URL to the multiplayer server URL."
		)
		return
	_socket = WebSocketPeer.new()
	var connect_result: int = _socket.connect_to_url(url)
	if connect_result != OK:
		_socket = null
		_schedule_reconnect("connection failed")
		return
	_connection_pending = true
	_connection_open = false
	_connect_elapsed = 0.0
	_fallback_create_sent = false
	_set_status("connecting")


func _server_url() -> String:
	if OS.has_feature("web"):
		# Web builds use the hosting origin and a same-origin /ws reverse proxy;
		# they never attempt to contact a user's localhost.
		if Engine.has_singleton("JavaScriptBridge"):
			var bridge: Variant = Engine.get_singleton("JavaScriptBridge")
			var browser_location: Variant = bridge.get_interface("location")
			var host := str(browser_location.host)
			if not host.is_empty():
				var scheme := "wss" if str(browser_location.protocol) == "https:" else "ws"
				return "%s://%s/ws" % [scheme, host]
			return ""
	var configured_url := OS.get_environment("NAIJA_WS_URL").strip_edges()
	return configured_url if not configured_url.is_empty() else DEFAULT_NATIVE_URL


func _send_create_identity() -> void:
	if _fallback_create_sent:
		return
	_fallback_create_sent = true
	_send_message(
		{
			"type": "identity.create",
			"profile": _profile,
			"creationKey": _creation_key,
		}
	)


func _send_message(message: Dictionary) -> bool:
	if _socket == null or _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	var error := _socket.send_text(JSON.stringify(message))
	if error != OK:
		error_received.emit("send_failed", "The multiplayer message could not be sent.")
		return false
	return true


func _handle_packet(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		error_received.emit("invalid_server_message", "The server sent an unreadable message.")
		return
	var message: Dictionary = parsed
	var message_type := str(message.get("type", ""))
	match message_type:
		"identity.created":
			_session_token = str(message.get("sessionToken", ""))
			if _session_token.is_empty():
				error_received.emit("session_invalid", "The server did not return a session token.")
				return
			_save_local_session()
			_send_message({"type": "session.resume", "sessionToken": _session_token})
		"session.ready":
			_reconnect_delay = 1.0
			var character: Variant = message.get("character", {})
			var world: Variant = message.get("world", {})
			var players: Variant = message.get("players", [])
			if character is Dictionary and world is Dictionary and players is Array:
				_set_status("connected")
				session_ready.emit(character, world, players)
			else:
				error_received.emit(
					"invalid_server_message", "The server session snapshot is incomplete."
				)
		"error":
			var code := str(message.get("code", "server_error"))
			var description := str(message.get("message", "The server rejected the request."))
			if (
				code == "session_invalid"
				and not _session_token.is_empty()
				and not _fallback_create_sent
			):
				_session_token = ""
				_clear_saved_token()
				_send_create_identity()
				return
			error_received.emit(code, description)
		"_":
			pass
	message_received.emit(message)


func _handle_transport_closed() -> void:
	if not _connection_pending:
		return
	_connection_pending = false
	_connection_open = false
	_socket = null
	if _should_reconnect:
		_schedule_reconnect("connection lost")
	else:
		_set_status("offline")


func _schedule_reconnect(reason: String) -> void:
	if not _should_reconnect:
		_set_status("offline")
		return
	_reconnect_remaining = _reconnect_delay
	_reconnect_delay = minf(_reconnect_delay * 2.0, MAX_RECONNECT_DELAY_SECONDS)
	_set_status("reconnecting")
	if reason == "connection failed":
		error_received.emit(
			"connection_failed", "Could not reach the multiplayer server; retrying."
		)


func _set_status(value: String) -> void:
	if _status == value:
		return
	_status = value
	status_changed.emit(value)


func _session_config_path() -> String:
	var configured_path := OS.get_environment(SESSION_CONFIG_ENV).strip_edges()
	return configured_path if not configured_path.is_empty() else SESSION_CONFIG_PATH


func _load_local_session() -> void:
	var config := ConfigFile.new()
	if config.load(_session_config_path()) == OK:
		_session_token = str(config.get_value("multiplayer", "session_token", ""))
		_creation_key = str(config.get_value("multiplayer", "creation_key", ""))
	if _creation_key.length() < 32:
		var crypto := Crypto.new()
		_creation_key = crypto.generate_random_bytes(32).hex_encode()
		_save_local_session()


func _save_local_session() -> void:
	var config := ConfigFile.new()
	config.set_value("multiplayer", "session_token", _session_token)
	config.set_value("multiplayer", "creation_key", _creation_key)
	var save_error := config.save(_session_config_path())
	if save_error != OK:
		push_warning(
			"The local multiplayer session could not be saved; reconnect after closing may be unavailable."
		)


func _clear_saved_token() -> void:
	_session_token = ""
	_save_local_session()


func _new_request_id() -> String:
	var crypto := Crypto.new()
	return crypto.generate_random_bytes(16).hex_encode()
