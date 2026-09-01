.PHONY: jin63-inspect-fields jin63-inspect jin63-rotate-gcp-key jin63-revoke-old-key \
        jin63-rotate-restic-password jin63-remove-old-restic-key jin63-prune-snapshot \
        jin63-check-codespace

ROTATE := hk/rotate-jin63-secrets.sh

# JIN-63/JIN-69: rotate secrets leaked in restic snapshot 488398a1.
# Run in order: inspect -> rotate-gcp-key -> (verify) -> revoke-old-key ->
# rotate-restic-password -> (verify) -> remove-old-restic-key -> prune-snapshot.
# Requires pass-cli/gcloud/gh/restic/jq installed and `pass-cli login` already run.

jin63-inspect-fields: ## Print restic vault item JSON shape (no secret values)
	$(ROTATE) inspect-fields

jin63-inspect: ## Print current GCP SA email + old key id (no secret values)
	$(ROTATE) inspect

jin63-rotate-gcp-key: ## Mint new GCP SA key, store in vault (confirms before acting)
	$(ROTATE) rotate-gcp-key

jin63-revoke-old-key: ## Revoke OLD GCP SA key: make jin63-revoke-old-key ID=<old-key-id>
	$(ROTATE) revoke-old-key $(ID)

jin63-rotate-restic-password: ## Add new restic repo password, store in vault (confirms before acting)
	$(ROTATE) rotate-restic-password

jin63-remove-old-restic-key: ## Remove OLD restic repo key: make jin63-remove-old-restic-key ID=<old-key-id>
	$(ROTATE) remove-old-restic-key $(ID)

jin63-prune-snapshot: ## Forget+prune the leaked transcript snapshot 488398a1 (confirms before acting)
	$(ROTATE) prune-snapshot

jin63-check-codespace: ## Check whether the leaking codespace (3b7ff1) is stopped/deleted
	$(ROTATE) check-codespace
