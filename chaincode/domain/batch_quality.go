package domain

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type BatchStatus struct {
	Batch
	InspectionVersion uint64 `json:"inspectionVersion"`
	Quality           string `json:"quality"`
	HolderMSP         string `json:"holderMSP"`
}

func (e *Engine) latestBatch(id string) (Inspection, error) {
	var report Inspection
	raw, err := e.get("batch-latest:" + id)
	if err != nil || raw == nil {
		return report, err
	}
	err = json.Unmarshal(raw, &report)
	return report, err
}
func (e *Engine) batchStatus(id string) (BatchStatus, error) {
	var status BatchStatus
	if err := validID(id); err != nil {
		return status, err
	}
	batch, err := read[Batch](e, "batch:"+id)
	if err != nil {
		return status, err
	}
	latest, err := e.latestBatch(id)
	if err != nil {
		return status, err
	}
	quality := latest.Result
	if quality == "" {
		quality = "NOT_TESTED"
	}
	return BatchStatus{batch, latest.Version, quality, batch.MakerMSP}, nil
}
func (e *Engine) subjectVersion(subject string) (uint64, string, error) {
	if id, ok := strings.CutPrefix(subject, "batch:"); ok {
		b, err := e.batchStatus(id)
		return b.InspectionVersion, b.Quality, err
	}
	a, err := e.asset(subject)
	return a.InspectionVersion, a.Quality, err
}

type Retest struct {
	Subject     string `json:"subject"`
	Version     uint64 `json:"version"`
	ReasonHash  string `json:"reasonHash"`
	Proposer    string `json:"proposer"`
	ProposedTx  string `json:"proposedTx"`
	CompletedTx string `json:"completedTx,omitempty"`
}
type RetestInput struct {
	Subject    string `json:"subject"`
	Version    uint64 `json:"version"`
	ReasonHash string `json:"reasonHash"`
}

func retestKey(subject string, version uint64) string {
	return fmt.Sprintf("retest:%s:%020d", subject, version)
}
func (e *Engine) pendingRetest(subject string, version uint64) (*Retest, error) {
	raw, err := e.get(retestKey(subject, version))
	if err != nil || raw == nil {
		return nil, err
	}
	var p Retest
	err = json.Unmarshal(raw, &p)
	return &p, err
}
func (e *Engine) proposeRetest(raw []byte) (string, uint64, error) {
	p, err := decode[RetestInput](raw)
	if err != nil {
		return "", 0, err
	}
	if e.Actor.MSP != LabOrg || (e.Actor.Role != "auditor" && e.Actor.Role != "inspector") {
		return "", 0, fail("FORBIDDEN", "lab reviewer required")
	}
	v, _, err := e.subjectVersion(p.Subject)
	if err != nil {
		return "", 0, err
	}
	if v == 0 || v != p.Version {
		return "", 0, fail("VERSION_CONFLICT", "select current inspection")
	}
	if validHash(p.ReasonHash) != nil {
		return "", 0, fail("INVALID_HASH", "reason digest required")
	}
	key := retestKey(p.Subject, v)
	if err = e.fresh(key); err != nil {
		return "", 0, err
	}
	proposal := Retest{p.Subject, v, p.ReasonHash, Digest(e.Actor.ID), e.TxID, ""}
	return p.Subject, v, e.put(key, proposal)
}
func (e *Engine) checkRetest(subject string, version uint64, old, next string, complete bool) error {
	p, err := e.pendingRetest(subject, version)
	if err != nil {
		return err
	}
	if complete {
		if p == nil || p.CompletedTx != "" {
			return fail("RETEST_REQUIRED", "current proposal required")
		}
		if p.Proposer == Digest(e.Actor.ID) {
			return fail("FORBIDDEN", "independent inspector required")
		}
		p.CompletedTx = e.TxID
		return e.put(retestKey(subject, version), p)
	}
	if p != nil || (next == "QC_PASSED" && (old == "QC_REJECTED" || old == "REVIEW_REQUIRED") && version > 0) {
		return fail("RETEST_REQUIRED", "independent retest required")
	}
	return nil
}
func (e *Engine) completeRetest(raw []byte) (string, uint64, error) {
	in, err := decode[InspectionInput](raw)
	if err != nil {
		return "", 0, err
	}
	if strings.HasPrefix(in.AssetID, "batch:") {
		return e.batchInspection(raw, true)
	}
	return e.inspection(raw, true)
}
func (e *Engine) batchInspection(raw []byte, retest bool) (string, uint64, error) {
	if err := e.auth("inspector", LabOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[InspectionInput](raw)
	if err != nil {
		return "", 0, err
	}
	id, ok := strings.CutPrefix(in.AssetID, "batch:")
	if !ok || validID(in.ID) != nil || validHash(in.ReportHash) != nil || validHash(in.SourceHash) != nil {
		return "", 0, fail("INVALID_INPUT", "batch and signed evidence required")
	}
	if in.Result != "QC_PASSED" && in.Result != "QC_REJECTED" && in.Result != "REVIEW_REQUIRED" {
		return "", 0, fail("INVALID_INPUT", "invalid conclusion")
	}
	b, err := e.batchStatus(id)
	if err != nil {
		return "", 0, err
	}
	if in.Version != b.InspectionVersion+1 {
		return "", 0, fail("VERSION_CONFLICT", "append next batch version")
	}
	if err = e.checkRetest(in.AssetID, b.InspectionVersion, b.Quality, in.Result, retest); err != nil {
		return "", 0, err
	}
	if err = e.fresh("inspection-id:" + in.ID); err != nil {
		return "", 0, err
	}
	r := Inspection{in.ID, in.AssetID, in.Version, in.Result, in.ReportHash, in.SourceHash, e.Actor.MSP, Digest(e.Actor.ID), e.Now.UTC().Format(time.RFC3339), e.TxID}
	for _, key := range []string{"inspection-id:" + in.ID, fmt.Sprintf("batch-report:%s:%020d", id, in.Version), "batch-latest:" + id} {
		if err = e.put(key, r); err != nil {
			return "", 0, err
		}
	}
	return in.AssetID, in.Version, nil
}
