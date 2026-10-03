FROM mcr.microsoft.com/devcontainers/base:ubuntu

# These are applications under test, independent of the detector feature.
COPY app/ /opt/toy/
COPY control/service.sh /opt/toy-control/service.sh
RUN chmod 0755 /opt/toy/*.sh /opt/toy-control/service.sh
