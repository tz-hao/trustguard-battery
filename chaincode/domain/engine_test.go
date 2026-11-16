package domain

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

type memoryStore map[string][]byte

func (s memoryStore) Get(k string) ([]byte, error) { return append([]byte(nil), s[k]...), nil }
func (s memoryStore) Put(k string, v []byte) error { s[k] = append([]byte{}, v...); return nil }
func (s memoryStore) Scan(prefix string) ([][]byte, error) {
	keys := []string{}
	for k := range s {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	rows := [][]byte{}
	for _, k := range keys {
		rows = append(rows, s[k])
	}
	return rows, nil
}
func (s memoryStore) clone() memoryStore {
	out := memoryStore{}
	for k, v := range s {
		out[k] = append([]byte{}, v...)
	}
	return out
}

type fixture struct {
	t       *testing.T
	engine  *Engine
	store   memoryStore
	private ed25519.PrivateKey
	seq     int
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s := memoryStore{}
	f := &fixture{t: t, engine: &Engine{Store: s, Now: time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)}, store: s, private: priv}
	policy := Policy{1, []string{CellOrg, LabOrg, PackOrg}, append([]string{}, Organizations...), map[string]string{"risk-v1": base64.StdEncoding.EncodeToString(pub)}, 300, 600, true}
	if file := os.Getenv("TRUSTGUARD_POLICY_CANDIDATE_FILE"); file != "" {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		candidate, err := decode[Policy](b)
		if err != nil {
			t.Fatal(err)
		}
		if err = ValidatePolicy(candidate); err != nil {
			t.Fatal(err)
		}
		// Only trust roots and the initial version are replaced in this isolated test ledger.
		// No real signer, certificate, network or business state is used.
		candidate.Version = 1
		candidate.RiskKeys = policy.RiskKeys
		policy = candidate
	}
	f.call(CellOrg, "admin", "Initialize", policy)
	f.call(CellOrg, "admin", "RegisterMaker", Maker{"SIM", "Simulated Cell Maker", CellOrg, true, Digest("source")})
	f.call(PackOrg, "admin", "RegisterMaker", Maker{"DEM", "Simulated Pack Maker", PackOrg, true, Digest("source")})
	f.call(CellOrg, "manufacturer", "RegisterMaterialLot", MaterialLot{"material1", CellOrg, Digest("material"), true})
	f.call(CellOrg, "manufacturer", "RegisterBatch", Batch{"batch1", CellOrg, []string{"material1"}, true})
	return f
}
func (f *fixture) raw(org, role, request, action string, data any) (Result, error) {
	f.t.Helper()
	f.seq++
	b, _ := json.Marshal(data)
	raw, _ := json.Marshal(Command{request, action, b})
	f.engine.Actor = Actor{org, org + "/" + role, role}
	f.engine.TxID = fmt.Sprintf("tx-%d", f.seq)
	return f.engine.Execute(raw)
}
func (f *fixture) call(org, role, action string, data any) Result {
	f.t.Helper()
	r, err := f.raw(org, role, fmt.Sprintf("request-%d", f.seq), action, data)
	if err != nil {
		f.t.Fatalf("%s: %v", action, err)
	}
	return r
}
func (f *fixture) reject(org, role, action string, data any, code string) {
	f.t.Helper()
	before := f.store.clone()
	_, err := f.raw(org, role, fmt.Sprintf("request-%d", f.seq), action, data)
	if err == nil || !strings.HasPrefix(err.Error(), code+":") {
		f.t.Fatalf("%s expected %s, got %v", action, code, err)
	}
	if !reflect.DeepEqual(before, f.store) {
		f.t.Fatal("rejected command changed ledger")
	}
}
func (f *fixture) add(id, typ, org string) {
	f.t.Helper()
	prefix := "DEMPB"
	batch := ""
	switch typ {
	case "CELL":
		prefix = "SIMCB"
		batch = "batch1"
	case "MODULE":
		prefix = "DEMMB"
	}
	code := prefix + "01" + "0000001" + "G11" + fmt.Sprintf("%07d", f.seq)
	f.call(org, "manufacturer", "RegisterAsset", RegisterAssetInput{ID: id, Code: code, BatchID: batch, Model: "simulation-model", ManufacturedAt: "2026-01-01", ManufactureSourceHash: Digest("manufacture")})
}
func (f *fixture) inspect(id, result string) {
	f.t.Helper()
	a, _ := f.engine.asset(id)
	f.call(LabOrg, "inspector", "SubmitInspection", InspectionInput{fmt.Sprintf("inspection-%d", f.seq), id, a.InspectionVersion + 1, result, Digest("report"), Digest("source")})
}
func (f *fixture) assembled() {
	f.add("cell1", "CELL", CellOrg)
	f.add("cell2", "CELL", CellOrg)
	f.add("module1", "MODULE", PackOrg)
	f.add("pack1", "PACK", PackOrg)
	f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{"cell1", "module1", Digest("supply")})
	f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{"cell2", "module1", Digest("supply")})
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell1", "cell2"}, 1, Digest("bind")})
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"pack1", []string{"module1"}, 1, Digest("bind")})
	for _, id := range []string{"cell1", "cell2", "module1", "pack1"} {
		f.inspect(id, "QC_PASSED")
	}
}
func (f *fixture) risk(id, level string) Risk {
	h, _, err := f.engine.Snapshot("pack1")
	if err != nil {
		f.t.Fatal(err)
	}
	p, _ := f.engine.policy()
	r := Risk{ID: "risk-" + id, RequestID: id, AssetID: "pack1", SnapshotHash: h, PolicyVersion: p.Version, ModelVersion: "model-v1", Level: level, EvidenceHash: Digest("risk evidence"), IssuedAt: f.engine.Now.Format(time.RFC3339), ExpiresAt: f.engine.Now.Add(5 * time.Minute).Format(time.RFC3339), SignerID: "risk-v1"}
	r.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(f.private, RiskSigningBytes(r)))
	return r
}
func (f *fixture) release(level string) {
	r := f.risk("release1", level)
	f.call(PackOrg, "release", "RequestRelease", ReleaseInput{"release1", "pack1", r})
	for _, org := range []string{CellOrg, LabOrg, PackOrg} {
		f.call(org, "approver", "ApproveRelease", IDInput{"release1"})
	}
	if level == "HIGH" {
		f.call(RecycleOrg, "approver", "ApproveRelease", IDInput{"release1"})
	}
	f.call(PackOrg, "release", "FinalizeRelease", IDInput{"release1"})
}

