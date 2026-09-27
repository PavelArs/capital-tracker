# PostgreSQL16.10 reparse normalization: three EXACT reviewed equivalent CHECK lines.
# Every other DDL/operand and every COPY row is preserved. Unsupported rewrites fail comparison.
BEGIN {
  normalized["    CONSTRAINT account_csv_imports_check CHECK ((((\"byteLength\" >= 1) AND (\"byteLength\" <= 262144)) AND (octet_length(\"originalBytes\") = \"byteLength\"))),"] = "    CONSTRAINT account_csv_imports_check CHECK (((\"byteLength\" >= 1) AND (\"byteLength\" <= 262144) AND (octet_length(\"originalBytes\") = \"byteLength\"))),"
  normalized["    CONSTRAINT account_csv_imports_filename_check CHECK ((((length(filename) >= 1) AND (length(filename) <= 120)) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),"] = "    CONSTRAINT account_csv_imports_filename_check CHECK (((length(filename) >= 1) AND (length(filename) <= 120) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),"
  normalized["    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY ((ARRAY['anonymous'::character varying, 'pending_mfa'::character varying, 'authenticated'::character varying])::text[]))),"] = "    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY (ARRAY[('anonymous'::character varying)::text, ('pending_mfa'::character varying)::text, ('authenticated'::character varying)::text]))),"
}
{
  if (copy_data) {
    print
    if ($0 == "\\.") copy_data = 0
    next
  }
  if (body_tag != "") {
    print
    if (index($0, body_tag)) body_tag = ""
    next
  }
  if ($0 ~ /^COPY .* FROM stdin;$/) { copy_data = 1; print; next }
  if ($0 ~ /^--/ || $0 ~ /^\\(un)?restrict /) next
  if (match($0, /\$[A-Za-z0-9_]*\$/)) {
    tag = substr($0, RSTART, RLENGTH)
    if (!index(substr($0, RSTART + RLENGTH), tag)) body_tag = tag
  }
  print (($0 in normalized) ? normalized[$0] : $0)
}
