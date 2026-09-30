#!/usr/bin/env bash
# Root-only read-only assessment. Never source configuration or emit private values.
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Root inspection required'; exit 1; }
root=/opt/capital-tracker
python3 - "$root" <<'PY'
import json,re,subprocess,sys
from pathlib import Path
from urllib.parse import urlsplit
root=Path(sys.argv[1]); env=root/'.env'
phase='start'
def refuse(reason,detail=''):
    print('fresh_setup_gate=blocked; reason='+reason+'; phase='+phase+detail);sys.exit(1)
def error_class(error):
    # Coarse, value-free class names only; messages may contain private values.
    for kind in (UnicodeError,json.JSONDecodeError,OSError,KeyError,TypeError,AttributeError,ValueError):
        if isinstance(error,kind): return kind.__name__
    return 'Exception'
def docker(*args):
    # Docker stderr may echo private names; it is captured and never printed.
    result=subprocess.run(['docker',*args],capture_output=True,text=True)
    if result.returncode: refuse('inventory_unavailable')
    return result.stdout
def labels(item):
    # Docker reports absent labels as null. Other shapes must not erase evidence.
    if not isinstance(item,dict) or 'Labels' not in item: refuse('inventory_unavailable')
    value=item['Labels']
    if value is None: return {}
    if not isinstance(value,dict) or any(not isinstance(v,str) for v in value.values()):
        refuse('inventory_unavailable')
    return value
def inspect_records(records,requested,kind):
    if not isinstance(records,list) or len(records)!=len(requested) or len(set(requested))!=len(requested):
        refuse('inventory_unavailable')
    identities=[]
    for record in records:
        if not isinstance(record,dict): refuse('inventory_unavailable')
        name=record.get('Name')
        identity=record.get('Name' if kind=='volume' else 'Id')
        if not isinstance(name,str) or not name or not isinstance(identity,str) or not identity:
            refuse('inventory_unavailable')
        identities.append(identity)
        labels(record.get('Config') if kind=='container' else record)
        if kind=='container':
            if 'Mounts' not in record: refuse('inventory_unavailable')
            mounts=record['Mounts']
            if mounts is not None:
                if not isinstance(mounts,list): refuse('inventory_unavailable')
                for mount in mounts:
                    if not isinstance(mount,dict): refuse('inventory_unavailable')
                    mount_type=mount.get('Type');source=mount.get('Source')
                    if not isinstance(mount_type,str) or not mount_type or not isinstance(source,str):
                        refuse('inventory_unavailable')
                    if mount_type=='bind' and not source: refuse('inventory_unavailable')
    if len(set(identities))!=len(identities): refuse('inventory_unavailable')
    # ps/network ls normally return short hex IDs; inspect returns full IDs.
    # Every requested resource must have exactly one distinct inspected record.
    matched=[]
    for requested_id in requested:
        candidates=[identity for identity in identities if identity==requested_id or
            (kind!='volume' and re.fullmatch(r'[a-f0-9]{12,64}',requested_id) and
             re.fullmatch(r'[a-f0-9]{64}',identity) and identity.startswith(requested_id))]
        if len(candidates)!=1: refuse('inventory_unavailable')
        matched.extend(candidates)
    if len(set(matched))!=len(records): refuse('inventory_unavailable')
