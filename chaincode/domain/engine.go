package domain

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

// Store is implemented by Fabric. Tests use an isolated in-memory ledger.
type Store interface {
	Get(string) ([]byte, error)
	Put(string, []byte) error
	Scan(string) ([][]byte, error)
}
type Engine struct {
	Store  Store
	Actor  Actor
	Now    time.Time
	TxID   string
	writes map[string][]byte
}

func (e *Engine) get(key string) ([]byte, error) {
	if b, ok := e.writes[key]; ok {
		return b, nil
	}
	return e.Store.Get(key)
}
func read[T any](e *Engine, key string) (T, error) {
	var v T
	b, err := e.get(key)
	if err != nil {
		return v, err
	}
	if b == nil {
		return v, fail("NOT_FOUND", key)
	}
	err = json.Unmarshal(b, &v)
	return v, err
}
func (e *Engine) put(key string, v any) error {
	b, err := json.Marshal(v)
	if err == nil {
		e.writes[key] = b
	}
	return err
}
func decode[T any](b []byte) (T, error) {
	var v T
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&v); err != nil {
		return v, fail("INVALID_INPUT", "invalid fields or JSON")
	}
	if d.Decode(new(any)) != io.EOF {
		return v, fail("INVALID_INPUT", "trailing JSON")
	}
	return v, nil
}
func (e *Engine) auth(role string, orgs ...string) error {
	if e.Actor.Role != role {
		return fail("FORBIDDEN", "certificate role not permitted")
	}
	for _, o := range orgs {
		if e.Actor.MSP == o {
			return nil
		}
	}
	return fail("FORBIDDEN", "certificate organization not permitted")
}
func (e *Engine) fresh(key string) error {
	b, err := e.get(key)
	if err != nil {
		return err
	}
	if b != nil {
		return fail("ALREADY_EXISTS", key)
	}
	return nil
}
func (e *Engine) stamp(a *Asset) {
	a.Version++
	a.UpdatedAt = e.Now.UTC().Format(time.RFC3339)
	a.TxID = e.TxID
}
func (e *Engine) asset(id string) (Asset, error) {
	if err := validID(id); err != nil {
		return Asset{}, err
	}
	return read[Asset](e, "asset:"+id)
}
func (e *Engine) policy() (Policy, error) { return read[Policy](e, "policy:active") }

func (e *Engine) Execute(raw []byte) (Result, error) {
	var zero Result
	if (!knownOrg(e.Actor.MSP) && e.Actor.MSP != AuditOrg) || e.Actor.ID == "" || e.TxID == "" || e.Now.IsZero() {
		return zero, fail("UNAUTHENTICATED", "trusted transaction context required")
	}
	c, err := decode[Command](raw)
	if err != nil {
		return zero, err
	}
	if e.Actor.MSP == AuditOrg && (e.Actor.Role != "auditor" || c.Action != "AnchorAudit") {
		return zero, fail("FORBIDDEN", "audit organization may only attest audit evidence")
	}
	if err = validID(c.RequestID); err != nil {
		return zero, err
	}
	// Hash normalized JSON, so harmless whitespace/key ordering does not create a new request.
	var normalized any
	d := json.NewDecoder(bytes.NewReader(c.Data))
	d.UseNumber()
	if d.Decode(&normalized) != nil {
		return zero, fail("INVALID_INPUT", "data must be JSON")
	}
	digest := Digest(struct {
		Action string
		Data   any
	}{c.Action, normalized})
	receiptKey := "request:" + Digest(e.Actor.MSP+":"+e.Actor.ID) + ":" + c.RequestID
	b, err := e.Store.Get(receiptKey)
	if err != nil {
		return zero, err
	}
	if b != nil {
		var receipt Receipt
		if err = json.Unmarshal(b, &receipt); err != nil {
			return zero, err
		}
		if receipt.Digest != digest {
			return zero, fail("IDEMPOTENCY_CONFLICT", "requestId already used with another payload")
		}
		return receipt.Result, nil
	}
	e.writes = map[string][]byte{}
	id, version, err := e.dispatch(c)
	if err != nil {
		e.writes = nil
		return zero, err
	}
	r := Result{c.RequestID, e.TxID, c.Action, id, version}
	if err = e.put(receiptKey, Receipt{digest, r}); err != nil {
		return zero, err
	}
	evidence := Evidence{c.RequestID, c.Action, id, e.Actor.MSP, Digest(e.Actor.ID), e.TxID, e.Now.UTC().Format(time.RFC3339), version, digest}
	if err = e.put("audit:"+e.TxID, evidence); err != nil {
		return zero, err
	}
	// Stable ordering matters for endorsement determinism. No writes on rejected commands.
	keys := make([]string, 0, len(e.writes))
	for k := range e.writes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err = e.Store.Put(k, e.writes[k]); err != nil {
			return zero, err
		}
	}
	return r, nil
}

func (e *Engine) dispatch(c Command) (string, uint64, error) {
	switch c.Action {
	case "Initialize":
		return e.initialize(c.Data)
	case "RegisterMaker":
		return e.registerMaker(c.Data)
	case "RegisterMaterialLot":
		return e.registerMaterial(c.Data)
	case "RegisterBatch":
		return e.registerBatch(c.Data)
	case "RegisterAsset":
		return e.registerAsset(c.Data)
	case "SubmitInspection":
		return e.inspection(c.Data, false)
	case "SubmitBatchInspection":
		return e.batchInspection(c.Data, false)
	case "ProposeRetest":
		return e.proposeRetest(c.Data)
	case "CompleteRetest":
		return e.completeRetest(c.Data)
	case "ImportMES":
		return e.importMES(c.Data, c.RequestID)
	case "ReplaceAssembly":
		return e.assembly(c.Data, c.RequestID)
	case "AuthorizeAssembly":
		return e.authorizeAssembly(c.Data)
	case "RequestRelease":
		return e.requestRelease(c.Data)
	case "ApproveRelease":
		return e.approveRelease(c.Data)
	case "FinalizeRelease":
		return e.finalizeRelease(c.Data)
	case "CreateTransfer":
		return e.transfer(c.Data)
	case "SendTransfer", "AcceptTransfer", "CommitTransfer", "InitiateTransfer", "ConfirmTransfer":
		return e.advanceTransfer(c.Action, c.Data)
	case "CancelTransfer":
		return e.cancelTransfer(c.Data)
	case "RecordInstallation", "RecordFirstUse", "RecordRetirement", "ConfirmRecycling", "RecordScrapConfirmation":
		return e.lifecycle(c.Action, c.Data)
	case "ProposeLifecycleCorrection":
		return e.proposeCorrection(c.Data)
	case "ApproveLifecycleCorrection":
		return e.approveCorrection(c.Data)
	case "ApplyLifecycleCorrection":
		return e.applyCorrection(c.Data)
	case "ProposePolicy":
		return e.proposePolicy(c.Data)
	case "ApprovePolicy":
		return e.approvePolicy(c.Data)
	case "ActivatePolicy":
		return e.activatePolicy(c.Data)
	case "AnchorAudit":
		return e.anchorAudit(c.Data)
	default:
		return "", 0, fail("UNKNOWN_ACTION", "unsupported command")
	}
}

