FROM postgres:18.6-alpine3.24@sha256:d8703cd7fba306b9fec9268ecedfa8a966846c053036a60e3635791957eb2f66

# Keep the official PostgreSQL runtime and initialization contract. Its bundled
# gosu contains an obsolete Go runtime; Alpine's signed, versioned su-exec package
# provides the same direct user/group switch used by these two root-only calls.
# This produces a derived image with its own release identity, not the base digest.
RUN set -eux; \
    apk add --no-cache su-exec=0.3-r0; \
    test "$(stat -c '%a' /sbin/su-exec)" = 755; \
    for script in /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-ensure-initdb.sh; do \
        test "$(grep -c '^[[:space:]]*exec gosu postgres "\$BASH_SOURCE" "\$@"$' "$script")" = 1; \
        sed -i 's/exec gosu postgres "\$BASH_SOURCE" "\$@"/exec su-exec postgres "$BASH_SOURCE" "$@"/' "$script"; \
        test "$(grep -c '^[[:space:]]*exec su-exec postgres "\$BASH_SOURCE" "\$@"$' "$script")" = 1; \
        ! grep -w gosu "$script"; \
    done; \
    rm /usr/local/bin/gosu; \
    test ! -e /usr/local/bin/gosu; \
    su-exec postgres sh -c 'test "$(id -u)" = 70 && test "$(id -g)" = 70 && test "$HOME" = /var/lib/postgresql'
