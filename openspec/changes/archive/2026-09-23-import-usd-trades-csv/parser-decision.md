# Parser and upload decision

## Selected package and boundary

Pin backend-only **csv-parse 7.0.2**, MIT, synchronous CommonJS/TypeScript API
`csv-parse/sync`, with a small strict application adapter. The tagged package has no
runtime dependencies or engines field; documented CommonJS support covers the project's
Node 22 line. Version 7.0.2 fixes prototype replacement through `columns`. Still parse
arrays, never objects created from hostile headers. Verify build, frozen install,
production audit and exact Node 22.21.1 release behavior after installation; these are
required checks, not claims established by package selection. [Tagged package](https://raw.githubusercontent.com/adaltas/node-csv/csv-parse@7.0.2/packages/csv-parse/package.json),
[tagged changelog](https://raw.githubusercontent.com/adaltas/node-csv/csv-parse@7.0.2/packages/csv-parse/CHANGELOG.md),
[CommonJS distribution](https://csv.js.org/parse/distributions/nodejs_cjs/),
[sync API](https://csv.js.org/parse/api/sync/).

A handwritten scanner would unnecessarily own quotes, embedded newlines and malformed
input. Browser parsing cannot establish server acceptance. Streaming and a separate
filesystem lifecycle are unnecessary for a 256 KiB original. Base64 JSON would expand
source size and require a larger JSON body policy. Keep one authoritative backend
parser, private database bytes and ordinary browser FormData.

The normative lexical/data/DTO contract is [persistence.md](persistence.md). The
application semantic version `usd-csv-v1` is distinct from the npm version: accepted
command replay precedes current parser support or source parsing. An unsupported new
command requires explicit re-preview rather than silently reinterpreting a draft.

## Strict adapter configuration

Validate Buffer, inclusive byte length 1..262144 and `node:buffer.isUtf8` first.
Reject NUL and every bare CR with `/\r(?!\n)/` on validated decoded text. Retain/hash
original bytes; remove only initial EF BB BF for the separate parsing view. Do not use
parser `bom:true`: its tagged implementation also recognizes UTF-16LE. [Node 22 UTF-8 validation](https://nodejs.org/download/release/v22.21.1/docs/api/buffer.html#bufferisutf8input).

Explicit options: columns:false; selected delimiter; record_delimiter:['\r\n','\n'];
quote and escape both '"'; bom:false; encoding:'utf8'; cast_date:false; trim/ltrim/rtrim,
relax_quotes/relax_column_count and skip options all false. No comments, objname,
record truncation or parser number/date coercion. [Options](https://csv.js.org/parse/options/).

Use a custom `cast` callback only to check zero-based field index <32 and decoded
field UTF-8 byte length <=4096, then return the exact string. This bounds header
allocation before a delimiter-heavy file creates a large array. Do not use cast:true.
Use `on_record` to validate header, equal width, nonblank rows and at most header+100
records, returning each unchanged. Never return null/undefined to skip a row, or use
to/to_line to accept a truncated prefix. [Field callback](https://csv.js.org/parse/options/cast/),
[record callback](https://csv.js.org/parse/options/on_record/).

Set max_record_size:131072 as secondary allocation defense. It is not the exact
file/cell byte policy: documented characters and implementation buffer accounting
must not replace explicit byte checks. Characterize valid exact caps too, so this
defense cannot accidentally reject supported records. [Record size](https://csv.js.org/parse/options/max_record_size/),
[tagged implementation](https://raw.githubusercontent.com/adaltas/node-csv/csv-parse@7.0.2/packages/csv-parse/lib/api/index.js).

Physical starts use parser-reported cumulative record-end `info.bytes` boundaries
into the BOM-stripped Buffer. First physical line is 1; assign each record's current
start then count LF bytes in the consumed range to derive the next start. Every CR
has LF by preflight, so quoted/structural LF and CRLF each increment once. Do not infer
start from info.lines or trim raw record endings. Real vectors must confirm byte
boundary behavior with BOM, multibyte text, quoted newlines and mixed terminators.
A small location adapter may return null when an error position is unavailable; never
return raw parser exception messages or a successful parsed prefix after failure.

## Multipart wire contract

Exactly two parts, in either order:

1. `file`: browser Blob, application/octet-stream, fixed ASCII filename `upload.csv`.
2. `displayNameBase64url`: original display name encoded as unpadded canonical base64url
   of UTF-8 bytes. ASCII `[A-Za-z0-9_-]+`, length 1..640; decode then encode-back equality,
   decoded 1..480 bytes, valid UTF-8, 1..120 code points, no C0/C1 controls or slash/backslash.

Ignore Multer originalname for identity, display and paths. Installed multipart filename
parameter decoding is unsuitable for the required Russian label round-trip; explicit
metadata removes that ambiguity. Content type/extension never proves CSV. Reject absent,
extra, duplicate, nested or array metadata and extra files. Filename never enters a
URL/custom header or log. [Multer 2.3.0](https://github.com/expressjs/multer/blob/v2.3.0/README.md).

Use route-local `FileInterceptor('file', options)` with no disk destination. Existing
Multer 2.3.0 defaults to memory storage. Require multipart and absent/identity content
encoding before invoking it; unsupported transport is 415. Guards execute first, so
session/CSRF failures precede application file allocation (not edge buffering).
[Nest upload](https://docs.nestjs.com/techniques/file-upload),
[Nest lifecycle](https://docs.nestjs.com/faq/request-lifecycle).

| Limit | Value | Interpretation for installed Multer/Busboy |
| --- | ---: | --- |
| fileSize | 262144 | Inclusive supported maximum; Multer adds one before Busboy threshold |
| files | 1 | Exactly one file required by final validation |
| fields | 1 | Exactly one named metadata field |
| fieldSize | 641 | Explicitly accept <=640; Busboy marks threshold equality truncated |
| fieldNameSize | 32 | Both allowed names fit |
| parts | 3 | Limit event at third part rejects extras; required count is two |
| fieldNestingDepth | 0 | Reject bracket nesting before field allocation |
| fieldArrayIndexLimit | 0 | Reject indexed metadata |

PreservePath remains false, though originalname is ignored. Nest's older limit type
omits the two nesting fields supported by installed Multer: use a narrow intersection
type without any, not a dependency change. Explicitly check Buffer length inclusive;
Nest MaxFileSizeValidator's strict `<` must not exclude a valid 262144-byte file.
Do not promise headerPairs:32 works: installed Busboy fixes 16 KiB/2000 header bounds.
[Tagged middleware](https://raw.githubusercontent.com/expressjs/multer/v2.3.0/lib/make-middleware.js),
[Busboy parser](https://raw.githubusercontent.com/mscdex/busboy/v1.6.0/lib/types/multipart.js).

Sanitize route-owned multipart failures into fixed safe 400/413/415 categories; Nest
can otherwise interpolate attacker-controlled field names. Never forward error.message,
field, originalname, buffer, record or cause. Preserve existing auth errors/no-store.
A limit failure may drain the body before responding; test actual completion/abort
behavior rather than assuming every excessive request responds instantly.

## Edge, browser and verification

Pin existing effective `client_max_body_size 1m` (1048576 entire wire bytes) in the
existing deployed /api/ location, retaining rewrite and inherited security headers.
Multer's file/field caps do not count all preamble/headers/boundaries/epilogue. The
trusted private-backend topology supplies this whole-body edge bound, including
chunked requests; Content-Length alone is insufficient. No independent total Node
stream counter is claimed. Generic edge 413 contains no private input; do not introduce
unrelated no-store/header inheritance changes for it. [Nginx body size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

Proxy buffering may spill to a private temporary file; database bytea does not mean
never touches disk. Retain private temp permissions and no static original-file route.
[Request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering).

Use existing Axios cookie/CSRF client, removing its JSON Content-Type for this FormData
request so the browser supplies a real boundary. No new CORS header or automatic retry.
Keep existing 100 KiB JSON parsing for mapping commands. [Axios multipart](https://axios-http.com/docs/multipart),
[Express body parser](https://expressjs.com/en/resources/middleware/body-parser/).

Required evidence: real parser exact/one-over limits, strict malformed final records,
source line locations, Unicode filename round-trip; actual Nest duplicate/extra/nested
parts, both part orders, missing boundary/truncated body/zero file/unsupported transport;
actual rendered edge total limits with Content-Length and chunked overhead; denied
multipart before parsing, private log canaries, unchanged DB after rejection, retained
byte digest and genuine browser FormData. These accompany financial/replay/rollback
acceptance and do not substitute for it. Package documentation is design evidence;
none of those runtime checks is claimed complete by this artifact.
