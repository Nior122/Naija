extends SceneTree
# Stage 44 request-tracker regression test. HEADLESS, LOGIC ONLY. It does not render a screen.
#
# A refused command is answered with a generic "error" that carries the request ID, for example
# rate_limited. Before Stage 44 the tracker ignored it, so a business request waited for its
# timeout and was then reported as possibly unconfirmed. This test checks the tracker's answer to
# each kind of reply. The wiring from the socket to the tracker is checked from the source by
# services/world-api/test/client-business-errors-stage44.test.mjs.
#
# Run: godot --headless --path game --script res://tests/business_request_errors_headless.gd

const TrackerScript := preload("res://scripts/services/server_request_tracker.gd")

var _checks: int = 0
var _failures: Array[String] = []


func _initialize() -> void:
	_run()
	_finish()


func _check(condition: bool, label: String) -> void:
	_checks += 1
	if not condition:
		_failures.append(label)
		printerr("FAIL: %s" % label)


func _run() -> void:
	_check_refused_command_resolves()
	_check_other_id_does_not_answer()
	_check_internal_error_is_unconfirmed()
	_check_typed_refusal_resolves()
	_check_unsaved_typed_error_is_kept()
	_check_classification()


# A refused command: a generic error with the pending ID resolves the request.
# It is not unconfirmed.
func _check_refused_command_resolves() -> void:
	var tracker = TrackerScript.new()
	var request_id: String = tracker.begin("create", {"name": "Shop"})
	_check(not request_id.is_empty(), "a business request starts")
	_check(tracker.is_waiting(), "the request waits for the server")
	var reply := {"type": "error", "code": "rate_limited", "requestId": request_id}
	_check(tracker.apply_reply(reply), "a rate_limited error with the pending ID answers it")
	_check(not tracker.has_pending(), "after rate_limited the request is no longer pending")
	_check(not tracker.is_unconfirmed(), "after rate_limited it is not reported as unconfirmed")


# A generic error with another ID does not answer the pending request.
func _check_other_id_does_not_answer() -> void:
	var tracker = TrackerScript.new()
	tracker.begin("create", {"name": "Shop"})
	var reply := {"type": "error", "code": "rate_limited", "requestId": "some-other-request"}
	_check(not tracker.apply_reply(reply), "an error with another ID does not answer the request")
	_check(tracker.is_waiting(), "the pending request keeps waiting when another ID is answered")


# internal_error may follow an applied change, so the request is kept for a retry, unconfirmed.
func _check_internal_error_is_unconfirmed() -> void:
	var tracker = TrackerScript.new()
	var request_id: String = tracker.begin("restock", {"quantity": 10})
	var reply := {"type": "error", "code": "internal_error", "requestId": request_id}
	_check(tracker.apply_reply(reply), "internal_error with the pending ID answers it")
	_check(tracker.has_pending(), "internal_error keeps the request for a retry")
	_check(tracker.is_unconfirmed(), "internal_error marks the request unconfirmed")


# A typed business refusal still resolves the request, as before.
func _check_typed_refusal_resolves() -> void:
	var tracker = TrackerScript.new()
	var request_id: String = tracker.begin("restock", {"quantity": 0})
	var reply := {
		"type": "business.error", "code": "business_action_invalid", "requestId": request_id,
	}
	_check(tracker.apply_reply(reply), "a typed business refusal answers the request")
	_check(not tracker.has_pending(), "a typed business refusal resolves the request")


# An unsaved typed error keeps the request for a retry, as before.
func _check_unsaved_typed_error_is_kept() -> void:
	var tracker = TrackerScript.new()
	var request_id: String = tracker.begin("pay_salary", {"amount_ngn": 5000})
	var reply := {"type": "business.error", "code": "salary_not_saved", "requestId": request_id}
	_check(tracker.apply_reply(reply), "an unsaved typed error answers the request")
	_check(tracker.has_pending() and tracker.is_unconfirmed(), "an unsaved error is kept for retry")


# The unconfirmed-code classification.
func _check_classification() -> void:
	_check(TrackerScript.is_unconfirmed_code("internal_error"), "internal_error is unconfirmed")
	_check(TrackerScript.is_unconfirmed_code("business_x_not_saved"), "a _not_saved code")
	_check(not TrackerScript.is_unconfirmed_code("rate_limited"), "rate_limited is a refusal")
	_check(not TrackerScript.is_unconfirmed_code("business_action_invalid"), "validation is a refusal")


func _finish() -> void:
	if _failures.is_empty():
		print("PASS: %d business request error checks (headless, logic only)" % _checks)
		quit(0)
	else:
		print("FAIL: %d of %d checks failed" % [_failures.size(), _checks])
		quit(1)
