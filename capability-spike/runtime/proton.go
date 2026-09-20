// Package runtime owns observed/materialized evidence: what actually
// happened, as distinct from what the worker requested (worker package)
// or what the supervisor approved (supervisor package). In this demo the
// only runtime-owned fact is the Proton Pass access operation's recorded
// reason.
package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Observation is one recorded Proton Pass operation. FactID must be the
// stable fact ID the request came from (per CIT-139: "Prefer a stable
// fact ID over literal string matching"), carried as
// PROTON_PASS_AGENT_REASON.
type Observation struct {
	FactID     string    `json:"factID"`
	Vault      string    `json:"vault"`
	Reason     string    `json:"reason"` // the literal PROTON_PASS_AGENT_REASON value
	Operation  string    `json:"operation"`
	RecordedAt time.Time `json:"recordedAt"`
}

// RecordMaterialization appends one Observation to ledgerPath as a JSON
// line. It does not call pass-cli or touch a real vault: a background
// demo run must not create or share real Proton Pass state as a side
// effect. A real integration would shell out to
// `PROTON_PASS_AGENT_REASON=<factID> pass-cli ...` (see this repo's
// Makefile for the existing pattern) behind an explicit opt-in the
// caller controls -- out of scope for this spike.
func RecordMaterialization(ledgerPath string, obs Observation) error {
	obs.RecordedAt = time.Now().UTC()
	line, err := json.Marshal(obs)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(ledgerPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintln(f, string(line))
	return err
}

// LoadObservations reads every recorded Observation from ledgerPath. A
// missing file is treated as zero observations, not an error.
func LoadObservations(ledgerPath string) ([]Observation, error) {
	data, err := os.ReadFile(ledgerPath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var obs []Observation
	dec := json.NewDecoder(bytes.NewReader(data))
	for dec.More() {
		var o Observation
		if err := dec.Decode(&o); err != nil {
			return nil, err
		}
		obs = append(obs, o)
	}
	return obs, nil
}