func ValidatePolicy(p Policy) error {
	if p.Version == 0 || p.MaxRiskSeconds < 30 || p.MaxRiskSeconds > 900 || p.ReleaseSeconds < 60 || p.ReleaseSeconds > 3600 {
		return fail("UNSAFE_POLICY", "invalid lifetime limits")
	}
	if !p.SimulationOnly {
		return fail("STANDARD_NOT_VERIFIED", "formal manufacturer registration not enabled")
	}
	if !sameSet(p.RequiredOrgs, []string{CellOrg, LabOrg, PackOrg}) || !sameSet(p.HighRiskOrgs, Organizations) {
		return fail("UNSAFE_POLICY", "minimum independent approvals cannot be weakened")
	}
	if len(p.RiskKeys) == 0 {
		return fail("UNSAFE_POLICY", "risk signer required")
	}
	for id, key := range p.RiskKeys {
		b, err := base64.StdEncoding.DecodeString(key)
		if validID(id) != nil || err != nil || len(b) != ed25519.PublicKeySize {
			return fail("UNSAFE_POLICY", "invalid risk public key")
		}
	}
	return nil
}
func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := append([]string{}, a...)
	bb := append([]string{}, b...)
	sort.Strings(aa)
	sort.Strings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}
func (e *Engine) initialize(raw []byte) (string, uint64, error) {
	if err := e.auth("admin", CellOrg); err != nil {
		return "", 0, err
	}
	p, err := decode[Policy](raw)
	if err != nil {
		return "", 0, err
	}
	if p.Version != 1 {
		return "", 0, fail("VERSION_CONFLICT", "initial policy must be 1")
	}
	if err = ValidatePolicy(p); err != nil {
		return "", 0, err
	}
	if err = e.fresh("policy:active"); err != nil {
		return "", 0, err
	}
	return "policy", 1, e.put("policy:active", p)
}
func (e *Engine) registerMaker(raw []byte) (string, uint64, error) {
	if err := e.auth("admin", CellOrg, PackOrg); err != nil {
		return "", 0, err
	}
	m, err := decode[Maker](raw)
	if err != nil {
		return "", 0, err
	}
	if _, err = e.policy(); err != nil {
		return "", 0, err
	}
	if !regexpMaker(m.Code) || m.MSP != e.Actor.MSP || !m.Simulation || len(m.Name) == 0 || len(m.Name) > 200 {
		return "", 0, fail("INVALID_MAKER", "only own explicitly simulated manufacturer permitted")
	}
	if err = validHash(m.SourceHash); err != nil {
		return "", 0, err
	}
	if err = e.fresh("maker:" + m.Code); err != nil {
		return "", 0, err
	}
	return m.Code, 1, e.put("maker:"+m.Code, m)
}
func regexpMaker(s string) bool {
	if len(s) != 3 {
		return false
	}
	for _, c := range s {
		if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}
func (e *Engine) registerMaterial(raw []byte) (string, uint64, error) {
	if err := e.auth("manufacturer", CellOrg); err != nil {
		return "", 0, err
	}
	m, err := decode[MaterialLot](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(m.ID); err != nil {
		return "", 0, err
	}
	if m.OwnerMSP != e.Actor.MSP || !m.Simulation {
		return "", 0, fail("FORBIDDEN", "material source organization or simulation mismatch")
	}
	if err = validHash(m.SourceHash); err != nil {
		return "", 0, err
	}
	if err = e.fresh("material:" + m.ID); err != nil {
		return "", 0, err
	}
	return m.ID, 1, e.put("material:"+m.ID, m)
}
func (e *Engine) registerBatch(raw []byte) (string, uint64, error) {
	if err := e.auth("manufacturer", CellOrg); err != nil {
		return "", 0, err
	}
	b, err := decode[Batch](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(b.ID); err != nil {
		return "", 0, err
	}
	if b.MakerMSP != e.Actor.MSP || !b.Simulation || len(b.MaterialLotIDs) == 0 || len(b.MaterialLotIDs) > 100 {
		return "", 0, fail("INVALID_BATCH", "source and material lots required")
	}
	seen := map[string]bool{}
	for _, id := range b.MaterialLotIDs {
		if validID(id) != nil || seen[id] {
			return "", 0, fail("INVALID_BATCH", "duplicate or invalid material lot")
		}
		seen[id] = true
		m, er := read[MaterialLot](e, "material:"+id)
		if er != nil {
			return "", 0, er
		}
		if m.OwnerMSP != e.Actor.MSP {
			return "", 0, fail("FORBIDDEN", "material owner mismatch")
		}
	}
	if err = e.fresh("batch:" + b.ID); err != nil {
		return "", 0, err
	}
	return b.ID, 1, e.put("batch:"+b.ID, b)
}

type RegisterAssetInput struct {
	ID                    string  `json:"id"`
	Code                  string  `json:"code"`
	BatchID               string  `json:"batchId"`
	Model                 string  `json:"model"`
	ManufacturedAt        string  `json:"manufacturedAt"`
	ManufactureSourceHash string  `json:"manufactureSourceHash"`
	DesignLifeMonths      *uint32 `json:"designLifeMonths"`
	SpecSourceHash        string  `json:"specSourceHash"`
}

func (e *Engine) registerAsset(raw []byte) (string, uint64, error) {
	if err := e.auth("manufacturer", CellOrg, PackOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[RegisterAssetInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(in.ID); err != nil {
		return "", 0, err
	}
	p, err := ParseCode(in.Code)
	if err != nil {
		return "", 0, err
	}
	m, err := read[Maker](e, "maker:"+p.MakerCode)
	if err != nil {
		return "", 0, err
	}
	if m.MSP != e.Actor.MSP || !m.Simulation {
		return "", 0, fail("FORBIDDEN", "manufacturer certificate mismatch")
	}
	if p.ProductType == "CELL" && e.Actor.MSP != CellOrg || p.ProductType != "CELL" && e.Actor.MSP != PackOrg {
		return "", 0, fail("FORBIDDEN", "product organization mismatch")
	}
	if len(in.Model) == 0 || len(in.Model) > 100 {
		return "", 0, fail("INVALID_INPUT", "model required")
	}
	date, err := time.Parse("2006-01-02", in.ManufacturedAt)
	if err != nil || date.After(e.Now) {
		return "", 0, fail("INVALID_DATE", "manufacturing date is invalid or future")
	}
	if err = ValidateCodeManufactureDate(in.Code, in.ManufacturedAt); err != nil {
		return "", 0, err
	}
	if err = validHash(in.ManufactureSourceHash); err != nil {
		return "", 0, err
	}
	if in.DesignLifeMonths != nil {
		if *in.DesignLifeMonths == 0 || *in.DesignLifeMonths > 1200 {
			return "", 0, fail("INVALID_INPUT", "invalid design lifetime")
		}
		if err = validHash(in.SpecSourceHash); err != nil {
			return "", 0, err
		}
	}
	if p.ProductType == "CELL" {
		b, er := read[Batch](e, "batch:"+in.BatchID)
		if er != nil {
			return "", 0, er
		}
		if b.MakerMSP != m.MSP {
			return "", 0, fail("FORBIDDEN", "batch manufacturer mismatch")
		}
	} else if in.BatchID != "" {
		return "", 0, fail("INVALID_INPUT", "batchId applies to cells only")
	}
	if err = e.fresh("asset:" + in.ID); err != nil {
		return "", 0, err
	}
	if err = e.fresh("code:" + in.Code); err != nil {
		return "", 0, err
	}
	a := Asset{ID: in.ID, Code: in.Code, Type: p.ProductType, MakerCode: p.MakerCode, MakerMSP: m.MSP, Chemistry: p.Chemistry, BatchID: in.BatchID, Model: in.Model, HolderMSP: m.MSP, Simulation: true, ManufacturedAt: in.ManufacturedAt, ManufactureSourceHash: in.ManufactureSourceHash, DesignLifeMonths: in.DesignLifeMonths, SpecSourceHash: in.SpecSourceHash, State: "REGISTERED", Quality: "NOT_TESTED", Children: []string{}}
	e.stamp(&a)
	if err = e.put("asset:"+a.ID, a); err != nil {
		return "", 0, err
	}
	if err = e.put("code:"+a.Code, a.ID); err != nil {
		return "", 0, err
	}
	if a.Type == "CELL" {
		if err = e.put("batchcell:"+a.BatchID+":"+a.ID, a.ID); err != nil {
			return "", 0, err
		}
	}
	return a.ID, a.Version, nil
}

type InspectionInput struct {
	ID         string `json:"id"`
	AssetID    string `json:"assetId"`
	Version    uint64 `json:"version"`
	Result     string `json:"result"`
	ReportHash string `json:"reportHash"`
	SourceHash string `json:"sourceHash"`
}

func (e *Engine) inspection(raw []byte, retest bool) (string, uint64, error) {
	if err := e.auth("inspector", LabOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[InspectionInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validID(in.ID) != nil || validHash(in.ReportHash) != nil || validHash(in.SourceHash) != nil {
		return "", 0, fail("INVALID_INPUT", "inspection identifiers and hashes required")
	}
	if in.Result != "QC_PASSED" && in.Result != "QC_REJECTED" && in.Result != "REVIEW_REQUIRED" {
		return "", 0, fail("INVALID_INPUT", "invalid quality result")
	}
	a, err := e.asset(in.AssetID)
	if err != nil {
		return "", 0, err
	}
	if a.State == "PROCESSED" {
		return "", 0, fail("TERMINAL_STATE", "processed asset cannot be reinspected")
	}
	if err = e.checkRetest(in.AssetID, a.InspectionVersion, a.Quality, in.Result, retest); err != nil {
		return "", 0, err
	}
	if in.Version != a.InspectionVersion+1 {
		return "", 0, fail("VERSION_CONFLICT", "inspection must append next version")
	}
	if err = e.fresh("inspection-id:" + in.ID); err != nil {
		return "", 0, err
	}
	r := Inspection{in.ID, in.AssetID, in.Version, in.Result, in.ReportHash, in.SourceHash, e.Actor.MSP, Digest(e.Actor.ID), e.Now.UTC().Format(time.RFC3339), e.TxID}
	a.InspectionVersion = in.Version
	a.Quality = in.Result
	e.stamp(&a)
	if err = e.put(fmt.Sprintf("inspection:%s:%020d", a.ID, in.Version), r); err != nil {
		return "", 0, err
	}
	if err = e.put("inspection-id:"+in.ID, r); err != nil {
		return "", 0, err
	}
	return a.ID, a.Version, e.put("asset:"+a.ID, a)
}

type AssemblyInput struct {
	ParentID     string   `json:"parentId"`
	Children     []string `json:"children"`
	Revision     uint64   `json:"revision"`
	EvidenceHash string   `json:"evidenceHash"`
}

type SupplyInput struct {
	ChildID      string `json:"childId"`
	ParentID     string `json:"parentId"`
	EvidenceHash string `json:"evidenceHash"`
}

func (e *Engine) authorizeAssembly(raw []byte) (string, uint64, error) {
	if err := e.auth("manufacturer", CellOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[SupplyInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validHash(in.EvidenceHash) != nil {
		return "", 0, fail("INVALID_HASH", "supply evidence required")
	}
	a, err := e.asset(in.ChildID)
	if err != nil {
		return "", 0, err
	}
	p, err := e.asset(in.ParentID)
	if err != nil {
		return "", 0, err
	}
	if a.Type != "CELL" || a.MakerMSP != e.Actor.MSP || a.ParentID != "" || a.State != "REGISTERED" || p.Type != "MODULE" || p.MakerMSP != PackOrg {
		return "", 0, fail("INVALID_SUPPLY", "own unbound cell and registered module required")
	}
	return a.ID, a.Version, e.put("supply:"+a.ID, in)
}

func (e *Engine) assembly(raw []byte, requestID string) (string, uint64, error) {
	if err := e.auth("assembler", PackOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[AssemblyInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validHash(in.EvidenceHash) != nil || len(in.Children) > 1000 {
		return "", 0, fail("INVALID_ASSEMBLY", "bounded assembly and evidence required")
	}
	p, err := e.asset(in.ParentID)
	if err != nil {
		return "", 0, err
	}
	if p.Type == "CELL" || p.HolderMSP != e.Actor.MSP || p.ParentID != "" || (p.State != "REGISTERED" && p.State != "ASSEMBLED") {
		return "", 0, fail("INVALID_ASSEMBLY", "parent type, custody or state does not permit editing")
	}
	if in.Revision != p.AssemblyVersion+1 {
		return "", 0, fail("VERSION_CONFLICT", "assembly revision mismatch")
	}
	seen := map[string]bool{}
	children := map[string]Asset{}
	for _, id := range in.Children {
		if seen[id] {
			return "", 0, fail("DUPLICATE_BINDING", "duplicate child")
		}
		seen[id] = true
		a, er := e.asset(id)
		if er != nil {
			return "", 0, er
		}
		if p.Type == "PACK" && a.Type != "MODULE" || p.Type == "MODULE" && a.Type != "CELL" || a.Chemistry != p.Chemistry || a.ParentID != "" && a.ParentID != p.ID || a.State != "REGISTERED" && a.State != "ASSEMBLED" {
			return "", 0, fail("INVALID_ASSEMBLY", "child type, chemistry, binding or lifecycle conflict")
		}
		// Cells may be supplied by CellOrg; module/PACK assembly is authorized by PackOrg.
		if a.Type != "CELL" && a.HolderMSP != PackOrg {
			return "", 0, fail("FORBIDDEN", "module holder mismatch")
		}
		if a.Type == "CELL" && a.ParentID == "" {
			supply, er := read[SupplyInput](e, "supply:"+a.ID)
			if er != nil || supply.ParentID != p.ID {
				return "", 0, fail("SUPPLY_REQUIRED", "manufacturer must authorize this cell for the target module")
			}
		}
		children[id] = a
	}
	for _, id := range p.Children {
		a, er := e.asset(id)
		if er != nil {
			return "", 0, er
		}
		edgeKey := fmt.Sprintf("edge:%s:%020d:%s", p.ID, p.AssemblyVersion, id)
		edge, er := read[Edge](e, edgeKey)
		if er != nil {
			return "", 0, er
		}
		now := e.Now.UTC().Format(time.RFC3339)
		edge.ActiveTo = &now
		if er = e.put(edgeKey, edge); er != nil {
			return "", 0, er
		}
		if !seen[id] {
			a.ParentID = ""
			if a.Type == "CELL" {
				a.State = "REGISTERED"
			}
			e.stamp(&a)
			if er = e.put("asset:"+id, a); er != nil {
				return "", 0, er
			}
		}
	}
	ordered := append([]string{}, in.Children...)
	sort.Strings(ordered)
	for _, id := range ordered {
		a := children[id]
		if a.Type == "CELL" {
			if err = e.put("supply:"+a.ID, SupplyInput{}); err != nil {
				return "", 0, err
			}
		}
		a.ParentID = p.ID
		if a.Type == "CELL" {
			a.State = "ASSEMBLED"
		}
		e.stamp(&a)
		if err = e.put("asset:"+id, a); err != nil {
			return "", 0, err
		}
		edge := Edge{requestID + "-" + id, p.ID, id, in.Revision, e.Now.UTC().Format(time.RFC3339), nil, e.TxID}
		if err = e.put(fmt.Sprintf("edge:%s:%020d:%s", p.ID, in.Revision, id), edge); err != nil {
			return "", 0, err
		}
	}
	p.Children = ordered
	p.AssemblyVersion = in.Revision
	p.State = "ASSEMBLED"
	if len(ordered) == 0 {
		p.State = "REGISTERED"
	}
	if p.InspectionVersion > 0 {
		p.Quality = "REVIEW_REQUIRED"
	}
	e.stamp(&p)
	return p.ID, p.Version, e.put("asset:"+p.ID, p)
}

// Snapshot covers every current descendant, including reports, custody and assembly versions.
func (e *Engine) Snapshot(packID string) (string, []Asset, error) {
	assets := []Asset{}
	seen := map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if seen[id] {
			return fail("CORRUPT_LINEAGE", "cycle or repeated child")
		}
		seen[id] = true
		a, err := e.asset(id)
		if err != nil {
			return err
		}
		assets = append(assets, a)
		for _, child := range a.Children {
			if err = visit(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(packID); err != nil {
		return "", nil, err
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].ID < assets[j].ID })
	batches := make(map[string]Inspection)
	for _, a := range assets {
		if a.BatchID == "" {
			continue
		}
		report, err := e.latestBatch(a.BatchID)
		if err != nil {
			return "", nil, err
		}
		if report.Version > 0 {
			batches[a.BatchID] = report
		}
	}
	if len(batches) > 0 {
		return Digest(struct {
			Assets  []Asset
			Batches map[string]Inspection
		}{assets, batches}), assets, nil
	}
	return Digest(assets), assets, nil
}
func (e *Engine) qualityGate(assets []Asset) error {
	cells := 0
	for _, a := range assets {
		if proposal, err := e.pendingRetest(a.ID, a.InspectionVersion); err != nil {
			return err
		} else if proposal != nil {
			return fail("QUALITY_GATE", "asset retest pending")
		}
		if a.Type == "CELL" {
			cells++
			batch, err := e.latestBatch(a.BatchID)
			if err != nil {
				return err
			}
			if proposal, err := e.pendingRetest("batch:"+a.BatchID, batch.Version); err != nil {
				return err
			} else if proposal != nil {
				return fail("QUALITY_GATE", "batch retest pending")
			}
			if batch.Version > 0 && batch.Result != "QC_PASSED" {
				return fail("QUALITY_GATE", "batch requires independent retest")
			}
		}
		if a.Quality != "QC_PASSED" || a.InspectionVersion == 0 {
			return fail("QUALITY_GATE", "all components require latest independent passing inspection")
		}
		if a.Type != "CELL" && len(a.Children) == 0 {
			return fail("EMPTY_ASSEMBLY", "module and pack must contain components")
		}
		if a.State == "PROCESSED" || a.State == "RETIRED" || a.State == "RECEIVED_FOR_RECYCLING" {
			return fail("TERMINAL_STATE", "retired component in assembly")
		}
	}
	if cells == 0 {
		return fail("EMPTY_ASSEMBLY", "no cells")
	}
	return nil
}
func RiskSigningBytes(r Risk) []byte { r.Signature = ""; b, _ := json.Marshal(r); return b }
func (e *Engine) verifyRisk(r Risk, p Policy, requestID, packID, snapshot string) error {
	if validID(r.ID) != nil || validID(r.ModelVersion) != nil || validHash(r.EvidenceHash) != nil || r.RequestID != requestID || r.AssetID != packID || r.SnapshotHash != snapshot || r.PolicyVersion != p.Version {
		return fail("RISK_BINDING", "risk attestation binding mismatch")
	}
	if r.Level != "LOW" && r.Level != "MEDIUM" && r.Level != "HIGH" {
		return fail("INVALID_RISK", "invalid risk level")
	}
	issued, err := parseTime(r.IssuedAt)
	if err != nil {
		return err
	}
	expires, err := parseTime(r.ExpiresAt)
	if err != nil {
		return err
	}
	if issued.After(e.Now) || !expires.After(e.Now) || !expires.After(issued) || expires.Sub(issued) > time.Duration(p.MaxRiskSeconds)*time.Second {
		return fail("RISK_EXPIRED", "risk attestation expired or invalid interval")
	}
	pub, err := base64.StdEncoding.DecodeString(p.RiskKeys[r.SignerID])
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return fail("RISK_SIGNER", "untrusted signer")
	}
	sig, err := base64.StdEncoding.DecodeString(r.Signature)
	if err != nil || !ed25519.Verify(pub, RiskSigningBytes(r), sig) {
		return fail("RISK_SIGNATURE", "invalid risk signature")
	}
	return nil
}

type ReleaseInput struct {
	ID     string `json:"id"`
	PackID string `json:"packId"`
	Risk   Risk   `json:"risk"`
}

func (e *Engine) requestRelease(raw []byte) (string, uint64, error) {
	if err := e.auth("release", PackOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[ReleaseInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(in.ID); err != nil {
		return "", 0, err
	}
	p, err := e.policy()
	if err != nil {
		return "", 0, err
	}
	a, err := e.asset(in.PackID)
	if err != nil {
		return "", 0, err
	}
	if a.Type != "PACK" || a.HolderMSP != PackOrg || a.State != "ASSEMBLED" {
		return "", 0, fail("INVALID_STATE", "only assembled held pack may request release")
	}
	hash, assets, err := e.Snapshot(a.ID)
	if err != nil {
		return "", 0, err
	}
	if err = e.qualityGate(assets); err != nil {
		return "", 0, err
	}
	if err = e.verifyRisk(in.Risk, p, in.ID, a.ID, hash); err != nil {
		return "", 0, err
	}
	if err = e.fresh("release:" + in.ID); err != nil {
		return "", 0, err
	}
	if err = e.fresh("risk-used:" + in.Risk.ID); err != nil {
		return "", 0, err
	}
	required := append([]string{}, p.RequiredOrgs...)
	if in.Risk.Level == "HIGH" {
		required = append([]string{}, p.HighRiskOrgs...)
	}
	r := Release{in.ID, a.ID, hash, p.Version, required, []Approval{}, in.Risk, "PENDING", e.Now.Add(time.Duration(p.ReleaseSeconds) * time.Second).UTC().Format(time.RFC3339)}
	if err = e.put("risk-used:"+in.Risk.ID, in.ID); err != nil {
		return "", 0, err
	}
	return in.ID, a.Version, e.put("release:"+in.ID, r)
}

type IDInput struct {
	ID string `json:"id"`
}

func (e *Engine) loadRelease(id string) (Release, Policy, Asset, error) {
	var z Release
	var p Policy
	var a Asset
	if err := validID(id); err != nil {
		return z, p, a, err
	}
	r, err := read[Release](e, "release:"+id)
	if err != nil {
		return z, p, a, err
	}
	p, err = e.policy()
	if err != nil {
		return z, p, a, err
	}
	if r.State != "PENDING" || r.PolicyVersion != p.Version {
		return z, p, a, fail("STALE_APPROVAL", "release consumed or policy changed")
	}
	expires, err := parseTime(r.ExpiresAt)
	if err != nil || !expires.After(e.Now) {
		return z, p, a, fail("RELEASE_EXPIRED", "release approval interval elapsed")
	}
	a, err = e.asset(r.PackID)
	if err != nil {
		return z, p, a, err
	}
	if a.State != "ASSEMBLED" || a.HolderMSP != PackOrg {
		return z, p, a, fail("INVALID_STATE", "pack cannot be released")
	}
	hash, assets, err := e.Snapshot(a.ID)
	if err != nil {
		return z, p, a, err
	}
	if hash != r.SnapshotHash {
		return z, p, a, fail("STALE_APPROVAL", "assembly, quality or asset version changed")
	}
	if err = e.qualityGate(assets); err != nil {
		return z, p, a, err
	}
	if err = e.verifyRisk(r.Risk, p, r.ID, a.ID, hash); err != nil {
		return z, p, a, err
	}
	return r, p, a, nil
}
func (e *Engine) approveRelease(raw []byte) (string, uint64, error) {
	if err := e.auth("approver", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	r, _, a, err := e.loadRelease(in.ID)
	if err != nil {
		return "", 0, err
	}
	if !contains(r.RequiredOrgs, e.Actor.MSP) {
		return "", 0, fail("FORBIDDEN", "organization not required")
	}
	for _, ap := range r.Approvals {
		if ap.MSP == e.Actor.MSP {
			return "", 0, fail("DUPLICATE_APPROVAL", "organization already approved")
		}
	}
	r.Approvals = append(r.Approvals, Approval{e.Actor.MSP, Digest(e.Actor.ID), Digest(struct {
		Snapshot string
		Policy   uint64
		ID       string
	}{r.SnapshotHash, r.PolicyVersion, r.ID}), e.Now.UTC().Format(time.RFC3339)})
	return r.ID, a.Version, e.put("release:"+r.ID, r)
}
func contains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}
func (e *Engine) finalizeRelease(raw []byte) (string, uint64, error) {
	if err := e.auth("release", PackOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	r, _, a, err := e.loadRelease(in.ID)
	if err != nil {
		return "", 0, err
	}
	for _, org := range r.RequiredOrgs {
		found := false
		for _, ap := range r.Approvals {
			if ap.MSP == org {
				found = true
			}
		}
		if !found {
			return "", 0, fail("APPROVALS_MISSING", "independent approvals incomplete")
		}
	}
	r.State = "COMPLETED"
	a.State = "RELEASED"
	e.stamp(&a)
	if err = e.put("release:"+r.ID, r); err != nil {
		return "", 0, err
	}
	return a.ID, a.Version, e.put("asset:"+a.ID, a)
}

type TransferInput struct {
	ID          string `json:"id"`
	PackID      string `json:"packId"`
	ToMSP       string `json:"toMSP"`
	ReceiptHash string `json:"receiptHash"`
	ExpiresAt   string `json:"expiresAt"`
}

func (e *Engine) transfer(raw []byte) (string, uint64, error) {
	if err := e.auth("custodian", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[TransferInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validID(in.ID) != nil || validHash(in.ReceiptHash) != nil || !knownOrg(in.ToMSP) || in.ToMSP == e.Actor.MSP {
		return "", 0, fail("INVALID_TRANSFER", "invalid transfer fields")
	}
	a, err := e.asset(in.PackID)
	if err != nil {
		return "", 0, err
	}
	if a.Type != "PACK" || a.HolderMSP != e.Actor.MSP || a.State == "PROCESSED" || a.State == "RECEIVED_FOR_RECYCLING" {
		return "", 0, fail("FORBIDDEN", "custody or lifecycle forbids transfer")
	}
	if a.State == "RETIRED" && in.ToMSP != RecycleOrg {
		return "", 0, fail("INVALID_TRANSFER", "retired pack may only enter recycling")
	}
	if in.ToMSP == RecycleOrg && a.State != "RETIRED" {
		return "", 0, fail("INVALID_TRANSFER", "retire before recycling")
	}
	exp, err := parseTime(in.ExpiresAt)
	if err != nil || !exp.After(e.Now) || exp.Sub(e.Now) > 24*time.Hour {
		return "", 0, fail("INVALID_TIME", "transfer expires within 24 hours")
	}
	if err = e.fresh("transfer:" + in.ID); err != nil {
		return "", 0, err
	}
	pending, err := e.get("transfer-pending:" + a.ID)
	if err != nil {
		return "", 0, err
	}
	if pending != nil {
		var id string
		if err = json.Unmarshal(pending, &id); err != nil {
			return "", 0, err
		}
		if id != "" {
			return "", 0, fail("TRANSFER_PENDING", "resolve the outstanding transfer first")
		}
	}
	t := Transfer{ID: in.ID, PackID: a.ID, FromMSP: e.Actor.MSP, ToMSP: in.ToMSP,
		ReceiptHash: in.ReceiptHash, State: "CREATED", AssetVersion: a.Version, ExpiresAt: in.ExpiresAt,
		SenderID: Digest(e.Actor.ID), CreatedTx: e.TxID}
	if err = e.put("transfer-pending:"+a.ID, in.ID); err != nil {
		return "", 0, err
	}
	return in.ID, a.Version, e.put("transfer:"+in.ID, t)
}

type ConfirmTransferInput struct {
	ID          string `json:"id"`
	ReceiptHash string `json:"receiptHash"`
}

func (e *Engine) advanceTransfer(action string, raw []byte) (string, uint64, error) {
	if err := e.auth("custodian", Organizations...); err != nil {
		return "", 0, err
	}
	var id, receipt string
	var legacy TransferInput
	switch action {
	case "InitiateTransfer": // Existing HTTP clients send the original draft fields.
		var err error
		legacy, err = decode[TransferInput](raw)
		if err != nil {
			return "", 0, err
		}
		id = legacy.ID
	case "AcceptTransfer", "ConfirmTransfer":
		in, err := decode[ConfirmTransferInput](raw)
		if err != nil {
			return "", 0, err
		}
		id, receipt = in.ID, in.ReceiptHash
	default:
		in, err := decode[IDInput](raw)
		if err != nil {
			return "", 0, err
		}
		id = in.ID
	}
	if err := validID(id); err != nil {
		return "", 0, err
	}
	t, err := read[Transfer](e, "transfer:"+id)
	if err != nil {
		return "", 0, err
	}
	sending := action == "SendTransfer" || action == "InitiateTransfer"
	if sending {
		if t.State != "CREATED" || e.Actor.MSP != t.FromMSP {
			return "", 0, fail("FORBIDDEN", "only the sender may dispatch a draft")
		}
		if action == "InitiateTransfer" && (legacy.PackID != t.PackID || legacy.ToMSP != t.ToMSP || legacy.ReceiptHash != t.ReceiptHash || legacy.ExpiresAt != t.ExpiresAt) {
			return "", 0, fail("INVALID_TRANSFER", "dispatch must match the recorded draft")
		}
	} else {
		if t.ToMSP != e.Actor.MSP || t.FromMSP == e.Actor.MSP {
			return "", 0, fail("FORBIDDEN", "receiving custodian required")
		}
		if action != "CommitTransfer" && t.ReceiptHash != receipt {
			return "", 0, fail("FORBIDDEN", "receipt does not match")
		}
		legacySent := action == "ConfirmTransfer" && t.CreatedTx == "" && t.State == "SENT"
		if action == "AcceptTransfer" {
			if t.State != "SENT" {
				return "", 0, fail("INVALID_TRANSFER_STATE", "only a dispatched transfer can be accepted")
			}
		} else if !legacySent && (t.State != "ACCEPTED" || t.AcceptedTx == "" || t.ReceiverID == "") {
			return "", 0, fail("INVALID_TRANSFER_STATE", "receipt acceptance required before commit")
		}
	}
	exp, err := parseTime(t.ExpiresAt)
	if err != nil || !exp.After(e.Now) {
		return "", 0, fail("TRANSFER_EXPIRED", "transfer expired")
	}
	a, err := e.asset(t.PackID)
	if err != nil {
		return "", 0, err
	}
	if a.HolderMSP != t.FromMSP || a.Version != t.AssetVersion || a.State == "PROCESSED" || a.State == "RECEIVED_FOR_RECYCLING" ||
		(a.State == "RETIRED") != (t.ToMSP == RecycleOrg) {
		return "", 0, fail("STALE_TRANSFER", "custody or asset version changed")
	}
	if sending {
		t.State, t.SentTx = "SENT", e.TxID
		return t.ID, a.Version, e.put("transfer:"+t.ID, t)
	}
	if action == "AcceptTransfer" {
		t.State, t.AcceptedTx, t.ReceiverID = "ACCEPTED", e.TxID, Digest(e.Actor.ID)
		return t.ID, a.Version, e.put("transfer:"+t.ID, t)
	}
	a.HolderMSP = t.ToMSP
	e.stamp(&a)
	t.State, t.CommittedTx = "COMMITTED", e.TxID
	if t.ReceiverID == "" { // Historical v1.4 SENT row.
		t.ReceiverID = Digest(e.Actor.ID)
	}
	if err = e.put("transfer:"+t.ID, t); err != nil {
		return "", 0, err
	}
	if err = e.put("transfer-pending:"+a.ID, ""); err != nil {
		return "", 0, err
	}
	resourceID := t.ID
	if action == "ConfirmTransfer" {
		resourceID = a.ID
	}
	return resourceID, a.Version, e.put("asset:"+a.ID, a)
}
func (e *Engine) cancelTransfer(raw []byte) (string, uint64, error) {
	if err := e.auth("custodian", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(in.ID); err != nil {
		return "", 0, err
	}
	t, err := read[Transfer](e, "transfer:"+in.ID)
	if err != nil {
		return "", 0, err
	}
	pending := t.State == "CREATED" || t.State == "SENT" || t.State == "ACCEPTED"
	participant := e.Actor.MSP == t.FromMSP || (t.State != "CREATED" && e.Actor.MSP == t.ToMSP)
	if !pending || !participant {
		return "", 0, fail("FORBIDDEN", "cannot cancel transfer")
	}
	t.State, t.CancelledTx = "CANCELLED", e.TxID
	if err = e.put("transfer-pending:"+t.PackID, ""); err != nil {
		return "", 0, err
	}
	return t.ID, 0, e.put("transfer:"+t.ID, t)
}

type LifecycleInput struct {
	AssetID      string `json:"assetId"`
	At           string `json:"at"`
	EvidenceHash string `json:"evidenceHash"`
}

func (e *Engine) lifecycle(action string, raw []byte) (string, uint64, error) {
	in, err := decode[LifecycleInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validHash(in.EvidenceHash); err != nil {
		return "", 0, err
	}
	at, err := parseTime(in.At)
	if err != nil {
		return "", 0, err
	}
	if at.After(e.Now) {
		return "", 0, fail("INVALID_TIME", "future event forbidden")
	}
	a, err := e.asset(in.AssetID)
	if err != nil {
		return "", 0, err
	}
	if a.Type != "PACK" || a.State == "PROCESSED" {
		return "", 0, fail("INVALID_STATE", "pack event or terminal state violation")
	}
	if a.HolderMSP != e.Actor.MSP {
		return "", 0, fail("FORBIDDEN", "current holder required")
	}
	manufactured, _ := time.Parse("2006-01-02", a.ManufacturedAt)
	if at.Before(manufactured) {
		return "", 0, fail("INVALID_TIME", "event predates manufacturing")
	}
	switch action {
	case "RecordInstallation":
		if err = e.auth("operator", PackOrg); err != nil {
			return "", 0, err
		}
		if a.State != "RELEASED" || a.InstalledAt != nil {
			return "", 0, fail("INVALID_STATE", "released pack required")
		}
		_, assets, er := e.Snapshot(a.ID)
		if er != nil {
			return "", 0, er
		}
		if er = e.qualityGate(assets); er != nil {
			return "", 0, er
		}
		a.State = "INSTALLED"
		a.InstalledAt = &in.At
	case "RecordFirstUse":
		if err = e.auth("operator", PackOrg); err != nil {
			return "", 0, err
		}
		if a.State != "INSTALLED" || a.FirstUseAt != nil || a.InstalledAt == nil {
			return "", 0, fail("INVALID_STATE", "installation required")
		}
		_, assets, er := e.Snapshot(a.ID)
		if er != nil {
			return "", 0, er
		}
		if er = e.qualityGate(assets); er != nil {
			return "", 0, er
		}
		installed, _ := parseTime(*a.InstalledAt)
		if at.Before(installed) {
			return "", 0, fail("INVALID_TIME", "first use predates installation")
		}
		a.State = "IN_USE"
		a.FirstUseAt = &in.At
	case "RecordRetirement":
		if err = e.auth("operator", CellOrg, PackOrg); err != nil {
			return "", 0, err
		}
		if a.State != "IN_USE" && a.State != "INSTALLED" && a.State != "RELEASED" {
			return "", 0, fail("INVALID_STATE", "pack not eligible for retirement")
		}
		if a.FirstUseAt != nil {
			first, _ := parseTime(*a.FirstUseAt)
			if at.Before(first) {
				return "", 0, fail("INVALID_TIME", "retirement predates use")
			}
		}
		if a.InstalledAt != nil {
			installed, _ := parseTime(*a.InstalledAt)
			if at.Before(installed) {
				return "", 0, fail("INVALID_TIME", "retirement predates installation")
			}
		}
		a.State = "RETIRED"
		a.RetiredAt = &in.At
	case "ConfirmRecycling":
		if err = e.auth("recycler", RecycleOrg); err != nil {
			return "", 0, err
		}
		if a.State != "RETIRED" || a.RetiredAt == nil {
			return "", 0, fail("INVALID_STATE", "received retired pack required")
		}
		retired, _ := parseTime(*a.RetiredAt)
		if at.Before(retired) {
			return "", 0, fail("INVALID_TIME", "recycling predates retirement")
		}
		a.State = "RECEIVED_FOR_RECYCLING"
		a.RecyclingReceivedAt = &in.At
	case "RecordScrapConfirmation":
		if err = e.auth("recycler", RecycleOrg); err != nil {
			return "", 0, err
		}
		if a.State != "RECEIVED_FOR_RECYCLING" || a.ScrappedAt != nil {
			return "", 0, fail("INVALID_STATE", "recycling receipt required")
		}
		retired, _ := parseTime(*a.RetiredAt)
		if at.Before(retired) {
			return "", 0, fail("INVALID_TIME", "scrap predates retirement")
		}
		if a.RecyclingReceivedAt == nil {
			return "", 0, fail("INVALID_STATE", "recycling receipt timestamp required")
		}
		received, _ := parseTime(*a.RecyclingReceivedAt)
		if at.Before(received) {
			return "", 0, fail("INVALID_TIME", "scrap predates recycling receipt")
		}
		a.State = "PROCESSED"
		a.ScrappedAt = &in.At
	default:
		return "", 0, fail("UNKNOWN_ACTION", "unsupported lifecycle event")
	}
	e.stamp(&a)
	return a.ID, a.Version, e.put("asset:"+a.ID, a)
}

type PolicyInput struct {
	ID        string `json:"id"`
	Policy    Policy `json:"policy"`
	TestsHash string `json:"testsHash"`
}

func (e *Engine) proposePolicy(raw []byte) (string, uint64, error) {
	if err := e.auth("admin", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[PolicyInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validID(in.ID) != nil || validHash(in.TestsHash) != nil {
		return "", 0, fail("INVALID_INPUT", "candidate ID and regression evidence hash required")
	}
	current, err := e.policy()
	if err != nil {
		return "", 0, err
	}
	if in.Policy.Version != current.Version+1 {
		return "", 0, fail("VERSION_CONFLICT", "candidate must follow active version")
	}
	if err = ValidatePolicy(in.Policy); err != nil {
		return "", 0, err
	}
	if err = e.fresh("policy-candidate:" + in.ID); err != nil {
		return "", 0, err
	}
	p := PolicyCandidate{in.ID, in.Policy, in.TestsHash, current.Version, "CANDIDATE", []Approval{}}
	return in.ID, in.Policy.Version, e.put("policy-candidate:"+in.ID, p)
}
func (e *Engine) approvePolicy(raw []byte) (string, uint64, error) {
	if err := e.auth("auditor", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(in.ID); err != nil {
		return "", 0, err
	}
	p, err := read[PolicyCandidate](e, "policy-candidate:"+in.ID)
	if err != nil {
		return "", 0, err
	}
	current, err := e.policy()
	if err != nil {
		return "", 0, err
	}
	if p.State != "CANDIDATE" || p.BaseVersion != current.Version {
		return "", 0, fail("STALE_POLICY", "candidate base version changed")
	}
	for _, a := range p.Approvals {
		if a.MSP == e.Actor.MSP {
			return "", 0, fail("DUPLICATE_APPROVAL", "organization already approved candidate")
		}
	}
	p.Approvals = append(p.Approvals, Approval{e.Actor.MSP, Digest(e.Actor.ID), Digest(PolicyInput{p.ID, p.Policy, p.TestsHash}), e.Now.UTC().Format(time.RFC3339)})
	return p.ID, p.Policy.Version, e.put("policy-candidate:"+p.ID, p)
}
func (e *Engine) activatePolicy(raw []byte) (string, uint64, error) {
	if err := e.auth("admin", Organizations...); err != nil {
		return "", 0, err
	}
	in, err := decode[IDInput](raw)
	if err != nil {
		return "", 0, err
	}
	if err = validID(in.ID); err != nil {
		return "", 0, err
	}
	p, err := read[PolicyCandidate](e, "policy-candidate:"+in.ID)
	if err != nil {
		return "", 0, err
	}
	current, err := e.policy()
	if err != nil {
		return "", 0, err
	}
	if p.State != "CANDIDATE" || p.BaseVersion != current.Version {
		return "", 0, fail("STALE_POLICY", "candidate base version changed")
	}
	if err = ValidatePolicy(p.Policy); err != nil {
		return "", 0, err
	}
	for _, org := range Organizations {
		found := false
		for _, a := range p.Approvals {
			if a.MSP == org {
				found = true
			}
		}
		if !found {
			return "", 0, fail("APPROVALS_MISSING", "policy needs all four organizations")
		}
	}
	p.State = "ACTIVE"
	if err = e.put("policy-candidate:"+p.ID, p); err != nil {
		return "", 0, err
	}
	if err = e.put(fmt.Sprintf("policy-history:%020d", current.Version), current); err != nil {
		return "", 0, err
	}
	return p.ID, p.Policy.Version, e.put("policy:active", p.Policy)
}

type AuditInput struct {
	ID     string `json:"id"`
	Digest string `json:"digest"`
	Count  uint32 `json:"count"`
}
type AuditAnchor struct {
	AuditInput
	ActorMSP string `json:"actorMSP,omitempty"`
	TxID     string `json:"txId,omitempty"`
}

func (e *Engine) anchorAudit(raw []byte) (string, uint64, error) {
	if err := e.auth("auditor", CellOrg, PackOrg, LabOrg, RecycleOrg, AuditOrg); err != nil {
		return "", 0, err
	}
	in, err := decode[AuditInput](raw)
	if err != nil {
		return "", 0, err
	}
	if validID(in.ID) != nil || validHash(in.Digest) != nil || in.Count == 0 {
		return "", 0, fail("INVALID_INPUT", "audit digest and count required")
	}
	if err = e.fresh("security-audit:" + in.ID); err != nil {
		return "", 0, err
	}
	return in.ID, 0, e.put("security-audit:"+in.ID, AuditAnchor{in, e.Actor.MSP, e.TxID})
}

type Query struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func (e *Engine) Query(raw []byte) (any, error) {
	if (!knownOrg(e.Actor.MSP) && e.Actor.MSP != AuditOrg) || e.Actor.ID == "" {
		return nil, fail("UNAUTHENTICATED", "organization certificate required")
	}
	q, err := decode[Query](raw)
	if err != nil {
		return nil, err
	}
	if e.Actor.MSP == AuditOrg && e.Actor.Role != "auditor" {
		return nil, fail("FORBIDDEN", "audit certificate required")
	}
	switch q.Kind {
	case "code":
		return ParseCode(q.ID)
	case "policy":
		return e.policy()
	case "mesReceipt":
		if validID(q.ID) != nil {
			return nil, fail("INVALID_ID", "invalid transaction ID")
		}
		return read[MESImportReceipt](e, "mes-import:"+q.ID)
	case "batchStatus":
		return e.batchStatus(q.ID)
	case "retest":
		version, _, err := e.subjectVersion(q.ID)
		if err != nil {
			return nil, err
		}
		return e.pendingRetest(q.ID, version)
	case "retests":
		if _, _, err := e.subjectVersion(q.ID); err != nil {
			return nil, err
		}
		return e.scanJSON("retest:" + q.ID + ":")
	case "batchInspections":
		if validID(q.ID) != nil {
			return nil, fail("INVALID_ID", "invalid batch ID")
		}
		return e.scanJSON("batch-report:" + q.ID + ":")
	case "maker":
		if !regexpMaker(q.ID) {
			return nil, fail("INVALID_INPUT", "invalid maker code")
		}
		return read[Maker](e, "maker:"+q.ID)
	case "request":
		if err = validID(q.ID); err != nil {
			return nil, err
		}
		return read[Receipt](e, "request:"+Digest(e.Actor.MSP+":"+e.Actor.ID)+":"+q.ID)
	case "battery":
		// Preserve access to committed provisional records. New registrations
		// use the stricter standard/date checks; old ledger keys are immutable.
		if !codePattern.MatchString(q.ID) {
			return nil, fail("CODE_FORMAT", "expected 24 uppercase ASCII letters or digits")
		}
		id, er := read[string](e, "code:"+q.ID)
		if er != nil {
			return nil, er
		}
		return e.asset(id)
	case "asset":
		return e.asset(q.ID)
	case "ancestry":
		return e.ancestry(q.ID)
	case "history":
		if _, err = e.asset(q.ID); err != nil {
			return nil, err
		}
		history, ok := e.Store.(HistoryStore)
		if !ok {
			return nil, fail("HISTORY_UNAVAILABLE", "ledger history is disabled")
		}
		return history.History("asset:" + q.ID)
	case "snapshot":
		a, er := e.asset(q.ID)
		if er != nil {
			return nil, er
		}
		if a.Type != "PACK" {
			return nil, fail("INVALID_INPUT", "snapshot requires pack")
		}
		h, assets, er := e.Snapshot(q.ID)
		return struct {
			Hash   string  `json:"hash"`
			Assets []Asset `json:"assets"`
		}{h, assets}, er
	case "release", "transfer", "candidate":
		if validID(q.ID) != nil {
			return nil, fail("INVALID_ID", "invalid query ID")
		}
		prefix := map[string]string{"release": "release:", "transfer": "transfer:", "candidate": "policy-candidate:"}[q.Kind]
		b, er := e.get(prefix + q.ID)
		if er != nil {
			return nil, er
		}
		if b == nil {
			return nil, fail("NOT_FOUND", "resource not found")
		}
		var v any
		er = json.Unmarshal(b, &v)
		return v, er
	case "inspections", "edges", "batchCells", "corrections":
		if validID(q.ID) != nil {
			return nil, fail("INVALID_ID", "invalid query ID")
		}
		prefix := map[string]string{"inspections": "inspection:", "edges": "edge:", "batchCells": "batchcell:", "corrections": "correction:"}[q.Kind]
		return e.scanJSON(prefix + q.ID + ":")
	case "auditAnchor":
		if e.Actor.Role != "auditor" || validID(q.ID) != nil {
			return nil, fail("FORBIDDEN", "auditor and anchor ID required")
		}
		return read[AuditAnchor](e, "security-audit:"+q.ID)
	case "audit":
		if e.Actor.Role != "auditor" {
			return nil, fail("FORBIDDEN", "auditor required")
		}
		return e.scanJSON("audit:")
	default:
		return nil, fail("UNKNOWN_QUERY", "unsupported query")
	}
}
func (e *Engine) scanJSON(prefix string) ([]json.RawMessage, error) {
	if strings.Contains(prefix, "\x00") {
		return nil, fail("INVALID_INPUT", "invalid key prefix")
	}
	rows, err := e.Store.Scan(prefix)
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, len(rows))
	for _, b := range rows {
		out = append(out, json.RawMessage(b))
	}
	return out, nil
}
