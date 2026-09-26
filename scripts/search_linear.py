#!/usr/bin/env python3
"""
Search Linear workspace using LINEAR_API_KEY injected via pass-cli.

Usage:
    export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-antigravity"
    export PROTON_PASS_AGENT_REASON="Search Linear for <term>"
    pass-cli run --env-file scripts/linear.env -- python3 scripts/search_linear.py <term>
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql"


def run_graphql_query(query: str, variables: dict, api_key: str) -> dict:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        LINEAR_GRAPHQL_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"HTTP Error {e.code}: {body}", file=sys.stderr)
        raise
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}", file=sys.stderr)
        raise


def search_issues(term: str, api_key: str) -> dict:
    query = """
    query SearchIssues($term: String!) {
      searchIssues(term: $term) {
        nodes {
          id
          identifier
          title
          description
          url
          state {
            name
          }
          team {
            name
            key
          }
          project {
            name
          }
        }
        totalCount
      }
    }
    """
    return run_graphql_query(query, {"term": term}, api_key)


def search_projects(term: str, api_key: str) -> dict:
    query = """
    query SearchProjects($term: String!) {
      searchProjects(term: $term) {
        nodes {
          id
          name
          description
          url
          state
        }
        totalCount
      }
    }
    """
    return run_graphql_query(query, {"term": term}, api_key)


def search_documents(term: str, api_key: str) -> dict:
    query = """
    query SearchDocuments($term: String!) {
      searchDocuments(term: $term) {
        nodes {
          id
          title
          project {
            name
          }
        }
        totalCount
      }
    }
    """
    return run_graphql_query(query, {"term": term}, api_key)


def main():
    parser = argparse.ArgumentParser(description="Search Linear workspace for issues, projects, and documents.")
    parser.add_argument("term", help="Search term (e.g. 'tropfest')")
    parser.add_argument("--json", action="store_true", help="Output raw JSON results")
    args = parser.parse_args()

    api_key = os.environ.get("LINEAR_API_KEY")
    if not api_key:
        print("Error: LINEAR_API_KEY environment variable is not set.", file=sys.stderr)
        print("Run this script using `pass-cli run --env-file scripts/linear.env -- ...`", file=sys.stderr)
        sys.exit(1)

    term = args.term

    issue_data = search_issues(term, api_key)
    project_data = search_projects(term, api_key)
    doc_data = search_documents(term, api_key)

    if args.json:
        print(json.dumps({
            "issues": issue_data.get("data", {}).get("searchIssues", {}),
            "projects": project_data.get("data", {}).get("searchProjects", {}),
            "documents": doc_data.get("data", {}).get("searchDocuments", {})
        }, indent=2))
        return

    issues = issue_data.get("data", {}).get("searchIssues", {}).get("nodes", [])
    projects = project_data.get("data", {}).get("searchProjects", {}).get("nodes", [])
    docs = doc_data.get("data", {}).get("searchDocuments", {}).get("nodes", [])

    print(f"\nSearch results for: \"{term}\"\n")
    print(f"=== Issues ({len(issues)}) ===")
    for item in issues:
        proj = f" [{item['project']['name']}]" if item.get("project") else ""
        state = f" ({item['state']['name']})" if item.get("state") else ""
        print(f"- {item['identifier']}: {item['title']}{state}{proj}")
        print(f"  {item['url']}")

    print(f"\n=== Projects ({len(projects)}) ===")
    for item in projects:
        print(f"- {item['name']} ({item.get('state', 'Unknown')})")
        print(f"  {item['url']}")

    print(f"\n=== Documents ({len(docs)}) ===")
    for item in docs:
        proj = f" [{item['project']['name']}]" if item.get("project") else ""
        print(f"- {item['title']}{proj} (ID: {item['id']})")


if __name__ == "__main__":
    main()
