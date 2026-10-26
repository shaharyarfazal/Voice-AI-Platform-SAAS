from .base import Assigner, Choice
from .least_busy import LeastBusy

# Strict round-robin, weighted and priority modes arrive in Phase 4; until then they fall back to
# least-busy and the fallback is recorded in each booking's assignment_reason.
_ASSIGNERS: dict[str, Assigner] = {"least_busy": LeastBusy()}


def assigner_for(mode: str) -> tuple[Assigner, bool]:
    """The assigner for `mode`, and whether it's a fallback for a mode not implemented yet."""
    if mode in _ASSIGNERS:
        return _ASSIGNERS[mode], False
    return _ASSIGNERS["least_busy"], True


__all__ = ["Assigner", "Choice", "assigner_for"]
