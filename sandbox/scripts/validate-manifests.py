#!/usr/bin/env python3
"""Offline structural validation for app/k8s + sandbox fixtures.

kubectl dry-run needs a reachable API server even in client mode (GVK
discovery), so this script covers the offline case instead: YAML syntax plus
the cross-references that most often break (namespaces, secret keys,
access.json shape, consumer deployment refs). Real server-side validation
happens when `make seed` applies the fixtures to kind.
"""
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
APP_K8S = ROOT / "app" / "k8s"
FIXTURES = ROOT / "sandbox" / "kind" / "fixtures"

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def load_docs(path: Path):
    try:
        return [d for d in yaml.safe_load_all(path.read_text()) if d]
    except yaml.YAMLError as e:
        fail(f"{path}: invalid YAML: {e}")
        return []


def main() -> int:
    docs: list[tuple[Path, dict]] = []
    for base in (APP_K8S, FIXTURES):
        for path in sorted(base.rglob("*.yaml")):
            for doc in load_docs(path):
                docs.append((path, doc))

    namespaces = set()
    secrets: dict[tuple[str, str], set[str]] = {}  # (ns, name) -> stringData keys
    access_rules: dict[str, dict] = {}
    fixture_access_rules: dict[str, dict] = {}  # sandbox fixtures only

    for path, doc in docs:
        rel = path.relative_to(ROOT)
        for field in ("apiVersion", "kind"):
            if field not in doc:
                fail(f"{rel}: missing '{field}'")
        meta = doc.get("metadata", {}) or {}
        if "name" not in meta:
            fail(f"{rel}: missing 'metadata.name'")
        kind = doc.get("kind")
        name = meta.get("name", "?")
        ns = meta.get("namespace")

        if kind == "Namespace":
            namespaces.add(name)
        elif kind == "Secret":
            data = doc.get("stringData", {}) or {}
            if not isinstance(data, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in data.items()
            ):
                fail(f"{rel}: Secret/{name} stringData must be a string map")
            secrets[(ns or "default", name)] = set(data)
        elif kind == "ConfigMap" and name == "krypton-access":
            raw = (doc.get("data", {}) or {}).get("access.json", "{}")
            try:
                parsed = json.loads(raw)
                if not isinstance(parsed, dict):
                    raise ValueError("top level must be an object")
                access_rules.update(parsed)
                # app/k8s holds a documentation example (may name namespaces
                # that don't exist here); only fixture rules must resolve.
                if str(rel).startswith("sandbox/"):
                    fixture_access_rules.update(parsed)
            except (ValueError, json.JSONDecodeError) as e:
                fail(f"{rel}: access.json invalid: {e}")
        elif kind == "Deployment":
            containers = (
                (doc.get("spec", {}) or {}).get("template", {}).get("spec", {}).get("containers", [])
            )
            if not containers:
                fail(f"{rel}: Deployment/{name} has no containers")

    # Cross-reference checks on the sandbox fixtures.
    for base_ns in ("krypton-test", "frontend-ns"):
        if base_ns not in namespaces:
            fail(f"fixtures: expected Namespace/{base_ns}")
    for ruled_ns in fixture_access_rules:
        if ruled_ns not in namespaces:
            fail(f"access.json: references unknown fixture namespace '{ruled_ns}'")

    # Consumer deployment must reference secrets that exist in the fixtures.
    for path, doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        rel = path.relative_to(ROOT)
        ns = (doc.get("metadata", {}) or {}).get("namespace", "default")
        spec = ((doc.get("spec", {}) or {}).get("template", {}) or {}).get("spec", {}) or {}
        refs: list[tuple[str, str | None]] = []  # (secretName, key or None)
        for c in spec.get("containers", []) or []:
            for e in c.get("env", []) or []:
                ref = ((e.get("valueFrom", {}) or {}).get("secretKeyRef", {}) or {})
                if ref.get("name"):
                    refs.append((ref["name"], ref.get("key")))
            for ef in c.get("envFrom", []) or []:
                sref = ef.get("secretRef", {}) or {}
                if sref.get("name"):
                    refs.append((sref["name"], None))
        for v in spec.get("volumes", []) or []:
            s = (v.get("secret", {}) or {}).get("secretName")
            if s:
                refs.append((s, None))
        for secret_name, key in refs:
            keys = secrets.get((ns, secret_name))
            if keys is None:
                fail(f"{rel}: references unknown Secret/{ns}/{secret_name}")
            elif key is not None and key not in keys:
                fail(f"{rel}: Secret/{ns}/{secret_name} has no key '{key}'")

    if errors:
        print(f"{len(errors)} manifest problem(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"OK: {len(docs)} documents across app/k8s + sandbox fixtures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