func TestFullLifecycleAndImmutableScrap(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.release("HIGH")
	f.call(PackOrg, "operator", "RecordInstallation", LifecycleInput{"pack1", "2026-02-01T00:00:00Z", Digest("install")})
	f.call(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-02-02T00:00:00Z", Digest("first-use")})
	f.call(PackOrg, "operator", "RecordRetirement", LifecycleInput{"pack1", "2026-11-01T00:00:00Z", Digest("retirement")})
	f.call(PackOrg, "custodian", "InitiateTransfer", TransferInput{"transfer1", "pack1", RecycleOrg, Digest("receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)})
	f.reject(PackOrg, "custodian", "ConfirmTransfer", ConfirmTransferInput{"transfer1", Digest("receipt")}, "FORBIDDEN")
	f.call(RecycleOrg, "custodian", "ConfirmTransfer", ConfirmTransferInput{"transfer1", Digest("receipt")})
	f.call(RecycleOrg, "recycler", "ConfirmRecycling", LifecycleInput{"pack1", "2026-11-02T00:00:00Z", Digest("recycling")})
	f.reject(PackOrg, "operator", "RecordScrapConfirmation", LifecycleInput{"pack1", "2026-11-03T00:00:00Z", Digest("scrap")}, "FORBIDDEN")
	f.call(RecycleOrg, "recycler", "RecordScrapConfirmation", LifecycleInput{"pack1", "2026-11-03T00:00:00Z", Digest("scrap")})
	f.reject(RecycleOrg, "custodian", "InitiateTransfer", TransferInput{"transfer2", "pack1", PackOrg, Digest("receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)}, "FORBIDDEN")
	f.reject(RecycleOrg, "recycler", "RecordScrapConfirmation", LifecycleInput{"pack1", "2026-11-04T00:00:00Z", Digest("scrap")}, "INVALID_STATE")
	a, _ := f.engine.asset("pack1")
	if a.State != "PROCESSED" || a.ScrappedAt == nil || a.FirstUseAt == nil {
		t.Fatal("lifecycle evidence absent")
	}
}
func TestQualityAndAuthorizationGates(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.reject(PackOrg, "inspector", "SubmitInspection", InspectionInput{"spoof", "cell1", 2, "QC_PASSED", Digest("r"), Digest("s")}, "FORBIDDEN")
	f.inspect("cell1", "QC_REJECTED")
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"bad-release", "pack1", f.risk("bad-release", "LOW")}, "QUALITY_GATE")
	f.inspect("cell1", "REVIEW_REQUIRED")
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"review-release", "pack1", f.risk("review-release", "LOW")}, "QUALITY_GATE")
	f.inspect("cell1", "QC_PASSED")
	rows, _ := f.store.Scan("inspection:cell1:")
	if len(rows) != 4 {
		t.Fatal("inspection history overwritten")
	}
	f.release("LOW")
}
func TestApprovalReplayAndRiskBinding(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	r := f.risk("release1", "LOW")
	bad := r
	bad.Level = "HIGH"
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"release1", "pack1", bad}, "RISK_SIGNATURE")
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"other-release", "pack1", r}, "RISK_BINDING")
	f.call(PackOrg, "release", "RequestRelease", ReleaseInput{"release1", "pack1", r})
	f.reject(PackOrg, "release", "FinalizeRelease", IDInput{"release1"}, "APPROVALS_MISSING")
	f.call(CellOrg, "approver", "ApproveRelease", IDInput{"release1"})
	f.reject(CellOrg, "approver", "ApproveRelease", IDInput{"release1"}, "DUPLICATE_APPROVAL")
	f.inspect("cell1", "QC_PASSED")
	f.reject(LabOrg, "approver", "ApproveRelease", IDInput{"release1"}, "STALE_APPROVAL")
}
func TestRiskExpiryAndHighRiskReview(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	r := f.risk("release1", "HIGH")
	f.call(PackOrg, "release", "RequestRelease", ReleaseInput{"release1", "pack1", r})
	for _, org := range []string{CellOrg, LabOrg, PackOrg} {
		f.call(org, "approver", "ApproveRelease", IDInput{"release1"})
	}
	f.reject(PackOrg, "release", "FinalizeRelease", IDInput{"release1"}, "APPROVALS_MISSING")
	f.engine.Now = f.engine.Now.Add(301 * time.Second)
	f.reject(RecycleOrg, "approver", "ApproveRelease", IDInput{"release1"}, "RISK_EXPIRED")
}
func TestIdempotencyAndConflictingPayload(t *testing.T) {
	f := newFixture(t)
	in := MaterialLot{"another-material", CellOrg, Digest("x"), true}
	r, err := f.raw(CellOrg, "manufacturer", "same-request", "RegisterMaterialLot", in)
	if err != nil {
		t.Fatal(err)
	}
	before := f.store.clone()
	r2, err := f.raw(CellOrg, "manufacturer", "same-request", "RegisterMaterialLot", in)
	if err != nil || r != r2 || !reflect.DeepEqual(before, f.store) {
		t.Fatal("duplicate request was not read-only")
	}
	in.SourceHash = Digest("changed")
	_, err = f.raw(CellOrg, "manufacturer", "same-request", "RegisterMaterialLot", in)
	if err == nil || !strings.HasPrefix(err.Error(), "IDEMPOTENCY_CONFLICT:") {
		t.Fatal("payload conflict not rejected")
	}
}
func TestBindingAndHistoricalEdges(t *testing.T) {
	f := newFixture(t)
	f.add("cell1", "CELL", CellOrg)
	f.add("cell2", "CELL", CellOrg)
	f.add("module1", "MODULE", PackOrg)
	f.add("module2", "MODULE", PackOrg)
	f.reject(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell1"}, 1, Digest("bind")}, "SUPPLY_REQUIRED")
	f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{"cell1", "module1", Digest("supply")})
	f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{"cell2", "module1", Digest("supply")})
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell1"}, 1, Digest("bind")})
	f.reject(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module2", []string{"cell1"}, 1, Digest("bind")}, "INVALID_ASSEMBLY")
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell2"}, 2, Digest("bind")})
	a, _ := f.engine.asset("cell1")
	if a.ParentID != "" || a.State != "REGISTERED" {
		t.Fatal("old edge still active")
	}
	rows, _ := f.store.Scan("edge:module1:")
	if len(rows) != 2 {
		t.Fatal("edge history lost")
	}
	var old Edge
	json.Unmarshal(rows[0], &old)
	if old.ActiveTo == nil {
		t.Fatal("old edge was not closed")
	}
}
func TestManufacturerAndCodeUniqueness(t *testing.T) {
	f := newFixture(t)
	f.add("cell1", "CELL", CellOrg)
	a, _ := f.engine.asset("cell1")
	f.reject(PackOrg, "manufacturer", "RegisterAsset", RegisterAssetInput{ID: "stolen", Code: a.Code, BatchID: "batch1", Model: "x", ManufacturedAt: "2026-01-01", ManufactureSourceHash: Digest("m")}, "FORBIDDEN")
	f.reject(CellOrg, "manufacturer", "RegisterAsset", RegisterAssetInput{ID: "duplicate", Code: a.Code, BatchID: "batch1", Model: "x", ManufacturedAt: "2026-01-01", ManufactureSourceHash: Digest("m")}, "ALREADY_EXISTS")
	f.reject(CellOrg, "admin", "RegisterMaker", Maker{"NEW", "False official company", CellOrg, false, Digest("source")}, "INVALID_MAKER")
}
func TestLifecycleCannotSkipOrRewriteEvents(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.reject(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-02-01T00:00:00Z", Digest("x")}, "INVALID_STATE")
	f.release("LOW")
	f.call(PackOrg, "operator", "RecordInstallation", LifecycleInput{"pack1", "2026-03-01T00:00:00Z", Digest("x")})
	f.reject(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-02-01T00:00:00Z", Digest("x")}, "INVALID_TIME")
	f.reject(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2027-01-01T00:00:00Z", Digest("x")}, "INVALID_TIME")
	f.call(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-03-01T00:00:00Z", Digest("x")})
	f.reject(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-03-02T00:00:00Z", Digest("x")}, "INVALID_STATE")
}
func TestPolicyCannotWeakenSecurityAndRequiresEveryOrganization(t *testing.T) {
	f := newFixture(t)
	p, _ := f.engine.policy()
	p.Version = 2
	p.RequiredOrgs = []string{PackOrg}
	f.reject(CellOrg, "admin", "ProposePolicy", PolicyInput{"weak", p, Digest("tests")}, "UNSAFE_POLICY")
	p, _ = f.engine.policy()
	p.Version = 2
	f.call(CellOrg, "admin", "ProposePolicy", PolicyInput{"next", p, Digest("tests")})
	for _, org := range []string{CellOrg, LabOrg, PackOrg} {
		f.call(org, "auditor", "ApprovePolicy", IDInput{"next"})
	}
	f.reject(CellOrg, "admin", "ActivatePolicy", IDInput{"next"}, "APPROVALS_MISSING")
	f.call(RecycleOrg, "auditor", "ApprovePolicy", IDInput{"next"})
	f.call(CellOrg, "admin", "ActivatePolicy", IDInput{"next"})
	active, _ := f.engine.policy()
	if active.Version != 2 {
		t.Fatal("candidate did not activate")
	}
	f.reject(CellOrg, "admin", "ActivatePolicy", IDInput{"next"}, "STALE_POLICY")
}
func TestTransferCanContinueAfterCompletedTransfer(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	for i, route := range [][2]string{{PackOrg, CellOrg}, {CellOrg, PackOrg}} {
		id := fmt.Sprintf("transfer-%d", i)
		f.call(route[0], "custodian", "InitiateTransfer", TransferInput{id, "pack1", route[1], Digest("receipt"), f.engine.Now.Add(time.Hour).Format(time.RFC3339)})
		f.call(route[1], "custodian", "ConfirmTransfer", ConfirmTransferInput{id, Digest("receipt")})
	}
	a, _ := f.engine.asset("pack1")
	if a.HolderMSP != PackOrg {
		t.Fatal("continued transfer lost custody")
	}
}

func TestReassemblyRequiresNewParentInspection(t *testing.T) {
	f := newFixture(t)
	f.add("cell1", "CELL", CellOrg)
	f.add("cell2", "CELL", CellOrg)
	f.add("module1", "MODULE", PackOrg)
	for _, id := range []string{"cell1", "cell2"} {
		f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{id, "module1", Digest("supply")})
	}
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell1"}, 1, Digest("binding")})
	f.inspect("module1", "QC_PASSED")
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{"cell2"}, 2, Digest("replacement")})
	parent, _ := f.engine.asset("module1")
	if parent.Quality != "REVIEW_REQUIRED" {
		t.Fatal("parent inspection remained valid after composition changed")
	}
	f.inspect("module1", "QC_PASSED")
	rows, _ := f.store.Scan("inspection:module1:")
	if len(rows) != 2 {
		t.Fatal("parent inspection history lost")
	}
}

func TestInstallationRejectsQualityChangedAfterRelease(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.release("LOW")
	f.inspect("cell1", "QC_REJECTED")
	f.reject(PackOrg, "operator", "RecordInstallation", LifecycleInput{"pack1", "2026-02-01T00:00:00Z", Digest("installation")}, "QUALITY_GATE")
}
func TestStrictJSONRejectsIdentityInjection(t *testing.T) {
	f := newFixture(t)
	f.engine.Actor = Actor{PackOrg, "pack-user", "manufacturer"}
	f.engine.TxID = "injected"
	_, err := f.engine.Execute([]byte(`{"requestId":"evil","action":"SubmitInspection","actor":{"msp":"LabOrgMSP"},"data":{}}`))
	if err == nil || !strings.HasPrefix(err.Error(), "INVALID_INPUT:") {
		t.Fatal("trusted actor was injectable")
	}
}
