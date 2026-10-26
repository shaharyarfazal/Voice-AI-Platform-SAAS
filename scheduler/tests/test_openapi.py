from scripts.export_openapi import OUT, build


def test_agent_openapi_is_up_to_date():
    assert OUT.read_text() == build(), "run: python -m scripts.export_openapi"


def test_agent_spec_covers_the_tools():
    spec = build()
    for path in ("/agent/check_availability", "/agent/hold_slot", "/agent/book_appointment", "/agent/find_appointments",
                 "/agent/reschedule_appointment", "/agent/cancel_appointment", "/calls/{call_id}/artifacts"):
        assert path in spec
    assert "/v1/" not in spec
