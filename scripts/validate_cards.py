#!/usr/bin/env python3
"""Validate every term card against the JSON Schema, in CI.

This is the real validation. scripts/build.mjs carries a dependency-free lint so
that `node scripts/build.mjs` works anywhere, but the schema is the contract and
CI is where it is enforced.

Usage: validate_cards.py <cards-dir> <schema-file>
"""

from __future__ import annotations

import json
import pathlib
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    print("jsonschema is not installed. Run: pip install jsonschema")
    sys.exit(2)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2

    cards_dir = pathlib.Path(argv[1])
    schema_path = pathlib.Path(argv[2])

    if not cards_dir.is_dir():
        print(f"not a directory: {cards_dir}")
        return 2

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    paths = sorted(cards_dir.glob("*.json"))
    if not paths:
        print(f"no cards found in {cards_dir}")
        return 1

    errors = 0
    seen: dict[str, str] = {}

    for path in paths:
        try:
            card = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"{path}: invalid JSON — {exc}")
            errors += 1
            continue

        for error in sorted(validator.iter_errors(card), key=lambda e: list(e.path)):
            location = "/".join(str(part) for part in error.path) or "(card)"
            print(f"{path}: {location}: {error.message}")
            errors += 1

        card_id = card.get("id")
        if isinstance(card_id, str):
            if card_id != path.stem:
                print(f"{path}: id {card_id!r} does not match the filename")
                errors += 1
            if card_id in seen:
                print(f"{path}: duplicate id {card_id!r}, already in {seen[card_id]}")
                errors += 1
            seen[card_id] = path.name

    print(f"\nvalidated {len(paths)} card(s) against {schema_path.name}: {errors} error(s)")
    if not errors:
        print("note: schema-valid is not the same as reviewed. Cards without a reviewer display as unreviewed.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
