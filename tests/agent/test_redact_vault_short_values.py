"""The vault-value scrub must redact the secret, and only the secret.

A vault fill registers the exact bytes it typed into the page (``register_vault_redaction_value``)
so every later tool result that echoes them is scrubbed before it reaches the model. The scrub used
to be a plain substring replace, so a short registered value (a 6-digit one-time code, a 3-digit
CVC) rewrote every number that merely CONTAINED it: a dashboard report's ``2026-11-11`` became
``2026-«redacted-vault-secret»«redacted-vault-secret»-«redacted-vault-secret»«redacted-vault-secret»``
and its record count, IP and latency columns were unreadable. The value is only a leak where it
stands alone as a token.
"""

import pytest


@pytest.fixture(autouse=True)
def _clear_registry():
    from agent import redact

    redact.clear_vault_redaction_values()
    try:
        yield
    finally:
        redact.clear_vault_redaction_values()


class TestShortRegisteredValuesDoNotCorruptNumbers:
    def test_single_digit_value_leaves_dates_counts_and_ip_untouched(self):
        """The operator-visible symptom: registering a one-digit value mangled every number."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("1")
        report = "date=2026-11-11 count=170 addr=192.0.2.200 200-201"
        assert redact_registered_vault_values(report) == report

    def test_one_time_code_is_still_masked_where_it_stands_alone(self):
        """The scrub is not weakened: a standalone value is the leak it exists to catch."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("482913")
        text = "Your code is 482913 (valid 10 minutes)"
        scrubbed = redact_registered_vault_values(text)
        assert "482913" not in scrubbed
        assert "«redacted-vault-secret»" in scrubbed
        assert scrubbed.startswith("Your code is ")

    def test_value_inside_a_longer_digit_run_is_left_alone(self):
        """``170`` inside ``1170``, ``1700`` or ``192.0.170.2`` is part of another number."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("170")
        text = "rows=1170 batch=1700 ip=192.0.170.2 at=2026-11-11T10:46"
        assert redact_registered_vault_values(text) == text

    def test_two_digit_value_does_not_rewrite_a_date_segment(self):
        """A two-digit code is nothing but a date's or a version's segment part of the time."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("11")
        report = "date=2026-11-11 released=1.11.0 at=11:00:00 count=11"
        scrubbed = redact_registered_vault_values(report)
        assert "2026-«redacted-vault-secret»-«redacted-vault-secret»" not in scrubbed
        assert scrubbed.startswith("date=2026-11-11 released=1.11.0 at=11:00:00")
        # ``count=11`` IS the value standing alone: that one is the secret's own occurrence.
        assert scrubbed.endswith("count=«redacted-vault-secret»")

    def test_punctuation_edged_value_is_masked_even_when_glued(self):
        """A password that opens on punctuation has no word character to collide with."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("!Secr3t!")
        scrubbed = redact_registered_vault_values('password="!Secr3t!" user=abc')
        assert "!Secr3t!" not in scrubbed
        assert scrubbed == 'password="«redacted-vault-secret»" user=abc'

    def test_value_adjacent_to_trailing_punctuation_is_masked(self):
        """Quotes/brackets/commas are token edges, not word characters."""
        from agent.redact import redact_registered_vault_values, register_vault_redaction_value

        register_vault_redaction_value("hunter2x")
        text = "otp ('hunter2x'), then dot.hunter2x."
        scrubbed = redact_registered_vault_values(text)
        assert "hunter2x" not in scrubbed
        assert scrubbed.count("«redacted-vault-secret»") == 2
