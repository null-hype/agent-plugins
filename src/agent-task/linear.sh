#!/bin/bash

# The Linear end of agent-task's linear mode, run under `pass-cli run` with
# linear.env (the agent's client id and secret). The agent mints its app
# token from those, as the Render server does.
#
#   linear.sh prompt <session>            print the session's issue, its
#                                         comments and latest prompt
#   linear.sh post <session> <type> <body> post a thought/response/error

set -euo pipefail

token() {
    curl -fsS https://api.linear.app/oauth/token \
        -d grant_type=client_credentials -d scope=read,write,app:assignable,app:mentionable \
        --data-urlencode client_id="$LINEAR_CLIENT_ID" --data-urlencode client_secret="$LINEAR_CLIENT_SECRET" |
        jq -er .access_token
}

gql() { # query variables-json
    local out
    out=$(jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}' |
        curl -fsS https://api.linear.app/graphql -H "Authorization: Bearer $(token)" \
            -H 'Content-Type: application/json' --data-binary @-)
    jq -e '.errors | not' <<< "$out" >/dev/null || { jq -c .errors <<< "$out" >&2; return 1; }
    jq -c .data <<< "$out"
}

case "${1:-}" in
    prompt)
        gql 'query($id: String!) { agentSession(id: $id) {
                issue { identifier title url description
                        comments { nodes { body createdAt user { name } botActor { name } } } }
                activities(last: 50) { nodes { content { ... on AgentActivityPromptContent { body } } } } } }' \
            "$(jq -n --arg id "$2" '{id: $id}')" |
        jq -r '.agentSession as $s | $s.issue as $i |
            "# \($i.identifier): \($i.title)\n\($i.url)\n\n## Description\n\($i.description // "(no description)")",
            if ($i.comments.nodes | length) > 0 then "\n## Comments" else empty end,
            ($i.comments.nodes[] | "### \(.botActor.name // .user.name // "unknown") (\(.createdAt))\n\(.body)\n"),
            ([$s.activities.nodes[].content.body // empty] | last //empty | "\n---\n\nNew message in this thread:\n\n\(.)")'
        ;;
    post)
        gql 'mutation($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }' \
            "$(jq -n --arg id "$2" --arg type "$3" --arg body "$4" '{input: {agentSessionId: $id, content: {type: $type, body: $body}}}')" >/dev/null
        ;;
    *) sed -n '7,9p' "$0" >&2; exit 2 ;;
esac
