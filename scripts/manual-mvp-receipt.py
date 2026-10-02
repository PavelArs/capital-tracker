#!/usr/bin/env python3
"""Write the release receipt that the owner reviews and installs for the dispatcher.

Usage: manual-mvp-receipt.py COMMIT RUN_ID INSTALLATION BACKEND FRONTEND POSTGRES OUTPUT

Run from the reviewed checkout of COMMIT after the identical tested images were
promoted. File digests describe the server files the owner must install; image
references are immutable registry digests. The receipt contains no secrets.
"""

import hashlib
import importlib.util
import io
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = {
    'runner': 'scripts/manual-mvp-release.sh',
    'inventory': 'scripts/manual-mvp-inventory.sh',
    'normalizer': 'scripts/normalize-release-snapshot.awk',
    'compose': 'docker-compose.yml',
    'pins': 'deploy/manual-mvp-infrastructure-pins.json',
    'resume': 'scripts/manual-mvp-resume.py',
}

_spec = importlib.util.spec_from_file_location('manual_mvp_dispatcher', ROOT / 'scripts/manual-mvp-dispatcher.py')
dispatcher = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dispatcher)


def build_receipt(commit, run_id, installation, backend, frontend, postgres, root=ROOT):
    root = pathlib.Path(root)
    pins = dispatcher.parse_json((root / SOURCES['pins']).read_bytes())
    receipt = {
        'version': 1,
        'commit': commit,
        'runId': run_id,
        'installation': installation,
        'backend': backend,
        'frontend': frontend,
        'postgres': postgres,
        'redis': pins['redis']['registryDigest'],
        'files': {name: hashlib.sha256((root / path).read_bytes()).hexdigest() for name, path in SOURCES.items()},
    }
    if installation == 'resume-fresh':
        receipt['resumeOrigin'] = pins['resumeOrigin']
    request = {'version': 1, 'operation': 'deploy', 'commit': commit, 'runId': run_id}
    for field, pattern in (('commit', dispatcher.COMMIT), ('runId', dispatcher.RUN_ID)):
        if not dispatcher._full(pattern, request[field]):
            raise dispatcher.Refusal('malformed ' + field)
    return dispatcher.validate_receipt(request, receipt)


def validate_bootstrap_receipt(path, postgres, redis, expected_commit, root=ROOT, owner_uid=0, stop_at=None):
    """Read root-reviewed metadata before bootstrap; final deploy approval is separate."""
    _, content = dispatcher.check_trusted_file(pathlib.Path(path), owner_uid, stop_at)
    receipt = dispatcher.parse_json(content)
    request = dispatcher.read_request(io.BytesIO(json.dumps({
        'version': 1, 'operation': 'deploy', 'commit': receipt.get('commit'), 'runId': receipt.get('runId'),
    }).encode()))
    dispatcher.validate_receipt(request, receipt)
    if receipt['commit'] != expected_commit:
        raise dispatcher.Refusal('bootstrap checkout differs from reviewed receipt')
    if receipt['installation'] != 'fresh' or receipt['postgres'] != postgres or receipt['redis'] != redis:
        raise dispatcher.Refusal('bootstrap differs from reviewed fresh receipt')
    for name, source in SOURCES.items():
        if hashlib.sha256((pathlib.Path(root) / source).read_bytes()).hexdigest() != receipt['files'][name]:
            raise dispatcher.Refusal('bootstrap source differs from reviewed receipt')
    pins = dispatcher.parse_json((pathlib.Path(root) / SOURCES['pins']).read_bytes())
    if pins['redis']['registryDigest'] != redis:
        raise dispatcher.Refusal('bootstrap Redis differs from reviewed pin')
    return receipt


def main(argv):
    if len(argv) != 8:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        receipt = build_receipt(*argv[1:7])
    except (dispatcher.Refusal, KeyError, TypeError, OSError) as error:
        print('receipt refused: {}'.format(error), file=sys.stderr)
        return 1
    pathlib.Path(argv[7]).write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
