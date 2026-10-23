def can_modify_role(current_emp, target_emp):
    current_role = current_emp.role.name.lower()
    target_role = target_emp.role.name.lower()

    if current_role == "owner":
        return target_role != "owner"

    if current_role == "manager":
        return target_role == "staff"

    return False

# ── Location-scoped guards ────────────────────────────────────────────────────
# Every location-scoped endpoint must check the caller's employment *at that
# location*. Checking "is a manager somewhere" lets a manager at company A read
# company B's data by changing location_id in the request.

MANAGER_ROLES  = ("owner", "manager", "supervisor")
APPROVER_ROLES = ("owner", "manager")


def location_employment(user_id: int, location_id: int):
    from models import Employment
    if not location_id:
        return None
    return Employment.query.filter_by(
        user_id=user_id, location_id=location_id, status="active"
    ).first()


def require_location_member(user_id: int, location_id: int):
    emp = location_employment(user_id, location_id)
    if not emp:
        raise PermissionError("Not an employee at this location")
    return emp


def require_location_role(user_id: int, location_id: int, roles=MANAGER_ROLES):
    emp = require_location_member(user_id, location_id)
    if (emp.role.name if emp.role else "").lower() not in roles:
        raise PermissionError("Manager access required")
    return emp


def company_role_employment(user_id: int, roles=APPROVER_ROLES):
    """The caller's first active employment holding one of `roles`, or None."""
    from models import Employment
    for emp in Employment.query.filter_by(user_id=user_id, status="active").all():
        if emp.role and emp.role.name.lower() in roles:
            return emp
    return None
