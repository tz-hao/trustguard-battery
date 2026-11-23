package domain

import (
	"encoding/json"
	"os"
	"testing"
)

func TestBatchRetestAndRelease(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	subject := "batch:batch1"
	report := InspectionInput{"batch-first", subject, 1, "QC_REJECTED", Digest("report"), Digest("source")}
	f.call(LabOrg, "inspector", "SubmitBatchInspection", report)
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"denied", "pack1", f.risk("denied", "LOW")}, "QUALITY_GATE")
	report.ID = "batch-second"
	report.Version = 2
	report.Result = "QC_PASSED"
	f.reject(LabOrg, "inspector", "SubmitBatchInspection", report, "RETEST_REQUIRED")
	f.reject(LabOrg, "inspector", "CompleteRetest", report, "RETEST_REQUIRED")
	f.call(LabOrg, "auditor", "ProposeRetest", RetestInput{subject, 1, Digest("reason")})
	f.reject(LabOrg, "auditor", "CompleteRetest", report, "FORBIDDEN")
	f.call(LabOrg, "inspector", "CompleteRetest", report)
	f.reject(LabOrg, "inspector", "CompleteRetest", report, "VERSION_CONFLICT")
	rows, _ := f.store.Scan("batch-report:batch1:")
	if len(rows) != 2 {
		t.Fatal("batch history missing")
	}
	proposal, _ := f.engine.pendingRetest(subject, 1)
	if proposal.ProposedTx == "" || proposal.CompletedTx == "" {
		t.Fatal("missing signed review trail")
	}
	f.release("LOW")
}
func TestRetestCannotSelfSign(t *testing.T) {
	f := newFixture(t)
	f.assembled()
	f.call(LabOrg, "inspector", "ProposeRetest", RetestInput{"cell1", 1, Digest("reason")})
	in := InspectionInput{"new", "cell1", 2, "QC_PASSED", Digest("r"), Digest("s")}
	f.reject(LabOrg, "inspector", "CompleteRetest", in, "FORBIDDEN")
	f.reject(LabOrg, "inspector", "SubmitInspection", in, "RETEST_REQUIRED")
	f.reject(PackOrg, "release", "RequestRelease", ReleaseInput{"pending", "pack1", f.risk("pending", "LOW")}, "QUALITY_GATE")
}
func TestMESExamplesAndAtomicRollback(t *testing.T) {
	f := newFixture(t)
	for _, m := range []Maker{{"SMA", "Simulated cell", CellOrg, true, Digest("source")}, {"DMA", "Simulated pack", PackOrg, true, Digest("source")}} {
		f.call(m.MSP, "admin", "RegisterMaker", m)
	}
	for _, step := range []struct{ name, org, role string }{{"production", CellOrg, "manufacturer"}, {"pack-products", PackOrg, "manufacturer"}, {"supply", CellOrg, "manufacturer"}, {"assembly", PackOrg, "assembler"}} {
		raw, err := os.ReadFile("../../apps/web/public/examples/mes-" + step.name + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var file struct {
			RequestID string `json:"requestId"`
			MESImport
		}
		if err = json.Unmarshal(raw, &file); err != nil {
			t.Fatal(err)
		}
		if step.name == "production" {
			copyFile := file.MESImport
			copyFile.Records = append(append([]MESRecord{}, copyFile.Records...), MESRecord{"invalid", nil})
			f.reject(step.org, step.role, "ImportMES", copyFile, "INVALID_INPUT")
			f.reject(PackOrg, "manufacturer", "ImportMES", file.MESImport, "FORBIDDEN")
		}
		result, err := f.raw(step.org, step.role, file.RequestID, "ImportMES", file.MESImport)
		if err != nil || result.Version != uint64(len(file.Records)) {
			t.Fatalf("%s: %v", step.name, err)
		}
		replay, err := f.raw(step.org, step.role, file.RequestID, "ImportMES", file.MESImport)
		proof, errProof := read[MESImportReceipt](f.engine, "mes-import:"+result.TxID)
		if errProof != nil || proof.RequestID != file.RequestID || proof.Count != result.Version || proof.Organization != step.org || proof.SourceHash != Digest(file.MESImport) {
			t.Fatal("wrong MES receipt")
		}
		if err != nil || replay != result {
			t.Fatal("MES replay changed result")
		}
	}
	path, err := f.engine.ancestry("mes-demo-cell")
	if err != nil || len(path.Ancestors) != 2 || path.Ancestors[0].ID != "mes-demo-module" || path.Ancestors[1].ID != "mes-demo-pack" {
		t.Fatal("incomplete imported assembly")
	}
}

func TestForwardTraceDoesNotIncludeSiblingPack(t *testing.T) {
	f := newFixture(t)
	for _, suffix := range []string{"-left", "-right"} {
		c, m, p := "cell"+suffix, "mod"+suffix, "pack"+suffix
		f.add(c, "CELL", CellOrg)
		f.add(m, "MODULE", PackOrg)
		f.add(p, "PACK", PackOrg)
		f.call(CellOrg, "manufacturer", "AuthorizeAssembly", SupplyInput{c, m, Digest("delivery")})
		f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{m, []string{c}, 1, Digest("bind module")})
		f.call(PackOrg, "assembler", "ReplaceAssembly", AssemblyInput{p, []string{m}, 1, Digest("bind pack")})
	}
	for _, suffix := range []string{"-left", "-right"} {
		result, err := f.engine.ancestry("cell" + suffix)
		if err != nil || result.Asset.BatchID != "batch1" || len(result.Ancestors) != 2 || result.Ancestors[0].ID != "mod"+suffix || result.Ancestors[1].ID != "pack"+suffix {
			t.Fatal("same-batch sibling leaked into ancestry")
		}
	}
}
