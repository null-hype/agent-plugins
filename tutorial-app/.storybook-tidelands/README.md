# Tidelands Storybook

From `tutorial-app`, run `npm run storybook:tidelands` and open
http://localhost:7881. The Tidelands home, claim report and preregistration
stories live in `src/tidelands-stories/`.

The existing agent-plugins Storybook is composed as **Agent plugins** in the
sidebar. Run it separately with `npm run storybook -- --port 7880 --no-open`.
It remains an external reference, including its Investigations stories.

Build with `npm run build-storybook:tidelands`. This writes
`tidelands-storybook-static/` independently of the existing Storybook build.
For a hosted reference, set `AGENT_PLUGINS_STORYBOOK_URL` to that Storybook's
public URL when starting or building; the local default is
`http://localhost:7880`.

For Codespaces, select `.devcontainer/internal/devcontainer.json` and set the
idle timeout to four hours (`gh codespace create --idle-timeout 4h`). The internal
environment installs the development tools and locked dependencies, then starts
both books on ports 7880 and 7881 on each start. Open port 7881 for Tidelands; its external library URL automatically uses
the Codespace's forwarded port 7880. Both ports retain private visibility.
If the external library asks for authentication, open port 7880 once in the same
browser, then reload Tidelands.

Logs are in `/tmp/tidelands-storybooks.log`. To run both books in a terminal
instead, stop the background runner with `kill $(cat /tmp/tidelands-storybooks.pid)`
and run `npm run storybook:remote` from `tutorial-app`.
