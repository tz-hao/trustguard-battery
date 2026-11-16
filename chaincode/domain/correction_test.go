package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func usedPack(t *testing.T) *fixture {
	f := newFixture(t)
	f.assembled()
	f.release("LOW")
	f.call(PackOrg, "operator", "RecordInstallation", LifecycleInput{"pack1", "2026-02-01T00:00:00Z", Digest("installation")})
	f.call(PackOrg, "operator", "RecordFirstUse", LifecycleInput{"pack1", "2026-02-02T00:00:00Z", Digest("first use")})
	return f
}
func TestLifecycleCorrectionRequiresIndependentReviewAndPreservesHistory(t *testing.T) {
	f := usedPack(t)
	a, _ := f.engine.asset("pack1")
	in := CorrectionInput{"correction1", a.ID, "firstUseAt", "2026-02-03T00:00:00Z", Digest("corrected source"), Digest("reason"), a.Version}
	f.reject(CellOrg, "manufacturer", "ProposeLifecycleCorrection", in, "FORBIDDEN")
	f.call(PackOrg, "operator", "ProposeLifecycleCorrection", in)
	f.reject(PackOrg, "operator", "ApplyLifecycleCorrection", IDInput{in.ID}, "APPROVALS_MISSING")
	f.call(PackOrg, "auditor", "ApproveLifecycleCorrection", IDInput{in.ID})
	f.reject(PackOrg, "operator", "ApplyLifecycleCorrection", IDInput{in.ID}, "APPROVALS_MISSING")
	f.call(LabOrg, "auditor", "ApproveLifecycleCorrection", IDInput{in.ID})
	f.call(PackOrg, "operator", "ApplyLifecycleCorrection", IDInput{in.ID})
	corrected, _ := f.engine.asset(a.ID)
	if corrected.State != "IN_USE" || *corrected.FirstUseAt != in.NewValue || corrected.Version != a.Version+1 {
		t.Fatal("correction changed lifecycle state or failed to update version")
	}
	b, _ := f.store.Get("correction:pack1:correction1")
	var record LifecycleCorrection
	json.Unmarshal(b, &record)
	if record.OldValue != "2026-02-02T00:00:00Z" || record.State != "APPLIED" || record.AppliedTxID == "" {
		t.Fatal("original event or applied evidence lost")
	}
	f.reject(PackOrg, "operator", "ApplyLifecycleCorrection", IDInput{in.ID}, "STALE_CORRECTION")
}
func TestCorrectionCannotCreateScrapOrBreakChronology(t *testing.T) {
	f := usedPack(t)
	a, _ := f.engine.asset("pack1")
	f.reject(RecycleOrg, "recycler", "ProposeLifecycleCorrection", CorrectionInput{"fake-scrap", a.ID, "scrappedAt", "2026-03-01T00:00:00Z", Digest("e"), Digest("r"), a.Version}, "FORBIDDEN")
	f.reject(PackOrg, "operator", "ProposeLifecycleCorrection", CorrectionInput{"before-install", a.ID, "firstUseAt", "2026-01-01T00:00:00Z", Digest("e"), Digest("r"), a.Version}, "CHRONOLOGY_INVALID")
	f.reject(PackOrg, "operator", "ProposeLifecycleCorrection", CorrectionInput{"future", a.ID, "firstUseAt", "2027-01-01T00:00:00Z", Digest("e"), Digest("r"), a.Version}, "INVALID_TIME")
}
func TestCorrectionExpiresAndAssetChangesInvalidateVotes(t *testing.T) {
	for _, changed := range []bool{false, true} {
		f := usedPack(t)
		a, _ := f.engine.asset("pack1")
		in := CorrectionInput{"c1", a.ID, "firstUseAt", "2026-02-03T00:00:00Z", Digest("e"), Digest("r"), a.Version}
		f.call(PackOrg, "operator", "ProposeLifecycleCorrection", in)
		if changed {
			f.inspect("pack1", "QC_PASSED")
			f.reject(LabOrg, "auditor", "ApproveLifecycleCorrection", IDInput{"c1"}, "STALE_CORRECTION")
		} else {
			f.engine.Now = f.engine.Now.Add(25 * time.Hour)
			f.reject(LabOrg, "auditor", "ApproveLifecycleCorrection", IDInput{"c1"}, "CORRECTION_EXPIRED")
		}
	}
}
func TestAncestryKeepsChildUsageUnknownAndExposesParentContext(t *testing.T) {
	f := usedPack(t)
	result, err := f.engine.ancestry("cell1")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Ancestors) != 2 || result.Ancestors[1].State != "IN_USE" || result.Asset.FirstUseAt != nil {
		t.Fatal("parent usage was hidden or falsely copied to child")
	}
}

func TestCompleteDisassemblyClosesEdgesWithoutDeletingHistory(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"pack1", []string{}, 2, Digest("pack disassembly")})
	f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{"module1", []string{}, 2, Digest("module disassembly")})
	for _, id := range []string{"pack1", "module1", "cell1", "cell2"} {
		a, _ := f.engine.asset(id)
		if a.State != "REGISTERED" || a.ParentID != "" || len(a.Children) != 0 {
			t.Fatalf("%s remained assembled", id)
		}
	}
	rows, _ := f.store.Scan("edge:")
	if len(rows) != 3 {
		t.Fatal("historical edges lost")
	}
	for _, row := range rows {
		var edge Edge
		json.Unmarshal(row, &edge)
		if edge.ActiveTo == nil {
			t.Fatal("historical edge still active")
		}
	}
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"empty-release", "pack1", f.risk("empty-release", "LOW")}, "INVALID_STATE")
}
