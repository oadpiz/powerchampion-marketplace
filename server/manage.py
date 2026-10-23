"""Local administrator bootstrap, operator-assisted account recovery and the phone agent's retention run.

Passwords are read from a hidden prompt or a server-only environment variable;
they must never be supplied as command-line arguments or printed.
"""
import argparse
import getpass
import json
import os
import sys
import time

from .security import digest_token, normalize_email, password_hash, validate_password
from .settings import Settings
from .store import Store


def read_password(variable):
    value = os.environ.get(variable)
    if value is None:
        value = getpass.getpass("Password (12 to 128 characters): ")
        if value != getpass.getpass("Confirm password: "):
            raise ValueError("Passwords do not match.")
    return validate_password(value)


def reset_password(store, email, password):
    email = normalize_email(email)
    encoded = password_hash(validate_password(password))
    with store.connect() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if not row:
            raise ValueError("Account not found.")
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (encoded, row["id"]))
        con.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
        # NULL actor denotes a trusted local operator, not the customer.
        store.audit(con, "account.password_reset_by_operator", None, row["id"])
        con.execute("DELETE FROM login_attempts WHERE scope=?", ("login:" + digest_token(email),))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Power Champion portal local administration")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin", help="Create a separate administrator account")
    create.add_argument("--email", required=True)
    create.add_argument("--name", default="Administrator")
    reset = commands.add_parser("reset-password", help="Reset a customer's or administrator's password and revoke all sessions")
    reset.add_argument("--email", required=True)
    commands.add_parser("voice-retention", help="Run the phone agent's retention schedule once (phase2-contract §16.4, §16.5)")
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        store = Store(settings.resolved_database_url)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    try:
        if args.command == "voice-retention":
            from .voice_retention import sweep

            # Counts only: never a call id, number or note.
            print(json.dumps(sweep(store, int(time.time()), settings.voice_call_retention_days), sort_keys=True))
            return 0
        if args.command == "create-admin":
            store.create_user(args.email, args.name, read_password("PC_PORTAL_ADMIN_PASSWORD"), role="admin")
            print("Administrator created. Sign in through the portal.")
        else:
            reset_password(store, args.email, read_password("PC_PORTAL_NEW_PASSWORD"))
            print("Password reset. All existing sessions for this account were revoked.")
        return 0
    except store.IntegrityError:
        print("An account already exists for this email. No role was changed.", file=sys.stderr)
    except ValueError as error:
        print(str(error), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
