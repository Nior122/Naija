class_name ServerRequestTracker
extends RefCounted

## Tracks the one changing request that a screen has sent (Stage 41). A changing request moves money
## or records a change. The states are:
## idle         nothing is waiting, so a new request may be sent
## waiting      sent; the server has not answered, so no other changing request may be sent yet
## unconfirmed  not confirmed: the server said "not saved" or "outcome unknown", the connection was
## lost, or no answer
## came in time. Retrying sends the same request ID, which the server applies at most once. A
## definitive answer (a result, a duplicate notice, or a refusal in which nothing changed) clears
## it. The tracker is owned by the UI layer, not by a panel, so a reply that arrives while the panel
## is closed still updates it.

const STATE_IDLE := "idle"
const STATE_WAITING := "waiting"
const STATE_UNCONFIRMED := "unconfirmed"
const REQUEST_TIMEOUT_SECONDS := 20.0

var _state: String = STATE_IDLE
var _action: String = ""
var _payload: Dictionary = {}
var _request_id: String = ""


func state() -> String:
	return _state


func has_pending() -> bool:
	return _state != STATE_IDLE


func is_waiting() -> bool:
	return _state == STATE_WAITING


func is_unconfirmed() -> bool:
	return _state == STATE_UNCONFIRMED


func action() -> String:
	return _action


func payload() -> Dictionary:
	return _payload.duplicate(true)


func request_id() -> String:
	return _request_id


## Starts a changing request and returns its new request ID. Returns "" when another request is
## still pending.
func begin(action_name: String, payload_values: Dictionary) -> String:
	if has_pending():
		return ""
	_action = action_name
	_payload = payload_values.duplicate(true)
	_request_id = _new_request_id()
	_state = STATE_WAITING
	return _request_id


## Sends the unconfirmed request again with the same ID and payload. Returns "" when there is
## nothing to retry.
func retry() -> String:
	if _state != STATE_UNCONFIRMED:
		return ""
	_state = STATE_WAITING
	return _request_id


## Clears the pending request. Used after a definitive answer, when the player discards it, or when
## it was never sent.
func resolve() -> void:
	_state = STATE_IDLE
	_action = ""
	_payload = {}
	_request_id = ""


## True when a reply with this request ID answers the pending request.
func matches(reply_request_id: String) -> bool:
	return has_pending() and not reply_request_id.is_empty() and reply_request_id == _request_id


## Applies a typed reply (property.result, property.error, business.result, business.error), or a
## generic error that carries this request's ID (Stage 44: for example rate_limited, sent when a
## command is refused before it is applied). Returns true when the reply answered the pending
## request. An unconfirmed error keeps the request for a retry; any other reply resolves it.
func apply_reply(message: Dictionary) -> bool:
	if not matches(str(message.get("requestId", ""))):
		return false
	var reply_type := str(message.get("type", ""))
	var is_error := reply_type.ends_with(".error") or reply_type == "error"
	if is_error and is_unconfirmed_code(str(message.get("code", ""))):
		mark_unconfirmed()
	else:
		resolve()
	return true


## The server replied command.duplicate: this request was already applied, so it is no longer
## pending.
func apply_duplicate(reply_request_id: String) -> bool:
	if not matches(reply_request_id):
		return false
	resolve()
	return true


## The connection was lost or is being re-established. A waiting request may or may not have been
## applied.
func apply_transport_loss() -> void:
	if is_waiting():
		mark_unconfirmed()


## No answer arrived in time for this request.
func apply_timeout(reply_request_id: String) -> bool:
	if not is_waiting() or not matches(reply_request_id):
		return false
	mark_unconfirmed()
	return true


## The request could not be written to the socket, so the server never received it and nothing
## changed.
func apply_send_failure(reply_request_id: String) -> bool:
	if not is_waiting() or not matches(reply_request_id):
		return false
	resolve()
	return true


## A refusal code that means the change is not confirmed. The server uses these for "not saved" and
## "outcome unknown".
static func is_unconfirmed_code(code: String) -> bool:
	# internal_error is sent by a failure handler after the request may already have been applied.
	return code.ends_with("_not_saved") or code.ends_with("_outcome_unknown") \
		or code == "internal_error"


func mark_unconfirmed() -> void:
	if _state == STATE_WAITING:
		_state = STATE_UNCONFIRMED


static func _new_request_id() -> String:
	return Crypto.new().generate_random_bytes(16).hex_encode()