try:
    phase='docker_inventory'
    container_ids=docker('ps','-aq').split()
    volume_names=docker('volume','ls','-q').split()
    network_ids=docker('network','ls','-q').split()
    containers=json.loads(docker('inspect',*container_ids)) if container_ids else []
    volumes=json.loads(docker('volume','inspect',*volume_names)) if volume_names else []
    networks=json.loads(docker('network','inspect',*network_ids)) if network_ids else []
    inspect_records(containers,container_ids,'container')
    inspect_records(volumes,volume_names,'volume')
    inspect_records(networks,network_ids,'network')
    phase='docker_classification'
    def related(value): return bool(re.search(r'capital|tracker',str(value),re.I))
    mounts=[m for c in containers for m in (c.get('Mounts') or [])]
    container_refs=sum(related(c.get('Name','')) or related(labels(c['Config']).get('com.docker.compose.project','')) for c in containers)
    volume_refs=sum(related(v.get('Name','')) or related(labels(v).get('com.docker.compose.project','')) for v in volumes)
    network_refs=sum(related(n.get('Name','')) or related(labels(n).get('com.docker.compose.project','')) for n in networks)
    # A project-backed source is data evidence even for an unfamiliar mount type.
    bind_refs=sum(m['Source']==str(root) or m['Source'].startswith(str(root)+'/') for m in mounts)
    print(f'application_container_references={container_refs}; volume_references={volume_refs}; network_references={network_refs}; project_bind_references={bind_refs}')
    if container_refs or volume_refs or network_refs or bind_refs: refuse('existing_application_data_references')
    phase='env_read'
    if not env.is_file() or env.is_symlink(): refuse('existing_env_unavailable_or_symlink')
    text=env.read_bytes().decode('utf-8')
    phase='env_parse'
    values={}; malformed=False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        match=re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*',line)
        if not match: malformed=True;continue
        key,value=match.groups()
        if key in values: malformed=True
        if value.startswith(('"',"'")):
            quote=value[0]; close=value.find(quote,1)
            if close<0 or (value[close+1:].strip() and not value[close+1:].lstrip().startswith('#')): malformed=True
            value=value[1:close] if close>=0 else ''
        else: value=re.split(r'\s+#',value,maxsplit=1)[0].strip()
        # No expansion/escape interpretation: uncertain syntax blocks fresh setup.
        if any(token in value for token in ('$', '`', '\\')): malformed=True
        values[key]=value
    connection={key for key in values if re.search(r'(^|_)(DB|DATABASE|POSTGRES|PG[A-Z_]*|MYSQL|MONGO|TYPEORM)(_|$)',key)}
    recognized={'DB_HOST','DB_PORT','DB_NAME','DB_USERNAME','DB_PASSWORD','DATABASE_URL','DB_URL','POSTGRES_URL','POSTGRES_HOST','POSTGRES_PORT','POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE'}
    unknown=bool(connection-recognized)
    targets=[]
    local={'postgres','db','capital_tracker_db'}
    for key in ('DB_HOST','POSTGRES_HOST','PGHOST'):
        if key in values:
            targets.append('local_dedicated' if values[key] in local else 'local_native' if values[key] in {'localhost','127.0.0.1','::1'} else 'external' if values[key] else 'unrecognized')
    for key in ('DATABASE_URL','DB_URL','POSTGRES_URL'):
        if key in values:
            parsed=urlsplit(values[key]);host=parsed.hostname
            targets.append('local_dedicated' if host in local and parsed.scheme in {'postgres','postgresql'} else 'local_native' if host in {'localhost','127.0.0.1','::1'} else 'external' if host else 'unrecognized')
    if values.get('PGSERVICE'): targets.append('unrecognized')
    if connection and not targets: targets.append('unrecognized')
    print('database_connection_key_names='+','.join(sorted(connection)))
    print('database_target_classes='+(','.join(sorted(set(targets))) or 'not_configured'))
    phase='project_entries'
    unexpected=sum(p.name not in {'.env','.gitignore'} for p in root.iterdir())
    print('unexpected_project_data_entries='+str(unexpected))
    print('existing_env_preserved=yes')
    if malformed or unknown or 'unrecognized' in targets: refuse('configuration_requires_private_review')
    if 'external' in targets or 'local_native' in targets: refuse('external_or_native_database_requires_private_review')
    if unexpected: refuse('unexpected_project_data_entries')
    print('fresh_setup_gate=passed; existing configuration preserved; no data modified')
except SystemExit:
    raise
except Exception as error:
    refuse('assessment_unavailable','; error_class='+error_class(error))
PY
