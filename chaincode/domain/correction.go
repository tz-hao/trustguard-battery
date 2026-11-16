package domain

import (
	"fmt"
	"sort"
	"time"
)

type LifecycleCorrection struct {
	ID            string     `json:"id"`
	AssetID       string     `json:"assetId"`
	Field         string     `json:"field"`
	OldValue      string     `json:"oldValue"`
	NewValue      string     `json:"newValue"`
	EvidenceHash  string     `json:"evidenceHash"`
	ReasonHash    string     `json:"reasonHash"`
	AssetVersion  uint64     `json:"assetVersion"`
	PolicyVersion uint64     `json:"policyVersion"`
	ProposerMSP   string     `json:"proposerMSP"`
	ProposerID    string     `json:"proposerId"`
	ProposerRole  string     `json:"proposerRole"`
	RequiredOrgs  []string   `json:"requiredOrgs"`
	Approvals     []Approval `json:"approvals"`
	ExpiresAt     string     `json:"expiresAt"`
	State         string     `json:"state"`
	AppliedTxID   string     `json:"appliedTxId,omitempty"`
}
type CorrectionInput struct {
	ID           string `json:"id"`
	AssetID      string `json:"assetId"`
	Field        string `json:"field"`
	NewValue     string `json:"newValue"`
	EvidenceHash string `json:"evidenceHash"`
	ReasonHash   string `json:"reasonHash"`
	AssetVersion uint64 `json:"assetVersion"`
}

