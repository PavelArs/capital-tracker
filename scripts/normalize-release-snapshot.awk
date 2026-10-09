# PostgreSQL 16/18 reparse normalization: six EXACT reviewed equivalent CHECK lines.
# Every other DDL/operand and every COPY row is preserved. Unsupported rewrites fail comparison.
# COPY rows keep every byte but are emitted in byte order within their table: a restore need
# not reproduce the source's physical row order, which carries no meaning.
BEGIN {
  sorter = "LC_ALL=C sort"
  normalized["    CONSTRAINT account_csv_imports_check CHECK ((((\"byteLength\" >= 1) AND (\"byteLength\" <= 262144)) AND (octet_length(\"originalBytes\") = \"byteLength\"))),"] = "    CONSTRAINT account_csv_imports_check CHECK (((\"byteLength\" >= 1) AND (\"byteLength\" <= 262144) AND (octet_length(\"originalBytes\") = \"byteLength\"))),"
  normalized["    CONSTRAINT account_csv_imports_filename_check CHECK ((((length(filename) >= 1) AND (length(filename) <= 120)) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),"] = "    CONSTRAINT account_csv_imports_filename_check CHECK (((length(filename) >= 1) AND (length(filename) <= 120) AND (POSITION(('/'::text) IN (filename)) = 0) AND (POSITION((chr(92)) IN (filename)) = 0) AND (filename !~ ((((((('['::text || chr(1)) || '-'::text) || chr(31)) || chr(127)) || '-'::text) || chr(159)) || ']'::text)))),"
  normalized["    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY ((ARRAY['anonymous'::character varying, 'pending_mfa'::character varying, 'authenticated'::character varying])::text[]))),"] = "    CONSTRAINT auth_sessions_state_check CHECK (((state)::text = ANY (ARRAY[('anonymous'::character varying)::text, ('pending_mfa'::character varying)::text, ('authenticated'::character varying)::text]))),"
  normalized["    CONSTRAINT \"owner_settings_mainCurrency_check\" CHECK (((\"mainCurrency\")::text = ANY ((ARRAY['USD'::character varying, 'EUR'::character varying, 'RUB'::character varying])::text[]))),"] = "    CONSTRAINT \"owner_settings_mainCurrency_check\" CHECK (((\"mainCurrency\")::text = ANY (ARRAY[('USD'::character varying)::text, ('EUR'::character varying)::text, ('RUB'::character varying)::text]))),"
  normalized["    CONSTRAINT account_trade_version_payments_currency_check CHECK (((currency)::text = ANY ((ARRAY['RUB'::character varying, 'EUR'::character varying])::text[]))),"] = "    CONSTRAINT account_trade_version_payments_currency_check CHECK (((currency)::text = ANY (ARRAY[('RUB'::character varying)::text, ('EUR'::character varying)::text]))),"
  normalized["    CONSTRAINT \"account_trade_version_payments_rateSource_check\" CHECK (((\"rateSource\")::text = ANY ((ARRAY['bank-of-russia'::character varying, 'owner'::character varying])::text[])))"] = "    CONSTRAINT \"account_trade_version_payments_rateSource_check\" CHECK (((\"rateSource\")::text = ANY (ARRAY[('bank-of-russia'::character varying)::text, ('owner'::character varying)::text])))"
}
{
  if (copy_data) {
    if ($0 == "\\.") {
      close(sorter)
      copy_data = 0
      print
    } else print | sorter
    next
  }
  if (body_tag != "") {
    print
    if (index($0, body_tag)) body_tag = ""
    next
  }
  if ($0 ~ /^COPY .* FROM stdin;$/) {
    copy_data = 1
    print
    # The sorted rows go straight to standard output, so everything before them goes first.
    fflush()
    next
  }
  if ($0 ~ /^--/ || $0 ~ /^\\(un)?restrict /) next
  if (match($0, /\$[A-Za-z0-9_]*\$/)) {
    tag = substr($0, RSTART, RLENGTH)
    if (!index(substr($0, RSTART + RLENGTH), tag)) body_tag = tag
  }
  print (($0 in normalized) ? normalized[$0] : $0)
}
