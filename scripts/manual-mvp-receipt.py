#!/usr/bin/env python3
"""Write the release receipt that the owner reviews and installs for the dispatcher.

Usage: manual-mvp-receipt.py COMMIT RUN_ID INSTALLATION BACKEND FRONTEND OUTPUT

Run from the reviewed checkout of COMMIT after the identical tested images were
promoted. File digests describe the server files the owner must install; image
references are immutable registry digests. The receipt contains no secrets.
"""

import hashlib
import importlib.util
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
}

_spec = importlib.util.spec_from_file_location('manual_mvp_dispatcher', ROOT / 'scripts/manual-mvp-dispatcher.py')
dispatcher = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dispatcher)


def build_receipt(commit, run_id, installation, backend, frontend, root=ROOT):
    root = pathlib.Path(root)
    pins = dispatcher.parse_json((root / SOURCES['pins']).read_bytes())
    receipt = {
        'version': 1,
        'commit': commit,
        'runId': run_id,
        'installation': installation,
        'backend': backend,
        'frontend': frontend,
        'postgres': pins['postgres']['registryDigest'],
        'redis': pins['redis']['registryDigest'],
        'files': {name: hashlib.sha256((root / path).read_bytes()).hexdigest() for name, path in SOURCES.items()},
    }
    request = {'version': 1, 'operation': 'deploy', 'commit': commit, 'runId': run_id}
    for field, pattern in (('commit', dispatcher.COMMIT), ('runId', dispatcher.RUN_ID)):
        if not dispatcher._full(pattern, request[field]):
            raise dispatcher.Refusal('malformed ' + field)
    return dispatcher.validate_receipt(request, receipt)


def main(argv):
    if len(argv) != 7:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        receipt = build_receipt(*argv[1:6])
    except (dispatcher.Refusal, KeyError, TypeError, OSError) as error:
        print('receipt refused: {}'.format(error), file=sys.stderr)
        return 1
    pathlib.Path(argv[6]).write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