func correctionField(a *Asset, field string) (**string, error) {
	switch field {
	case "installedAt":
		return &a.InstalledAt, nil
	case "firstUseAt":
		return &a.FirstUseAt, nil
	case "retiredAt":
		return &a.RetiredAt, nil
	case "scrappedAt":
		return &a.ScrappedAt, nil
	default:
		return nil, fail("INVALID_CORRECTION", "unsupported lifecycle field")
	}
}
func validateChronology(a Asset) error {
	previous, err := time.Parse("2006-01-02", a.ManufacturedAt)
	if err != nil {
		return fail("INVALID_TIME", "invalid manufacturing date")
	}
	for _, value := range []*string{a.InstalledAt, a.FirstUseAt, a.RetiredAt, a.RecyclingReceivedAt, a.ScrappedAt} {
		if value == nil {
			continue
		}
		stamp, er := parseTime(*value)
		if er != nil {
			return er
		}
		if stamp.Before(previous) {
			return fail("CHRONOLOGY_INVALID", "lifecycle timestamps must preserve event order")
		}
		previous = stamp
	}
	return nil
}
func (e *Engine) proposeCorrection(raw []byte) (string, uint64, error) {
	in, err := decode[CorrectionInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validID(in.ID) != nil || validHash(in.EvidenceHash) != nil || validHash(in.ReasonHash) != nil {
		return "", 0, fail("INVALID_CORRECTION", "identifier, reason and evidence required")
	}
	a, err := e.asset(in.AssetID)
	if err != nil {
		return "", 0, err
	}
	if a.Type != "PACK" || a.Version != in.AssetVersion {
		return "", 0, fail("VERSION_CONFLICT", "pack version mismatch")
	}
	if in.Field == "scrappedAt" {
		err = e.auth("recycler", RecycleOrg)
	} else {
		err = e.auth("operator", CellOrg, PackOrg)
	}
	if err != nil {
		return "", 0, err
	}
	if e.Actor.MSP != a.MakerMSP && e.Actor.MSP != a.HolderMSP {
		return "", 0, fail("FORBIDDEN", "manufacturer or current holder must propose correction")
	}
	field, err := correctionField(&a, in.Field)
	if err != nil {
		return "", 0, err
	}
	if *field == nil || **field == in.NewValue {
		return "", 0, fail("INVALID_CORRECTION", "only an existing event may be corrected; clearing or fabricating an event is forbidden")
	}
	oldValue := **field
	stamp, err := parseTime(in.NewValue)
	if err != nil {
		return "", 0, err
	}
	if stamp.After(e.Now) {
		return "", 0, fail("INVALID_TIME", "future correction forbidden")
	}
	*field = &in.NewValue
	if err = validateChronology(a); err != nil {
		return "", 0, err
	}
	policy, err := e.policy()
	if err != nil {
		return "", 0, err
	}
	if err = e.fresh("correction-id:" + in.ID); err != nil {
		return "", 0, err
	}
	set := map[string]bool{LabOrg: true, a.MakerMSP: true, a.HolderMSP: true}
	required := []string{}
	for org := range set {
		required = append(required, org)
	}
	sort.Strings(required)
	c := LifecycleCorrection{ID: in.ID, AssetID: a.ID, Field: in.Field, OldValue: oldValue, NewValue: in.NewValue, EvidenceHash: in.EvidenceHash, ReasonHash: in.ReasonHash, AssetVersion: a.Version, PolicyVersion: policy.Version,
		ProposerMSP: e.Actor.MSP, ProposerID: Digest(e.Actor.ID), ProposerRole: e.Actor.Role, RequiredOrgs: required, Approvals: []Approval{}, ExpiresAt: e.Now.Add(24 * time.Hour).UTC().Format(time.RFC3339), State: "PENDING"}
	if err = e.put("correction-id:"+c.ID, c.AssetID); err != nil {
		return "", 0, err
	}
	return c.ID, a.Version, e.put("correction:"+a.ID+":"+c.ID, c)
}
func (e *Engine) loadCorrection(id string) (LifecycleCorrection, Asset, error) {
	var c LifecycleCorrection
	var a Asset
	if validID(id) != nil {
		return c, a, fail("INVALID_ID", "invalid correction identifier")
	}
	assetID, err := read[string](e, "correction-id:"+id)
	if err != nil {
		return c, a, err
	}
	c, err = read[LifecycleCorrection](e, "correction:"+assetID+":"+id)
	if err != nil {
		return c, a, err
	}
	policy, err := e.policy()
	if err != nil {
		return c, a, err
	}
	a, err = e.asset(c.AssetID)
	if err != nil {
		return c, a, err
	}
	if c.State != "PENDING" || a.Version != c.AssetVersion || policy.Version != c.PolicyVersion {
		return c, a, fail("STALE_CORRECTION", "asset, policy or correction state changed")
	}
	expires, err := parseTime(c.ExpiresAt)
	if err != nil || !expires.After(e.Now) {
		return c, a, fail("CORRECTION_EXPIRED", "independent review interval elapsed")
	}
	field, err := correctionField(&a, c.Field)
	if err != nil {
		return c, a, err
	}
	if *field == nil || **field != c.OldValue {
		return c, a, fail("STALE_CORRECTION", "original event no longer matches")
	}
	return c, a, nil
}
func correctionDigest(c LifecycleCorrection) string {
	c.Approvals = nil
	c.State = "PENDING"
	c.AppliedTxID = ""
	return Digest(c)
}
func (e *Engine) approveCorrection(raw []byte) (string, uint64, error) {
	if err := e.auth("auditor", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	c, a, err := e.loadCorrection(in.ID)
	if err != nil {
		return "", 0, err
	}
	if !contains(c.RequiredOrgs, e.Actor.MSP) {
		return "", 0, fail("FORBIDDEN", "correction requires manufacturer, current holder and independent laboratory")
	}
	for _, approval := range c.Approvals {
		if approval.MSP == e.Actor.MSP {
			return "", 0, fail("DUPLICATE_APPROVAL", "organization already approved correction")
		}
	}
	c.Approvals = append(c.Approvals, Approval{e.Actor.MSP, Digest(e.Actor.ID), correctionDigest(c), e.Now.UTC().Format(time.RFC3339)})
	return c.ID, a.Version, e.put("correction:"+a.ID+":"+c.ID, c)
}
func (e *Engine) applyCorrection(raw []byte) (string, uint64, error) {
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	c, a, err := e.loadCorrection(in.ID)
	if err != nil {
		return "", 0, err
	}
	if e.Actor.MSP != c.ProposerMSP || Digest(e.Actor.ID) != c.ProposerID || e.Actor.Role != c.ProposerRole {
		return "", 0, fail("FORBIDDEN", "original authorized proposer must apply correction")
	}
	for _, org := range c.RequiredOrgs {
		found := false
		for _, approval := range c.Approvals {
			if approval.MSP == org && approval.Digest == correctionDigest(c) {
				found = true
			}
		}
		if !found {
			return "", 0, fail("APPROVALS_MISSING", fmt.Sprintf("independent correction approval missing: %s", org))
		}
	}
	field, err := correctionField(&a, c.Field)
	if err != nil {
		return "", 0, err
	}
	*field = &c.NewValue
	if err = validateChronology(a); err != nil {
		return "", 0, err
	}
	stamp, err := parseTime(c.NewValue)
	if err != nil || stamp.After(e.Now) {
		return "", 0, fail("INVALID_TIME", "correction timestamp is not effective yet")
	}
	// State is deliberately unchanged: correcting scrap time can never revive a processed pack.
	e.stamp(&a)
	c.State = "APPLIED"
	c.AppliedTxID = e.TxID
	if err = e.put("correction:"+a.ID+":"+c.ID, c); err != nil {
		return "", 0, err
	}
	return a.ID, a.Version, e.put("asset:"+a.ID, a)
}
