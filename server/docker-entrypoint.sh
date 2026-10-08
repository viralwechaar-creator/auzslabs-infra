#!/bin/sh
# The API image has no USER directive, so the container still starts as root --
# deliberately. The two upload volumes (uploads_data, private_uploads_data) are
# plain named Docker volumes; on a fresh deploy Docker creates them owned by
# root, and an existing deploy's volume is already root-owned from the server
# running as root before this change. Root is only ever used here, for one
# moment, to fix that ownership (cheap -- an uploads folder, not millions of
# files) before dropping to the image's built-in non-root `node` user (uid
# 1000) via su-exec to actually run the server. The server process itself
# never runs as root.
set -e
chown -R node:node /data/uploads /data/private-uploads 2>/dev/null || true
exec su-exec node "$@"
