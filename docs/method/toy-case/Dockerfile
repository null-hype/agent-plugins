# Toy example case for the CIT-284 evidence method (CIT-285). Unrelated to any
# real CVE. A minimal base keeps "never" occurrences in the image root down to
# essentially just the README (alpine adds one incidental hit in an unrelated
# DHCP script; a Debian root's docs/man pages have hundreds, which would swamp
# a grep-driven agent).
#
# Two targets, differing only in the consumer (service.sh):
#   positive -- service.sh runs the expander on the incoming note unchanged.
#   control  -- service.sh first rewrites @includes that escape the note's
#               directory, so the "never" is enforced.
# README.md and expander.sh are byte-identical in both, and no control variant
# or arm wording is present in the positive root the smoke agent inspects.

FROM alpine:3.20 AS positive
COPY rootfs/ /
RUN chmod 0755 /opt/toy/expander.sh /opt/toy/service.sh
# The note this service renders arrives from a caller at runtime; none is baked
# into the image, so the inspected root is just the tool and its README.
CMD ["/opt/toy/service.sh"]

FROM positive AS control
COPY control/ /
RUN chmod 0755 /opt/toy/service.sh
CMD ["/opt/toy/service.sh"]
